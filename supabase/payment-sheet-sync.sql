-- Fields copied from the public payment sheet when a row is confidently matched.
alter table public.orders add column if not exists payment_time text;
alter table public.orders add column if not exists email_id text;
alter table public.orders add column if not exists package_name text;
