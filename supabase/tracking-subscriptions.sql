-- Share one EasyPost tracker registration for a carrier/number reused across order rows.
create table if not exists public.tracking_subscriptions (
  id text primary key,
  registered boolean not null default false,
  next_attempt_at timestamptz not null default now()
);
alter table public.tracking_subscriptions enable row level security;
revoke all on public.tracking_subscriptions from anon, authenticated;
grant all on public.tracking_subscriptions to service_role;
