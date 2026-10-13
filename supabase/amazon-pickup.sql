alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source is null or source in ('mailbox','locker','whole-foods','campus-locker'));
