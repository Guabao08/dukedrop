-- Staff confirmation applies to all items in an order. No changes to payment status.
alter table public.orders
  add column if not exists pickup_readiness text not null default 'auto'
    check (pickup_readiness in ('auto','waiting','ready','collected','hold')),
  add column if not exists pickup_note text not null default '',
  add column if not exists pickup_updated_at timestamptz;
