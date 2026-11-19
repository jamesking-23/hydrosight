-- requires: postgis
-- 0005: readings, forecasts, ingestion, and freshness (Phase 3).
--
-- Design rules enforced here:
--  * Readings enter only through public.ingest_readings(), callable by the backend (service
--    role) with an API key carrying the non-privileged scope `readings.write`. App roles have
--    no INSERT/UPDATE/DELETE on readings.
--  * A reading inherits its sensor's source_type (a synthetic sensor can never yield
--    "measured" data). Quality starts `unchecked`; no quality control is claimed.
--  * Plausibility checks are physical only (no universal flood thresholds): non-finite values,
--    future timestamps, negative rainfall, absurd rainfall/temperature (flagged `suspect`).
--  * Freshness (live / stale / offline / never_reported) is computed from the sensor's
--    expected interval at query time, so a last-known value can never be shown as live.

insert into public.permissions (key, description, privileged) values
  ('readings.write', 'Submit readings through an API key', false);
insert into public.role_permissions (role_key, permission_key) values
  ('org_admin', 'readings.write'),
  ('field_technician', 'readings.write'),
  ('sensor_operator', 'readings.write');

alter table public.sensors add constraint sensors_id_org_uq unique (id, org_id);

create table public.readings (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  sensor_id   uuid not null,
  observed_at timestamptz not null,
  value       double precision not null check (value > '-Infinity' and value < 'Infinity'),
  quality     public.quality_flag not null default 'unchecked',
  source_type public.source_type not null,
  received_at timestamptz not null default now(),
  api_key_id  uuid references public.api_keys (id) on delete set null,
  foreign key (sensor_id, org_id) references public.sensors (id, org_id) on delete cascade,
  unique (sensor_id, observed_at)
);
create index readings_sensor_time_idx on public.readings (sensor_id, observed_at desc);
create index readings_org_idx on public.readings (org_id);

create table public.forecasts (
  id               bigint generated always as identity primary key,
  org_id           uuid not null,
  station_id       uuid not null,
  issued_at        timestamptz not null,
  valid_at         timestamptz not null,
  variable         text not null check (variable in ('precipitation_mm_1h')),
  value            double precision not null check (value >= 0 and value < 'Infinity'),
  model            text not null check (length(btrim(model)) > 0),
  provider_licence text not null check (length(btrim(provider_licence)) > 0),
  source_type      public.source_type not null default 'forecast' check (source_type = 'forecast'),
  fetched_at       timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade,
  unique (station_id, variable, model, issued_at, valid_at)
);
create index forecasts_station_valid_idx on public.forecasts (station_id, valid_at);
create index forecasts_org_idx on public.forecasts (org_id);

alter table public.readings  enable row level security;
alter table public.forecasts enable row level security;
revoke all on public.readings, public.forecasts from anon, authenticated, service_role;
grant select on public.readings, public.forecasts to authenticated, service_role;
grant insert on public.forecasts to service_role;
create policy readings_select on public.readings for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.is_demo_org(org_id));
create policy forecasts_select on public.forecasts for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.is_demo_org(org_id));

create view public.sensor_status with (security_invoker = true) as
select s.id as sensor_id, s.org_id, s.station_id, s.kind, s.unit, s.expected_interval_s,
       s.source_type, l.observed_at as last_observed_at, l.value as last_value,
       l.quality as last_quality,
       case
         when l.observed_at is null then 'never_reported'
         when now() - l.observed_at <= s.expected_interval_s * 2 * interval '1 second' then 'live'
         when now() - l.observed_at <= s.expected_interval_s * 10 * interval '1 second' then 'stale'
         else 'offline'
       end as freshness
from public.sensors s
left join lateral (
  select r.observed_at, r.value, r.quality
  from public.readings r where r.sensor_id = s.id
  order by r.observed_at desc limit 1
) l on true;

create view public.forecast_latest with (security_invoker = true) as
select distinct on (f.station_id, f.variable, f.model, f.valid_at)
       f.station_id, f.org_id, f.variable, f.model, f.provider_licence,
       f.issued_at, f.valid_at, f.value, f.source_type
from public.forecasts f
where f.valid_at >= now() - interval '1 hour'
order by f.station_id, f.variable, f.model, f.valid_at, f.issued_at desc;

revoke all on public.sensor_status, public.forecast_latest from anon, authenticated, service_role;
grant select on public.sensor_status, public.forecast_latest to authenticated, service_role;

-- Backend only (service role). Returns per-item results; a bad item never blocks the batch.
create function public.ingest_readings(p_key text, p_readings jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key_id   uuid;
  v_org      uuid;
  v_scopes   text[];
  v_item     jsonb;
  v_idx      integer := 0;
  v_sid      uuid;
  v_obs      timestamptz;
  v_val      double precision;
  v_kind     text;
  v_stype    public.source_type;
  v_q        public.quality_flag;
  v_rows     integer;
  v_existing double precision;
  v_status   text;
  v_reason   text;
  v_acc      integer := 0;
  v_dup      integer := 0;
  v_rej      integer := 0;
  v_results  jsonb := '[]'::jsonb;
begin
  select k.key_id, k.key_org_id, k.key_scopes into v_key_id, v_org, v_scopes
    from public.verify_api_key(p_key) k;
  if v_key_id is null then
    raise exception 'invalid api key' using errcode = '28000';
  end if;
  if not ('readings.write' = any (v_scopes)) then
    raise exception 'api key lacks scope readings.write' using errcode = '42501';
  end if;
  if p_readings is null or jsonb_typeof(p_readings) <> 'array'
     or jsonb_array_length(p_readings) not between 1 and 1000 then
    raise exception 'readings must be an array of 1 to 1000 items' using errcode = '22023';
  end if;

  for v_item in select e from jsonb_array_elements(p_readings) e loop
    v_status := 'accepted'; v_reason := null; v_q := 'unchecked';
    begin
      if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item -> 'value'), '') <> 'number' then
        raise exception 'malformed';
      end if;
      v_sid := (v_item ->> 'sensor_id')::uuid;
      v_obs := (v_item ->> 'observed_at')::timestamptz;
      v_val := (v_item ->> 'value')::double precision;
    exception when others then
      v_status := 'rejected'; v_reason := 'malformed';
    end;

    if v_status = 'accepted' then
      select s.kind, s.source_type into v_kind, v_stype
        from public.sensors s where s.id = v_sid and s.org_id = v_org;
      if not found then
        v_status := 'rejected'; v_reason := 'unknown_sensor';
      elsif v_obs > now() + interval '5 minutes' then
        v_status := 'rejected'; v_reason := 'timestamp_in_future';
      elsif v_obs < now() - interval '30 days' then
        v_status := 'rejected'; v_reason := 'too_old';
      elsif v_kind = 'rainfall' and v_val < 0 then
        v_status := 'rejected'; v_reason := 'negative_rainfall';
      end if;
    end if;

    if v_status = 'accepted' then
      if (v_kind = 'rainfall' and v_val > 500) or (v_kind = 'temperature' and (v_val < -60 or v_val > 70)) then
        v_q := 'suspect';
      end if;
      insert into public.readings (org_id, sensor_id, observed_at, value, quality, source_type, api_key_id)
      values (v_org, v_sid, v_obs, v_val, v_q, v_stype, v_key_id)
      on conflict (sensor_id, observed_at) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        select r.value into v_existing from public.readings r
         where r.sensor_id = v_sid and r.observed_at = v_obs;
        if v_existing = v_val then
          v_status := 'duplicate';
        else
          v_status := 'rejected'; v_reason := 'conflicts_with_stored_value';
        end if;
      end if;
    end if;

    if v_status = 'accepted' then v_acc := v_acc + 1;
    elsif v_status = 'duplicate' then v_dup := v_dup + 1;
    else v_rej := v_rej + 1; end if;
    v_results := v_results || jsonb_build_object('index', v_idx, 'status', v_status, 'reason', v_reason);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('accepted', v_acc, 'duplicate', v_dup, 'rejected', v_rej, 'results', v_results);
end $$;

revoke all on function public.ingest_readings(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_readings(text, jsonb) to service_role;

-- DOWN: drop function public.ingest_readings(text, jsonb);
--   drop view public.forecast_latest, public.sensor_status;
--   drop table public.forecasts, public.readings;
--   alter table public.sensors drop constraint sensors_id_org_uq;
--   delete from public.role_permissions where permission_key = 'readings.write';
--   delete from public.permissions where key = 'readings.write';
