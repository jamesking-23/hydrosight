-- requires: postgis
-- 0007: devices with per-device credentials, device ingestion (clock skew, sequence, battery,
-- signal), quality control flags, calibration, gap handling, device health, realtime (Phase 3b).
--
-- Rules enforced in the DATABASE:
--  * A device key can only write readings for the sensors attached to that device.
--  * Raw readings are never overwritten: a trigger allows only the quality flag and the QC
--    timestamp to change. Calibration is applied at READ time; raw values are retained.
--  * Missing data stays missing. Interpolation is opt-in, never for rainfall, stored with
--    source_type 'estimated', and ignored by freshness and by the alert engine.
--  * QC never invents thresholds: range, spike, flatline and cross-sensor limits are per-sensor
--    configuration. Without configuration, readings stay 'unchecked' (never falsely 'good').

-- ---------------------------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------------------------
create table public.devices (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  station_id          uuid,
  name                text not null check (length(btrim(name)) between 1 and 80),
  serial              text check (serial is null or length(btrim(serial)) between 1 and 80),
  firmware            text,
  expected_interval_s integer not null check (expected_interval_s between 10 and 604800),
  offline_multiple    integer not null default 3 check (offline_multiple between 2 and 100),
  low_battery_pct     integer not null default 20 check (low_battery_pct between 0 and 100),
  weak_signal_dbm     integer not null default -100 check (weak_signal_dbm between -160 and 0),
  status              text not null default 'active' check (status in ('active', 'retired')),
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  retired_at          timestamptz,
  unique (id, org_id),
  foreign key (station_id, org_id) references public.stations (id, org_id)
);
create unique index devices_serial_uq on public.devices (org_id, serial) where serial is not null;
create index devices_org_idx on public.devices (org_id, status);

alter table public.sensors add column device_id uuid;
alter table public.sensors add constraint sensors_device_fk
  foreign key (device_id, org_id) references public.devices (id, org_id);
create index sensors_device_idx on public.sensors (device_id) where device_id is not null;

alter table public.api_keys add column device_id uuid references public.devices (id) on delete cascade;
create index api_keys_device_idx on public.api_keys (device_id) where device_id is not null;

create table public.device_health (
  device_id          uuid primary key references public.devices (id) on delete cascade,
  org_id             uuid not null,
  last_seen_at       timestamptz,
  battery_pct        real check (battery_pct is null or battery_pct between 0 and 100),
  signal_dbm         real,
  firmware           text,
  last_clock_skew_s  integer,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Readings: device metadata, QC state, immutability of raw data
-- ---------------------------------------------------------------------------------------------
alter table public.readings
  add column device_id          uuid,
  add column device_observed_at timestamptz,
  add column clock_skew_s       integer,
  add column sequence           bigint check (sequence is null or sequence >= 0),
  add column delayed            boolean not null default false,
  add column qc_at              timestamptz;

create function private.readings_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.org_id, new.sensor_id, new.observed_at, new.value, new.source_type, new.received_at,
      new.device_id, new.device_observed_at, new.clock_skew_s, new.sequence, new.delayed)
     is distinct from
     (old.org_id, old.sensor_id, old.observed_at, old.value, old.source_type, old.received_at,
      old.device_id, old.device_observed_at, old.clock_skew_s, old.sequence, old.delayed) then
    raise exception 'raw readings are immutable; only the quality flag may change' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger readings_guard before update on public.readings
  for each row execute function private.readings_guard();

create table public.sensor_qc_config (
  id                    uuid primary key default gen_random_uuid(),
  sensor_id             uuid not null unique,
  org_id                uuid not null,
  min_value             double precision,
  max_value             double precision,
  max_rate_per_hour     double precision check (max_rate_per_hour is null or max_rate_per_hour > 0),
  flatline_n            integer check (flatline_n is null or flatline_n >= 3),
  cross_sensor_max_diff double precision check (cross_sensor_max_diff is null or cross_sensor_max_diff >= 0),
  updated_by            uuid default auth.uid(),
  updated_at            timestamptz not null default now(),
  check (min_value is null or max_value is null or min_value <= max_value),
  foreign key (sensor_id, org_id) references public.sensors (id, org_id) on delete cascade
);

create table public.reading_flags (
  id         bigint generated always as identity primary key,
  reading_id bigint not null references public.readings (id) on delete cascade,
  org_id     uuid not null,
  sensor_id  uuid not null,
  check_name text not null check (check_name in
               ('range', 'spike', 'flatline', 'stale', 'duplicate_sequence', 'sequence_gap',
                'sequence_reset', 'cross_sensor', 'interpolated')),
  severity   text not null check (severity in ('info', 'suspect', 'bad')),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (reading_id, check_name)
);
create index reading_flags_sensor_idx on public.reading_flags (sensor_id, created_at desc);

create table public.calibrations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  sensor_id      uuid not null,
  scale          double precision not null default 1
                 check (scale <> 0 and scale > '-Infinity' and scale < 'Infinity'),
  offset_value   double precision not null default 0
                 check (offset_value > '-Infinity' and offset_value < 'Infinity'),
  effective_from timestamptz not null,
  note           text not null check (length(btrim(note)) >= 3),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  foreign key (sensor_id, org_id) references public.sensors (id, org_id) on delete cascade
);
create index calibrations_sensor_idx on public.calibrations (sensor_id, effective_from desc);
create trigger calibrations_append_only before update on public.calibrations
  for each row execute function private.forbid_change();

create trigger audit_devices after insert or update or delete on public.devices
  for each row execute function private.audit_row_change();
create trigger audit_calibrations after insert or update or delete on public.calibrations
  for each row execute function private.audit_row_change();
create trigger audit_sensor_qc_config after insert or update or delete on public.sensor_qc_config
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------------------------
alter table public.devices           enable row level security;
alter table public.device_health     enable row level security;
alter table public.sensor_qc_config  enable row level security;
alter table public.reading_flags     enable row level security;
alter table public.calibrations      enable row level security;
revoke all on public.devices, public.device_health, public.sensor_qc_config, public.reading_flags,
  public.calibrations from anon, authenticated, service_role;
grant select on public.devices, public.device_health, public.sensor_qc_config, public.reading_flags,
  public.calibrations to authenticated, service_role;

create policy devices_select on public.devices for select to authenticated
  using (private.has_permission(org_id, 'sensors.read') or private.is_demo_org(org_id));
create policy device_health_select on public.device_health for select to authenticated
  using (private.has_permission(org_id, 'sensors.read') or private.is_demo_org(org_id));
create policy qc_config_select on public.sensor_qc_config for select to authenticated
  using (private.has_permission(org_id, 'sensors.read') or private.is_demo_org(org_id));
create policy reading_flags_select on public.reading_flags for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.is_demo_org(org_id));
create policy calibrations_select on public.calibrations for select to authenticated
  using (private.has_permission(org_id, 'readings.read') or private.is_demo_org(org_id));

-- Calibration is applied when values are READ. Raw values stay in public.readings.
create function public.calibrated_value(p_sensor uuid, p_observed timestamptz, p_value double precision)
returns double precision
language sql stable set search_path = ''
as $$
  select coalesce(
    (select p_value * c.scale + c.offset_value
       from public.calibrations c
      where c.sensor_id = p_sensor and c.effective_from <= p_observed
      order by c.effective_from desc, c.created_at desc limit 1),
    p_value)
$$;
revoke all on function public.calibrated_value(uuid, timestamptz, double precision) from public, anon;
grant execute on function public.calibrated_value(uuid, timestamptz, double precision) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Ingestion: replaces 0005's function (same signature) to add device binding and metadata.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ingest_readings(p_key text, p_readings jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key_id   uuid;
  v_org      uuid;
  v_scopes   text[];
  v_dev      uuid;
  v_item     jsonb;
  v_idx      integer := 0;
  v_sid      uuid;
  v_obs      timestamptz;
  v_val      double precision;
  v_seq      bigint;
  v_devobs   timestamptz;
  v_skew     integer;
  v_kind     text;
  v_stype    public.source_type;
  v_interval integer;
  v_sdev     uuid;
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
  select device_id into v_dev from public.api_keys where id = v_key_id;
  if p_readings is null or jsonb_typeof(p_readings) <> 'array'
     or jsonb_array_length(p_readings) not between 1 and 1000 then
    raise exception 'readings must be an array of 1 to 1000 items' using errcode = '22023';
  end if;

  for v_item in select e from jsonb_array_elements(p_readings) e loop
    v_status := 'accepted'; v_reason := null; v_q := 'unchecked';
    v_seq := null; v_devobs := null; v_skew := null;
    begin
      if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item -> 'value'), '') <> 'number' then
        raise exception 'malformed';
      end if;
      v_sid := (v_item ->> 'sensor_id')::uuid;
      v_obs := (v_item ->> 'observed_at')::timestamptz;
      v_val := (v_item ->> 'value')::double precision;
      if coalesce(jsonb_typeof(v_item -> 'sequence'), 'null') <> 'null' then
        if jsonb_typeof(v_item -> 'sequence') <> 'number' or (v_item ->> 'sequence')::numeric < 0 then
          raise exception 'malformed';
        end if;
        v_seq := ((v_item ->> 'sequence')::numeric)::bigint;
      end if;
      if coalesce(jsonb_typeof(v_item -> 'device_observed_at'), 'null') <> 'null' then
        v_devobs := (v_item ->> 'device_observed_at')::timestamptz;
      end if;
      if coalesce(jsonb_typeof(v_item -> 'clock_skew_s'), 'null') <> 'null' then
        v_skew := (v_item ->> 'clock_skew_s')::integer;
      end if;
    exception when others then
      v_status := 'rejected'; v_reason := 'malformed';
    end;

    if v_status = 'accepted' then
      select s.kind, s.source_type, s.expected_interval_s, s.device_id
        into v_kind, v_stype, v_interval, v_sdev
        from public.sensors s where s.id = v_sid and s.org_id = v_org;
      if not found then
        v_status := 'rejected'; v_reason := 'unknown_sensor';
      elsif v_dev is not null and v_sdev is distinct from v_dev then
        v_status := 'rejected'; v_reason := 'sensor_not_on_device';
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
      insert into public.readings (org_id, sensor_id, observed_at, value, quality, source_type, api_key_id,
                                   device_id, device_observed_at, clock_skew_s, sequence, delayed)
      values (v_org, v_sid, v_obs, v_val, v_q, v_stype, v_key_id,
              v_sdev, v_devobs, v_skew, v_seq,
              now() - v_obs > v_interval * 2 * interval '1 second')
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

  if v_dev is not null then
    insert into public.device_health (device_id, org_id, last_seen_at) values (v_dev, v_org, now())
    on conflict (device_id) do update set last_seen_at = now(), updated_at = now();
  end if;
  return jsonb_build_object('accepted', v_acc, 'duplicate', v_dup, 'rejected', v_rej, 'results', v_results);
end $$;

-- Device batch: { sent_at?, battery_pct?, signal_dbm?, firmware?, readings: [ {sensor_id, observed_at,
-- value, sequence?} ] }. Requires a device-bound key. Corrects device clock skew (server time minus
-- device send time) when it exceeds 60 s; the original device timestamp and the skew are kept.
create function public.ingest_device_batch(p_key text, p_batch jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_key_id uuid; v_org uuid; v_scopes text[]; v_dev uuid;
  v_sent   timestamptz;
  v_skew   bigint;
  v_corr   boolean := false;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_orig   timestamptz;
  v_res    jsonb;
  v_batt   real;
  v_sig    real;
  v_fw     text;
begin
  select k.key_id, k.key_org_id, k.key_scopes into v_key_id, v_org, v_scopes
    from public.verify_api_key(p_key) k;
  if v_key_id is null then
    raise exception 'invalid api key' using errcode = '28000';
  end if;
  if not ('readings.write' = any (v_scopes)) then
    raise exception 'api key lacks scope readings.write' using errcode = '42501';
  end if;
  select device_id into v_dev from public.api_keys where id = v_key_id;
  if v_dev is null then
    raise exception 'api key is not bound to a device' using errcode = '42501';
  end if;
  if not exists (select 1 from public.devices where id = v_dev and status = 'active') then
    raise exception 'device is retired' using errcode = '42501';
  end if;
  if p_batch is null or jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_batch -> 'readings') <> 'array' then
    raise exception 'batch must be an object with a readings array' using errcode = '22023';
  end if;
  begin
    v_sent := (p_batch ->> 'sent_at')::timestamptz;
  exception when others then
    raise exception 'sent_at is not a valid timestamp' using errcode = '22023';
  end;
  if v_sent is not null then
    v_skew := round(extract(epoch from (now() - v_sent)));
    if abs(v_skew) > 2592000 then
      raise exception 'device clock is unreliable (more than 30 days from server time); fix the device clock'
        using errcode = '22023';
    end if;
    v_corr := abs(v_skew) > 60;
  end if;

  for v_item in select e from jsonb_array_elements(p_batch -> 'readings') e loop
    begin
      if jsonb_typeof(v_item) = 'object' and v_sent is not null then
        v_orig := (v_item ->> 'observed_at')::timestamptz;
        v_item := v_item || jsonb_build_object(
          'device_observed_at', v_orig,
          'clock_skew_s', v_skew,
          'observed_at', case when v_corr then v_orig + v_skew * interval '1 second' else v_orig end);
      end if;
    exception when others then
      null;  -- an unparsable timestamp is passed through and rejected as malformed per item
    end;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  v_res := public.ingest_readings(p_key, v_items);

  if jsonb_typeof(p_batch -> 'battery_pct') = 'number'
     and (p_batch ->> 'battery_pct')::numeric between 0 and 100 then
    v_batt := (p_batch ->> 'battery_pct')::real;
  end if;
  if jsonb_typeof(p_batch -> 'signal_dbm') = 'number'
     and (p_batch ->> 'signal_dbm')::numeric between -160 and 0 then
    v_sig := (p_batch ->> 'signal_dbm')::real;
  end if;
  if jsonb_typeof(p_batch -> 'firmware') = 'string' then v_fw := left(p_batch ->> 'firmware', 60); end if;
  update public.device_health set
      battery_pct = coalesce(v_batt, battery_pct), signal_dbm = coalesce(v_sig, signal_dbm),
      firmware = coalesce(v_fw, firmware), last_clock_skew_s = coalesce(v_skew::integer, last_clock_skew_s)
   where device_id = v_dev;
  return v_res || jsonb_build_object('device_id', v_dev, 'clock_skew_s', v_skew, 'skew_corrected', v_corr);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Quality control: flags only. Never edits or deletes a raw value.
-- ---------------------------------------------------------------------------------------------
create function public.run_qc(p_sensors uuid[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r        record;
  c        public.sensor_qc_config;
  p        record;
  v_val    double precision;
  v_pval   double precision;
  v_dt     double precision;
  v_n      integer;
  v_dist   integer;
  v_other  double precision;
  v_flags  jsonb;
  f        jsonb;
  v_q      public.quality_flag;
  v_cfg    boolean;
  v_total  integer := 0;
  v_good   integer := 0;
  v_susp   integer := 0;
  v_bad    integer := 0;
  v_unch   integer := 0;
  v_nflags integer := 0;
begin
  for r in
    select rd.id as reading_id, rd.org_id, rd.sensor_id, rd.observed_at, rd.value, rd.received_at,
           rd.sequence, s.kind, s.expected_interval_s, s.station_id
      from public.readings rd
      join public.sensors s on s.id = rd.sensor_id
     where rd.qc_at is null and rd.source_type <> 'estimated' and rd.quality <> 'suspect'
       and (p_sensors is null or rd.sensor_id = any (p_sensors))
     order by rd.sensor_id, rd.observed_at
  loop
    v_total := v_total + 1;
    v_flags := '[]'::jsonb;
    select * into c from public.sensor_qc_config where sensor_id = r.sensor_id;
    v_cfg := found;
    v_val := public.calibrated_value(r.sensor_id, r.observed_at, r.value);

    select x.id, x.observed_at, x.value, x.sequence into p
      from public.readings x
     where x.sensor_id = r.sensor_id and x.observed_at < r.observed_at
       and x.source_type <> 'estimated' and x.quality <> 'bad'
     order by x.observed_at desc limit 1;
    if found then
      v_pval := public.calibrated_value(r.sensor_id, p.observed_at, p.value);
      v_dt := greatest(extract(epoch from r.observed_at - p.observed_at), 1);
    end if;

    if v_cfg and ((c.min_value is not null and v_val < c.min_value)
               or (c.max_value is not null and v_val > c.max_value)) then
      v_flags := v_flags || jsonb_build_object('check', 'range', 'severity', 'bad',
        'detail', jsonb_build_object('value', v_val, 'min', c.min_value, 'max', c.max_value));
    end if;
    if v_cfg and c.max_rate_per_hour is not null and p.id is not null
       and abs(v_val - v_pval) / (v_dt / 3600.0) > c.max_rate_per_hour then
      v_flags := v_flags || jsonb_build_object('check', 'spike', 'severity', 'suspect',
        'detail', jsonb_build_object('previous', v_pval, 'value', v_val, 'seconds', v_dt,
                                     'max_rate_per_hour', c.max_rate_per_hour));
    end if;
    if v_cfg and c.flatline_n is not null then
      select count(*), count(distinct public.calibrated_value(r.sensor_id, y.observed_at, y.value))
        into v_n, v_dist
        from (select z.observed_at, z.value from public.readings z
               where z.sensor_id = r.sensor_id and z.observed_at <= r.observed_at and z.source_type <> 'estimated'
               order by z.observed_at desc limit c.flatline_n) y;
      if v_n = c.flatline_n and v_dist = 1 then
        v_flags := v_flags || jsonb_build_object('check', 'flatline', 'severity', 'suspect',
          'detail', jsonb_build_object('identical_readings', v_n, 'value', v_val));
      end if;
    end if;
    if r.received_at - r.observed_at > r.expected_interval_s * 10 * interval '1 second' then
      v_flags := v_flags || jsonb_build_object('check', 'stale', 'severity', 'info',
        'detail', jsonb_build_object('late_by_seconds', round(extract(epoch from r.received_at - r.observed_at))));
    end if;
    if r.sequence is not null then
      if exists (select 1 from public.readings x where x.sensor_id = r.sensor_id and x.sequence = r.sequence
                    and x.id <> r.reading_id) then
        v_flags := v_flags || jsonb_build_object('check', 'duplicate_sequence', 'severity', 'suspect',
          'detail', jsonb_build_object('sequence', r.sequence));
      elsif p.sequence is not null and r.sequence > p.sequence + 1 then
        v_flags := v_flags || jsonb_build_object('check', 'sequence_gap', 'severity', 'info',
          'detail', jsonb_build_object('previous', p.sequence, 'sequence', r.sequence,
                                       'missing', r.sequence - p.sequence - 1));
      elsif p.sequence is not null and r.sequence < p.sequence then
        v_flags := v_flags || jsonb_build_object('check', 'sequence_reset', 'severity', 'info',
          'detail', jsonb_build_object('previous', p.sequence, 'sequence', r.sequence));
      end if;
    end if;
    if v_cfg and c.cross_sensor_max_diff is not null then
      select public.calibrated_value(o.sensor_id, o.observed_at, o.value) into v_other
        from public.readings o join public.sensors os on os.id = o.sensor_id
       where os.station_id = r.station_id and os.kind = r.kind and os.org_id = r.org_id
         and o.sensor_id <> r.sensor_id and o.source_type <> 'estimated' and o.quality <> 'bad'
         and abs(extract(epoch from o.observed_at - r.observed_at)) <= r.expected_interval_s / 2.0
       order by abs(extract(epoch from o.observed_at - r.observed_at)) limit 1;
      if v_other is not null and abs(v_val - v_other) > c.cross_sensor_max_diff then
        v_flags := v_flags || jsonb_build_object('check', 'cross_sensor', 'severity', 'suspect',
          'detail', jsonb_build_object('value', v_val, 'other_sensor_value', v_other,
                                       'max_difference', c.cross_sensor_max_diff));
      end if;
    end if;

    v_q := case
      when exists (select 1 from jsonb_array_elements(v_flags) e where e ->> 'severity' = 'bad') then 'bad'
      when exists (select 1 from jsonb_array_elements(v_flags) e where e ->> 'severity' = 'suspect') then 'suspect'
      when v_cfg then 'good'
      else 'unchecked' end;
    for f in select e from jsonb_array_elements(v_flags) e loop
      insert into public.reading_flags (reading_id, org_id, sensor_id, check_name, severity, detail)
      values (r.reading_id, r.org_id, r.sensor_id, f ->> 'check', f ->> 'severity', f -> 'detail')
      on conflict (reading_id, check_name) do nothing;
      v_nflags := v_nflags + 1;
    end loop;
    update public.readings set quality = v_q, qc_at = now() where id = r.reading_id;
    if v_q = 'good' then v_good := v_good + 1;
    elsif v_q = 'suspect' then v_susp := v_susp + 1;
    elsif v_q = 'bad' then v_bad := v_bad + 1;
    else v_unch := v_unch + 1; end if;
  end loop;
  return jsonb_build_object('processed', v_total, 'good', v_good, 'suspect', v_susp, 'bad', v_bad,
                            'unchecked_no_config', v_unch, 'flags', v_nflags);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gaps: missing stays missing. Interpolation is opt-in and stored as 'estimated'.
-- ---------------------------------------------------------------------------------------------
create function public.sensor_gaps(p_sensor uuid, p_from timestamptz, p_to timestamptz)
returns table (gap_start timestamptz, gap_end timestamptz, missing_intervals integer, has_estimates boolean)
language sql stable set search_path = ''
as $$
  with s as (select expected_interval_s as e from public.sensors where id = p_sensor),
  r as (
    select observed_at as t, lead(observed_at) over (order by observed_at) as nxt
      from public.readings
     where sensor_id = p_sensor and observed_at between p_from and p_to and source_type <> 'estimated'
  )
  select r.t, r.nxt,
         (floor(extract(epoch from r.nxt - r.t) / s.e) - 1)::integer,
         exists (select 1 from public.readings x where x.sensor_id = p_sensor
                  and x.source_type = 'estimated' and x.observed_at > r.t and x.observed_at < r.nxt)
    from r cross join s
   where r.nxt is not null and extract(epoch from r.nxt - r.t) > s.e * 1.5
   order by r.t
$$;
revoke all on function public.sensor_gaps(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.sensor_gaps(uuid, timestamptz, timestamptz) to authenticated, service_role;

create function public.interpolate_gap(p_sensor uuid, p_from timestamptz, p_to timestamptz) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s      public.sensors;
  a      public.readings;
  b      public.readings;
  v_n    integer;
  v_secs double precision;
begin
  select * into s from public.sensors where id = p_sensor;
  if not found or auth.uid() is null or not private.has_permission(s.org_id, 'devices.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if s.kind = 'rainfall' then
    raise exception 'interpolation is not offered for rainfall' using errcode = '22023';
  end if;
  select * into a from public.readings where sensor_id = p_sensor and observed_at = p_from
     and source_type <> 'estimated' and quality in ('unchecked', 'good');
  select * into b from public.readings where sensor_id = p_sensor and observed_at = p_to
     and source_type <> 'estimated' and quality in ('unchecked', 'good');
  if a.id is null or b.id is null or p_to <= p_from then
    raise exception 'both ends of the gap must be existing, unflagged readings' using errcode = '22023';
  end if;
  if exists (select 1 from public.readings where sensor_id = p_sensor and observed_at > p_from
               and observed_at < p_to and source_type <> 'estimated') then
    raise exception 'not a gap: readings exist between the two ends' using errcode = '22023';
  end if;
  v_secs := extract(epoch from p_to - p_from);
  if v_secs > s.expected_interval_s * 12 then
    raise exception 'gap is too long to estimate (maximum 12 expected intervals)' using errcode = '22023';
  end if;
  v_n := floor(v_secs / s.expected_interval_s)::integer - 1;
  if v_n < 1 then return 0; end if;
  with ins as (
    insert into public.readings (org_id, sensor_id, observed_at, value, quality, source_type, device_id)
    select s.org_id, s.id, p_from + (i * s.expected_interval_s) * interval '1 second',
           a.value + (b.value - a.value) * (i * s.expected_interval_s) / v_secs,
           'unchecked', 'estimated', s.device_id
      from generate_series(1, v_n) i
    on conflict (sensor_id, observed_at) do nothing
    returning id, org_id, sensor_id
  )
  insert into public.reading_flags (reading_id, org_id, sensor_id, check_name, severity, detail)
  select id, org_id, sensor_id, 'interpolated', 'info',
         jsonb_build_object('method', 'linear', 'from_reading', a.id, 'to_reading', b.id)
    from ins;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Calibration and QC configuration (permission: devices.manage)
-- ---------------------------------------------------------------------------------------------
create function public.add_calibration(p_sensor uuid, p_scale double precision, p_offset double precision,
                                       p_effective_from timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare s public.sensors; v_id uuid;
begin
  select * into s from public.sensors where id = p_sensor;
  if not found or auth.uid() is null or not private.has_permission(s.org_id, 'devices.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.calibrations (org_id, sensor_id, scale, offset_value, effective_from, note)
  values (s.org_id, p_sensor, coalesce(p_scale, 1), coalesce(p_offset, 0), p_effective_from, p_note)
  returning id into v_id;
  return v_id;
end $$;

create function public.set_sensor_qc_config(p_sensor uuid, p_min double precision, p_max double precision,
                                            p_rate double precision, p_flatline_n integer,
                                            p_cross_diff double precision) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.sensors;
begin
  select * into s from public.sensors where id = p_sensor;
  if not found or auth.uid() is null or not private.has_permission(s.org_id, 'devices.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.sensor_qc_config (sensor_id, org_id, min_value, max_value, max_rate_per_hour,
                                       flatline_n, cross_sensor_max_diff)
  values (p_sensor, s.org_id, p_min, p_max, p_rate, p_flatline_n, p_cross_diff)
  on conflict (sensor_id) do update set min_value = excluded.min_value, max_value = excluded.max_value,
    max_rate_per_hour = excluded.max_rate_per_hour, flatline_n = excluded.flatline_n,
    cross_sensor_max_diff = excluded.cross_sensor_max_diff, updated_by = auth.uid(), updated_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- Device registry: provisioning, credential rotation, retirement (permission: devices.manage)
-- ---------------------------------------------------------------------------------------------
create function private.issue_device_key(p_org uuid, p_device uuid, p_name text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_prefix text; v_key text;
begin
  v_prefix := substr(private.random_token(), 1, 8);
  v_key := 'hsk_' || v_prefix || '_' || private.random_token();
  insert into public.api_keys (org_id, name, key_prefix, key_hash, scopes, created_by, device_id)
  values (p_org, left('device: ' || p_name, 80), v_prefix, private.hash_secret(v_key),
          array['readings.write'], auth.uid(), p_device);
  return v_key;
end $$;
revoke all on function private.issue_device_key(uuid, uuid, text) from public, anon, authenticated, service_role;

create function public.set_device_sensors(p_device uuid, p_sensors uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare d public.devices; v_bad integer;
begin
  select * into d from public.devices where id = p_device;
  if not found or auth.uid() is null or not private.has_permission(d.org_id, 'devices.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select count(*) into v_bad from unnest(coalesce(p_sensors, '{}')) x(id)
   where not exists (select 1 from public.sensors s where s.id = x.id and s.org_id = d.org_id
                       and (d.station_id is null or s.station_id = d.station_id)
                       and (s.device_id is null or s.device_id = d.id));
  if v_bad > 0 then
    raise exception 'sensors must belong to this organisation and station and not be on another device'
      using errcode = '22023';
  end if;
  update public.sensors set device_id = null where device_id = p_device and id <> all (coalesce(p_sensors, '{}'));
  update public.sensors set device_id = p_device where id = any (coalesce(p_sensors, '{}'));
end $$;

create function public.provision_device(p_org uuid, p_name text, p_station uuid, p_interval integer,
                                        p_sensors uuid[], p_serial text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_key text;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'devices.manage')
     or not private.has_permission(p_org, 'readings.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_station is not null and not exists (select 1 from public.stations where id = p_station and org_id = p_org) then
    raise exception 'unknown station' using errcode = '22023';
  end if;
  insert into public.devices (org_id, station_id, name, serial, expected_interval_s)
  values (p_org, p_station, btrim(p_name), nullif(btrim(p_serial), ''), p_interval)
  returning id into v_id;
  perform public.set_device_sensors(v_id, p_sensors);
  insert into public.device_health (device_id, org_id) values (v_id, p_org);
  v_key := private.issue_device_key(p_org, v_id, btrim(p_name));
  return jsonb_build_object('device_id', v_id, 'api_key', v_key);  -- the key is shown once
end $$;

create function public.rotate_device_key(p_device uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare d public.devices;
begin
  select * into d from public.devices where id = p_device for update;
  if not found or auth.uid() is null or not private.has_permission(d.org_id, 'devices.manage')
     or not private.has_permission(d.org_id, 'readings.write') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if d.status <> 'active' then
    raise exception 'device is retired' using errcode = '55000';
  end if;
  update public.api_keys set revoked_at = now() where device_id = p_device and revoked_at is null;
  return private.issue_device_key(d.org_id, d.id, d.name);
end $$;

create function public.retire_device(p_device uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare d public.devices;
begin
  select * into d from public.devices where id = p_device for update;
  if not found or auth.uid() is null or not private.has_permission(d.org_id, 'devices.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.api_keys set revoked_at = now() where device_id = p_device and revoked_at is null;
  update public.devices set status = 'retired', retired_at = now() where id = p_device and status = 'active';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Views: freshness (calibrated, estimates excluded) and device health
-- ---------------------------------------------------------------------------------------------
create or replace view public.sensor_status with (security_invoker = true) as
select s.id as sensor_id, s.org_id, s.station_id, s.kind, s.unit, s.expected_interval_s,
       s.source_type, l.observed_at as last_observed_at,
       public.calibrated_value(s.id, l.observed_at, l.value) as last_value,
       l.quality as last_quality,
       case
         when l.observed_at is null then 'never_reported'
         when now() - l.observed_at <= s.expected_interval_s * 2 * interval '1 second' then 'live'
         when now() - l.observed_at <= s.expected_interval_s * 10 * interval '1 second' then 'stale'
         else 'offline'
       end as freshness,
       l.value as last_raw_value,
       exists (select 1 from public.calibrations c where c.sensor_id = s.id
                 and c.effective_from <= coalesce(l.observed_at, now())) as calibrated,
       s.device_id
from public.sensors s
left join lateral (
  select r.observed_at, r.value, r.quality
  from public.readings r where r.sensor_id = s.id and r.source_type <> 'estimated'
  order by r.observed_at desc limit 1
) l on true;

create view public.readings_calibrated with (security_invoker = true) as
select r.id, r.org_id, r.sensor_id, r.observed_at, r.value as raw_value,
       public.calibrated_value(r.sensor_id, r.observed_at, r.value) as value,
       r.quality, r.source_type, r.received_at, r.delayed, r.clock_skew_s, r.sequence, r.device_id
from public.readings r;

create view public.device_status with (security_invoker = true) as
select d.id as device_id, d.org_id, d.station_id, d.name, d.expected_interval_s, d.offline_multiple,
       h.last_seen_at, h.battery_pct, h.signal_dbm, h.last_clock_skew_s, h.firmware,
       case
         when h.last_seen_at is null
              or now() - h.last_seen_at > d.expected_interval_s * d.offline_multiple * interval '1 second' then 'offline'
         when array_length(x.reasons, 1) > 0 then 'degraded'
         else 'online'
       end as status,
       case
         when h.last_seen_at is null then array['never_reported']
         when now() - h.last_seen_at > d.expected_interval_s * d.offline_multiple * interval '1 second'
           then array['no_contact_within_' || d.offline_multiple || 'x_interval']
         else x.reasons
       end as reasons
from public.devices d
left join public.device_health h on h.device_id = d.id
cross join lateral (
  select array_remove(array[
    case when h.battery_pct is not null and h.battery_pct <= d.low_battery_pct then 'low_battery' end,
    case when h.signal_dbm is not null and h.signal_dbm <= d.weak_signal_dbm then 'weak_signal' end,
    case when abs(coalesce(h.last_clock_skew_s, 0)) > 300 then 'clock_skew' end,
    case when exists (select 1 from public.reading_flags f join public.sensors s2 on s2.id = f.sensor_id
                       where s2.device_id = d.id and f.severity <> 'info'
                         and f.created_at > now() - interval '1 hour') then 'recent_quality_flags' end
  ], null) as reasons
) x
where d.status = 'active';

revoke all on public.readings_calibrated, public.device_status from anon, authenticated, service_role;
grant select on public.readings_calibrated, public.device_status to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Alert engine: now evaluates CALIBRATED values, skips estimated and 'bad' readings, and still
-- evaluates 'suspect' readings (a QC flag must never silently suppress a possible flood; the
-- draft's evidence shows the quality so the human reviewer decides).
-- ---------------------------------------------------------------------------------------------
create or replace function public.evaluate_thresholds_for(p_sensors uuid[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r         record;
  v_armed   boolean;
  v_breach  boolean;
  v_key     text;
  v_eval    integer := 0;
  v_created integer := 0;
  v_dup     integer := 0;
  v_cool    integer := 0;
  v_maint   integer := 0;
  v_notlive integer := 0;
  v_rearm   integer := 0;
begin
  for r in
    select ru.id as rule_id, ru.org_id, ru.name as rule_name, ru.comparator, ru.threshold_value, ru.level,
           ru.hysteresis, ru.cooldown_s, ru.rationale, ru.evidence_ref,
           s.id as sensor_id, s.station_id, s.kind, s.unit, s.expected_interval_s, st.name as station_name,
           l.id as reading_id, l.observed_at, l.value, l.raw_value, l.quality, l.source_type
      from public.threshold_rules ru
      join public.sensors s on s.org_id = ru.org_id
      join public.stations st on st.id = s.station_id and st.org_id = s.org_id
      join lateral (
        select rd.id, rd.observed_at, public.calibrated_value(s.id, rd.observed_at, rd.value) as value,
               rd.value as raw_value, rd.quality, rd.source_type
          from public.readings rd
         where rd.sensor_id = s.id and rd.quality in ('unchecked', 'good', 'suspect')
           and rd.source_type <> 'estimated'
         order by rd.observed_at desc limit 1
      ) l on true
     where ru.status = 'active'
       and (p_sensors is null or s.id = any (p_sensors))
       and case ru.scope
             when 'sensor' then s.id = ru.scope_id
             when 'river' then st.river_id = ru.scope_id and s.kind = ru.sensor_kind
             when 'catchment' then st.catchment_id = ru.scope_id and s.kind = ru.sensor_kind
             when 'location' then st.location_id = ru.scope_id and s.kind = ru.sensor_kind
             else s.kind = ru.sensor_kind
           end
  loop
    v_eval := v_eval + 1;
    if now() - r.observed_at > r.expected_interval_s * 2 * interval '1 second' then
      v_notlive := v_notlive + 1; continue;
    end if;
    if exists (select 1 from public.maintenance_windows w
                where w.org_id = r.org_id and now() >= w.starts_at and now() < w.ends_at
                  and (w.sensor_id = r.sensor_id or w.station_id = r.station_id)) then
      v_maint := v_maint + 1; continue;
    end if;
    insert into public.rule_states (rule_id, sensor_id) values (r.rule_id, r.sensor_id) on conflict do nothing;
    select armed into v_armed from public.rule_states where rule_id = r.rule_id and sensor_id = r.sensor_id;
    v_breach := (r.comparator = '>=' and r.value >= r.threshold_value)
             or (r.comparator = '<=' and r.value <= r.threshold_value);
    if not v_breach then
      if not v_armed and ((r.comparator = '>=' and r.value < r.threshold_value - r.hysteresis)
                       or (r.comparator = '<=' and r.value > r.threshold_value + r.hysteresis)) then
        update public.rule_states set armed = true, updated_at = now()
         where rule_id = r.rule_id and sensor_id = r.sensor_id;
        v_rearm := v_rearm + 1;
      end if;
      continue;
    end if;
    v_key := r.rule_id::text || ':' || r.sensor_id::text;
    if not v_armed or exists (select 1 from public.alerts a where a.dedup_key = v_key
                                 and a.status in ('draft', 'in_review', 'approved', 'published')) then
      update public.rule_states set armed = false, updated_at = now() where rule_id = r.rule_id and sensor_id = r.sensor_id;
      v_dup := v_dup + 1; continue;
    end if;
    if exists (select 1 from public.alerts a where a.dedup_key = v_key
                  and a.created_at > now() - r.cooldown_s * interval '1 second') then
      v_cool := v_cool + 1; continue;
    end if;
    insert into public.alerts (org_id, origin, audience, level, title, location_text, station_id, sensor_id, rule_id,
                               trigger_reading_id, evidence, confidence, dedup_key)
    values (r.org_id, 'sensor_threshold', 'internal', r.level,
            format('%s %s %s %s at %s', initcap(replace(r.kind, '_', ' ')), r.comparator, r.threshold_value, r.unit, r.station_name),
            r.station_name, r.station_id, r.sensor_id, r.rule_id, r.reading_id,
            jsonb_build_array(jsonb_build_object(
              'type', 'reading', 'reading_id', r.reading_id, 'sensor_id', r.sensor_id, 'observed_at', r.observed_at,
              'value', r.value, 'raw_value', r.raw_value, 'unit', r.unit, 'source_type', r.source_type,
              'quality', r.quality, 'rule_id', r.rule_id, 'rule_name', r.rule_name,
              'rule_rationale', r.rationale, 'rule_evidence_ref', r.evidence_ref)),
            'not_assessed', v_key);
    update public.rule_states set armed = false, updated_at = now() where rule_id = r.rule_id and sensor_id = r.sensor_id;
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('evaluated', v_eval, 'created', v_created, 'duplicate_suppressed', v_dup,
                            'cooldown_suppressed', v_cool, 'maintenance_suppressed', v_maint,
                            'skipped_not_live', v_notlive, 'rearmed', v_rearm);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Execute rights
-- ---------------------------------------------------------------------------------------------
revoke all on function
  public.ingest_device_batch(text, jsonb), public.run_qc(uuid[]),
  public.interpolate_gap(uuid, timestamptz, timestamptz),
  public.add_calibration(uuid, double precision, double precision, timestamptz, text),
  public.set_sensor_qc_config(uuid, double precision, double precision, double precision, integer, double precision),
  public.set_device_sensors(uuid, uuid[]),
  public.provision_device(uuid, text, uuid, integer, uuid[], text),
  public.rotate_device_key(uuid), public.retire_device(uuid)
  from public, anon, authenticated;
grant execute on function public.ingest_device_batch(text, jsonb), public.run_qc(uuid[]) to service_role;
grant execute on function
  public.interpolate_gap(uuid, timestamptz, timestamptz),
  public.add_calibration(uuid, double precision, double precision, timestamptz, text),
  public.set_sensor_qc_config(uuid, double precision, double precision, double precision, integer, double precision),
  public.set_device_sensors(uuid, uuid[]),
  public.provision_device(uuid, text, uuid, integer, uuid[], text),
  public.rotate_device_key(uuid), public.retire_device(uuid)
  to authenticated;

-- Live updates in the UI use Supabase Realtime, which applies row-level security per subscriber.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.readings, public.device_health, public.alerts;
  end if;
end $$;

-- DOWN (manual): drop views device_status, readings_calibrated; restore sensor_status from 0005;
--   drop functions in this file; restore ingest_readings (0005) and evaluate_thresholds_for (0006);
--   drop tables calibrations, reading_flags, sensor_qc_config, device_health; drop trigger
--   readings_guard; alter table readings drop columns device_id, device_observed_at, clock_skew_s,
--   sequence, delayed, qc_at; alter table api_keys drop column device_id; alter table sensors drop
--   column device_id; drop table devices.
