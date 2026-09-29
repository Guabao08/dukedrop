-- One row per carrier tracking number. items_count maps a shipment to order items.
create table if not exists public.order_trackers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  tracking_code text not null check (length(tracking_code) between 8 and 64),
  carrier text not null default '',
  items_count integer not null default 1 check (items_count between 1 and 50),
  provider_id text,
  status text not null default 'pending',
  status_updated_at timestamptz,
  estimated_delivery_at timestamptz,
  checked_at timestamptz,
  next_sync_at timestamptz not null default now(),
  sync_error text,
  created_at timestamptz not null default now(),
  unique(order_id, tracking_code)
);
alter table public.order_trackers enable row level security;
revoke all on public.order_trackers from anon, authenticated;
grant all on public.order_trackers to service_role;
create index if not exists order_trackers_provider_idx on public.order_trackers(provider_id);
create index if not exists order_trackers_sync_idx on public.order_trackers(next_sync_at);

create or replace function public.seed_order_trackers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.service = 'returns' or (new.service = 'bigdrop' and new.base_service = 'returns') then return new; end if;
  insert into public.order_trackers (order_id, tracking_code, carrier)
  select new.id, upper(regexp_replace(trim(code), '\s', '', 'g')), coalesce(new.carrier, '')
  from regexp_split_to_table(coalesce(new.tracking, ''), E'[,;\n\r]+') as code
  where upper(regexp_replace(trim(code), '\s', '', 'g')) ~ '^[A-Z0-9-]{8,64}$'
  on conflict (order_id, tracking_code) do nothing;
  return new;
end; $$;
revoke all on function public.seed_order_trackers() from public;
drop trigger if exists orders_seed_trackers on public.orders;
create trigger orders_seed_trackers after insert on public.orders
for each row execute function public.seed_order_trackers();

-- Existing active orders become eligible for registration after the provider is enabled.
insert into public.order_trackers (order_id, tracking_code, carrier)
select o.id, upper(regexp_replace(trim(code), '\s', '', 'g')), coalesce(o.carrier, '')
from public.orders o cross join lateral regexp_split_to_table(coalesce(o.tracking, ''), E'[,;\n\r]+') as code
where o.order_status not in ('completed','cancelled') and o.service <> 'returns'
  and not (o.service = 'bigdrop' and o.base_service = 'returns')
  and upper(regexp_replace(trim(code), '\s', '', 'g')) ~ '^[A-Z0-9-]{8,64}$'
on conflict (order_id, tracking_code) do nothing;

-- Concurrent webhook deliveries cannot replace a newer carrier snapshot.
create or replace function public.apply_tracker_event(p_provider_id text, p_status text, p_updated_at timestamptz, p_estimated_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  update public.order_trackers set status = p_status, status_updated_at = p_updated_at,
    estimated_delivery_at = p_estimated_at, checked_at = now(), sync_error = null,
    next_sync_at = now() + interval '6 hours'
  where provider_id = p_provider_id
    and (status_updated_at is null or status_updated_at <= p_updated_at);
$$;
revoke all on function public.apply_tracker_event(text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_tracker_event(text,text,timestamptz,timestamptz) to service_role;
