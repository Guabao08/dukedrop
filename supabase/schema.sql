create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  payment_time text,
  email_id text,
  package_name text,
  service text not null check (service in ('express','pickup','returns','bigdrop')),
  base_service text not null default 'express' check (base_service in ('express','pickup','returns')),
  order_size text not null default 'standard' check (order_size in ('standard','bigdrop')),
  quantity integer not null check (quantity between 1 and 50),
  dorm text not null,
  room text not null,
  phone text not null,
  carrier text,
  tracking text,
  source text check (source is null or source in ('mailbox','locker')),
  mailroom text,
  box_number text,
  locker_location text,
  locker_code text,
  recipient_name text,
  fulfillment_mode text check (fulfillment_mode is null or fulfillment_mode in ('ship','pickup')),
  promo_code text,
  discount_percent integer not null default 0 check (discount_percent in (0,20,100)),
  amount_due numeric(8,2) not null check (amount_due >= 0),
  payment_method text check (payment_method is null or payment_method in ('venmo','zelle','card')),
  payment_status text not null default 'unconfirmed' check (payment_status in ('unconfirmed','paid','refunded')),
  order_status text not null default 'payment_started' check (order_status in ('payment_started','received','in_progress','completed','cancelled'))
);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant select, update on public.orders to authenticated;
grant usage on schema public to authenticated;

-- Only accounts explicitly granted the staff app_metadata claim can access customer data.
-- Set app_metadata.role = "staff" for each staff account from the Supabase dashboard.
create policy "Staff can view orders" on public.orders for select to authenticated
  using (((select auth.jwt())->'app_metadata'->>'role') = 'staff');
create policy "Staff can update order status" on public.orders for update to authenticated
  using (((select auth.jwt())->'app_metadata'->>'role') = 'staff')
  with check (((select auth.jwt())->'app_metadata'->>'role') = 'staff');
