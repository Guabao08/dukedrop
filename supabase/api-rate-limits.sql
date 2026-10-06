-- Durable per-IP API rate limits. Apply before deploying routes that call the RPC.
create table if not exists public.api_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

revoke all on public.api_rate_limits from anon, authenticated;
grant all on public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
  current_time timestamptz := pg_catalog.clock_timestamp();
begin
  if p_key_hash !~ '^[a-f0-9]{64}$' or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.api_rate_limits as limits (key_hash, window_started_at, request_count)
  values (p_key_hash, current_time, 1)
  on conflict (key_hash) do update set
    window_started_at = case
      when limits.window_started_at <= current_time - pg_catalog.make_interval(secs => p_window_seconds)
      then current_time else limits.window_started_at end,
    request_count = case
      when limits.window_started_at <= current_time - pg_catalog.make_interval(secs => p_window_seconds)
      then 1 else limits.request_count + 1 end
  returning request_count <= p_limit into allowed;

  return allowed;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
