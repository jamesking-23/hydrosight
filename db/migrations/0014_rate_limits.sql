-- 0014: fixed-window request counters used to rate-limit ingestion endpoints (Phase 10).
-- Database-backed so the limit holds across serverless instances. Only the API's database role
-- (owner / service_role) may call rate_hit; the table is unreachable through the public API.
-- The limits themselves are operational settings in the API (RATE_LIMIT_*), not stored here.
create unlogged table public.rate_counters (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_counters enable row level security;
revoke all on public.rate_counters from public, anon, authenticated;

-- Counts one hit; returns true while the bucket is within `p_limit` hits per `p_window_s` seconds.
create function public.rate_hit(p_bucket text, p_limit integer, p_window_s integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare ws timestamptz; n integer;
begin
  if p_limit < 1 or p_window_s < 1 or length(coalesce(p_bucket, '')) not between 1 and 200 then
    raise exception 'invalid rate limit request' using errcode = '22023';
  end if;
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.rate_counters (bucket, window_start, hits) values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_counters.hits + 1
  returning hits into n;
  if random() < 0.01 then  -- housekeeping: drop windows older than a day
    delete from public.rate_counters where window_start < now() - interval '1 day';
  end if;
  return n <= p_limit;
end $$;
revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;
-- DOWN: drop function public.rate_hit(text, integer, integer); drop table public.rate_counters;
