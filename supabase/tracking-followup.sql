-- Apply after schema.sql. Orders whose tracking was not supplied at checkout
-- enter a follow-up queue 24 hours after creation. No text is sent by SQL.
alter table public.orders add column if not exists tracking_followup_status text not null default 'not_needed'
  check (tracking_followup_status in ('not_needed','pending','sent','received','skipped'));
alter table public.orders add column if not exists tracking_followup_due_at timestamptz;
alter table public.orders add column if not exists tracking_followup_sent_at timestamptz;
alter table public.orders add column if not exists tracking_received_at timestamptz;

alter table public.orders add column if not exists base_service text not null default 'express' check (base_service in ('express','pickup','returns'));
alter table public.orders add column if not exists order_size text not null default 'standard' check (order_size in ('standard','bigdrop'));

create or replace function public.set_tracking_followup()
returns trigger language plpgsql as $$
begin
  if new.base_service <> 'returns' and coalesce(nullif(trim(new.tracking), ''), '') = '' then
    new.tracking_followup_status := 'pending';
    new.tracking_followup_due_at := coalesce(new.tracking_followup_due_at, now() + interval '24 hours');
  else
    new.tracking_followup_status := 'not_needed';
    new.tracking_followup_due_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists orders_tracking_followup on public.orders;
create trigger orders_tracking_followup before insert or update of tracking on public.orders
for each row execute function public.set_tracking_followup();
create index if not exists orders_tracking_followup_due_idx on public.orders(tracking_followup_due_at)
  where tracking_followup_status = 'pending';
