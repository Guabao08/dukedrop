-- Apply after tracking-followup.sql and carrier-tracking.sql.
alter table public.orders add column if not exists retailer text not null default 'other'
  check (retailer in ('other', 'amazon'));
alter table public.orders add column if not exists sms_opt_in boolean not null default false;
alter table public.orders add column if not exists payment_confirmed_at timestamptz;
alter table public.orders add column if not exists estimated_delivery_date date;
alter table public.orders add column if not exists shipping_link text;
alter table public.orders add column if not exists tracking_followup_message_sid text;
alter table public.orders add column if not exists tracking_followup_claimed_at timestamptz;

-- Old pending rows were timed from checkout, including unpaid orders. Do not
-- send historical messages when this migration is first deployed.
update public.orders set tracking_followup_status = 'not_needed', tracking_followup_due_at = null
where tracking_followup_status = 'pending';

create or replace function public.schedule_paid_followup()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    new.payment_confirmed_at := now();
    if new.sms_opt_in and new.base_service <> 'returns' and new.order_status not in ('completed', 'cancelled') then
      new.tracking_followup_status := 'pending';
      new.tracking_followup_due_at := now() + interval '24 hours';
      new.tracking_followup_sent_at := null;
      new.tracking_followup_message_sid := null;
    end if;
  elsif new.payment_status <> 'paid' or new.order_status in ('completed', 'cancelled') then
    if new.tracking_followup_status = 'pending' then
      new.tracking_followup_status := 'skipped';
      new.tracking_followup_due_at := null;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists orders_paid_followup on public.orders;
create trigger orders_paid_followup before insert or update of payment_status, order_status on public.orders
for each row execute function public.schedule_paid_followup();

-- Replace the old checkout-time trigger. Tracking supplied later still ends a pending request.
create or replace function public.set_tracking_followup()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tracking is distinct from old.tracking and new.estimated_delivery_date is not null
    and coalesce(nullif(trim(new.tracking), ''), '') <> ''
    and new.tracking_followup_status = 'pending' then
    new.tracking_followup_status := 'received';
    new.tracking_received_at := now();
    new.tracking_followup_due_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists orders_tracking_followup on public.orders;
create trigger orders_tracking_followup before update of tracking on public.orders
for each row execute function public.set_tracking_followup();

-- The unique Twilio SID makes webhook retries harmless.
create table if not exists public.order_sms_messages (
  sid text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  body text not null,
  received_at timestamptz not null default now()
);
alter table public.order_sms_messages enable row level security;
revoke all on public.order_sms_messages from anon, authenticated;
grant all on public.order_sms_messages to service_role;
create index if not exists orders_sms_due_idx on public.orders(tracking_followup_due_at)
  where tracking_followup_status = 'pending' and payment_status = 'paid';
create index if not exists order_sms_messages_order_idx on public.order_sms_messages(order_id, received_at desc);

-- Atomically claim a due order before contacting Twilio. Stale claims may be
-- reviewed by staff; they are never automatically resent after an uncertain send.
create or replace function public.claim_sms_followup(p_order_id uuid)
returns setof public.orders language plpgsql security definer set search_path = '' as $$
begin
  return query update public.orders o
    set tracking_followup_claimed_at = now()
    where o.id = p_order_id and o.payment_status = 'paid' and o.sms_opt_in
      and o.order_status not in ('completed', 'cancelled')
      and o.tracking_followup_status = 'pending'
      and o.tracking_followup_due_at <= now()
      and o.tracking_followup_claimed_at is null
    returning o.*;
end; $$;
revoke all on function public.claim_sms_followup(uuid) from public, anon, authenticated;
grant execute on function public.claim_sms_followup(uuid) to service_role;
