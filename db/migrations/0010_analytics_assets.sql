-- requires: postgis
-- 0010: analytics, reports and asset risk (Phase 7).
--
-- Design rules enforced here:
--  * Nothing is invented. Elevation is whatever the user supplied with its source (no DEM is
--    integrated). Distance to waterways uses only imported river geometry. Hazard intersection
--    uses only hazard zones a person loaded with a mandatory source and licence. Where a layer
--    is missing the indicator says "not_assessed", never "safe".
--  * Financial values exist only if the user supplied amount, currency and basis. The exposure
--    function reports the supplied value of assets inside a loaded hazard zone, labelled as an
--    assumption-based figure. It applies no damage curve and estimates no loss.
--  * Analytics are SECURITY INVOKER: row-level security decides what each person can see.
--  * Every report export is logged (who, what, window, content hash). The log is append-only.

insert into public.permissions (key, description, privileged) values
  ('assets.read',   'View assets and their exposure', false),
  ('assets.manage', 'Register and retire assets, set user-supplied values', false),
  ('hazard.manage', 'Load hazard zones with source and licence', false);
insert into public.role_permissions (role_key, permission_key) values
  ('org_admin', 'assets.read'), ('org_admin', 'assets.manage'), ('org_admin', 'hazard.manage'),
  ('government_authority', 'assets.read'),
  ('hydrologist', 'assets.read'), ('hydrologist', 'assets.manage'), ('hydrologist', 'hazard.manage'),
  ('meteorologist', 'assets.read'),
  ('emergency_response_officer', 'assets.read'),
  ('enterprise_customer', 'assets.read'), ('enterprise_customer', 'assets.manage');

-- ---------------------------------------------------------------------------------------------
-- Hazard zones (loaded by a person, with provenance; unvalidated until promoted elsewhere)
-- ---------------------------------------------------------------------------------------------
create table public.hazard_zones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  scenario    text not null check (length(btrim(scenario)) between 3 and 200),  -- as labelled by the source
  source      text not null check (length(btrim(source)) >= 3),
  licence     text not null check (length(btrim(licence)) >= 3),
  source_type public.source_type not null check (source_type in ('measured', 'estimated', 'synthetic')),
  geom        extensions.geometry(MultiPolygon, 4326) not null,
  status      public.service_status not null default 'unvalidated' check (status = 'unvalidated'),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check (extensions.st_isvalid(geom))
);
create index hazard_zones_org_idx on public.hazard_zones (org_id);
create index hazard_zones_geom_gix on public.hazard_zones using gist (geom);

-- ---------------------------------------------------------------------------------------------
-- Assets (point or polygon)
-- ---------------------------------------------------------------------------------------------
create table public.assets (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 120),
  kind                  text not null check (kind in ('building', 'road', 'bridge', 'school', 'health_facility',
                                                      'farmland', 'utility', 'water_supply', 'other')),
  geom                  extensions.geometry(Geometry, 4326) not null,
  elevation_m           numeric(8, 2),
  elevation_source_type public.source_type,
  value_amount          numeric(18, 2) check (value_amount >= 0),
  value_currency        text check (value_currency ~ '^[A-Z]{3}$'),
  value_basis           text check (length(btrim(value_basis)) >= 10),
  notes                 text,
  source_type           public.source_type not null check (source_type in ('measured', 'estimated', 'community', 'synthetic')),
  status                public.service_status not null default 'unvalidated' check (status = 'unvalidated'),
  retired_at            timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  check (extensions.geometrytype(geom) in ('POINT', 'POLYGON', 'MULTIPOLYGON')),
  check (extensions.st_isvalid(geom)),
  check (extensions.st_xmin(geom) >= -180 and extensions.st_xmax(geom) <= 180
         and extensions.st_ymin(geom) >= -90 and extensions.st_ymax(geom) <= 90),
  check ((elevation_m is null) = (elevation_source_type is null)),
  check ((value_amount is null) = (value_currency is null) and (value_amount is null) = (value_basis is null))
);
create index assets_org_idx on public.assets (org_id) where retired_at is null;
create index assets_geom_gix on public.assets using gist (geom);

create table public.report_exports (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  kind           text not null check (kind in ('analytics', 'assets')),
  format         text not null check (format in ('csv', 'xlsx', 'pdf')),
  window_start   timestamptz,
  window_end     timestamptz,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  summary        jsonb not null default '{}'::jsonb,
  generated_by   uuid not null,
  generated_at   timestamptz not null default now()
);
create index report_exports_org_idx on public.report_exports (org_id, generated_at desc);

create trigger report_exports_immutable before update or delete on public.report_exports
  for each row execute function private.forbid_change();
create trigger audit_assets after insert or update or delete on public.assets
  for each row execute function private.audit_row_change();
create trigger audit_hazard_zones after insert or update or delete on public.hazard_zones
  for each row execute function private.audit_row_change();

alter table public.hazard_zones   enable row level security;
alter table public.assets         enable row level security;
alter table public.report_exports enable row level security;
revoke all on public.hazard_zones, public.assets, public.report_exports from anon, authenticated, service_role;
grant select on public.hazard_zones, public.assets, public.report_exports to authenticated, service_role;

create policy hazard_zones_select on public.hazard_zones for select to authenticated
  using (private.has_permission(org_id, 'assets.read') or private.is_demo_org(org_id));
create policy assets_select on public.assets for select to authenticated
  using (private.has_permission(org_id, 'assets.read') or private.is_demo_org(org_id));
create policy report_exports_select on public.report_exports for select to authenticated
  using (private.has_permission(org_id, 'assets.read') or private.has_permission(org_id, 'readings.read'));

-- ---------------------------------------------------------------------------------------------
-- Writers (permission checked inside)
-- ---------------------------------------------------------------------------------------------
create function private.geom_from_geojson(p_geojson text) returns extensions.geometry
language plpgsql immutable set search_path = ''
as $$
declare g extensions.geometry;
begin
  begin
    g := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson), 4326);
  exception when others then
    raise exception 'geometry is not valid GeoJSON' using errcode = '22023';
  end;
  if g is null or not extensions.st_isvalid(g) then
    raise exception 'geometry is empty or invalid' using errcode = '22023';
  end if;
  return g;
end $$;

create function public.add_asset(
  p_org uuid, p_name text, p_kind text, p_geojson text,
  p_elevation_m numeric default null, p_elevation_source public.source_type default null,
  p_value_amount numeric default null, p_value_currency text default null, p_value_basis text default null,
  p_notes text default null, p_source_type public.source_type default 'estimated'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'assets.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.assets (org_id, name, kind, geom, elevation_m, elevation_source_type, value_amount,
      value_currency, value_basis, notes, source_type, created_by)
  values (p_org, btrim(p_name), p_kind, private.geom_from_geojson(p_geojson), p_elevation_m, p_elevation_source,
      p_value_amount, upper(p_value_currency), p_value_basis, p_notes, p_source_type, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.set_asset_value(p_id uuid, p_amount numeric, p_currency text, p_basis text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.assets;
begin
  select * into a from public.assets where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'assets.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_amount is not null and (p_currency is null or p_basis is null or length(btrim(p_basis)) < 10) then
    raise exception 'a value needs a currency and a written basis (where the number comes from)'
      using errcode = '22023';
  end if;
  update public.assets set value_amount = p_amount,
         value_basis = case when p_amount is null then null else btrim(p_basis) end,
         value_currency = case when p_amount is null then null else upper(p_currency) end
   where id = p_id;
end $$;

create function public.retire_asset(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare a public.assets;
begin
  select * into a from public.assets where id = p_id for update;
  if not found or auth.uid() is null or not private.has_permission(a.org_id, 'assets.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.assets set retired_at = coalesce(retired_at, now()) where id = p_id;
end $$;

create function public.add_hazard_zone(
  p_org uuid, p_name text, p_scenario text, p_source text, p_licence text,
  p_source_type public.source_type, p_geojson text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; g extensions.geometry;
begin
  if auth.uid() is null or not private.has_permission(p_org, 'hazard.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  g := private.geom_from_geojson(p_geojson);
  if extensions.geometrytype(g) not in ('POLYGON', 'MULTIPOLYGON') then
    raise exception 'a hazard zone must be a polygon' using errcode = '22023';
  end if;
  insert into public.hazard_zones (org_id, name, scenario, source, licence, source_type, geom, created_by)
  values (p_org, btrim(p_name), p_scenario, p_source, p_licence, p_source_type, extensions.st_multi(g), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Log an export (called by the web server after it builds a report for the signed-in person).
create function public.log_report_export(
  p_org uuid, p_kind text, p_format text, p_from timestamptz, p_to timestamptz, p_sha256 text, p_summary jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null
     or not (private.has_permission(p_org, 'assets.read') or private.has_permission(p_org, 'readings.read')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.report_exports (org_id, kind, format, window_start, window_end, content_sha256, summary, generated_by)
  values (p_org, p_kind, p_format, p_from, p_to, p_sha256, coalesce(p_summary, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Asset exposure (SECURITY INVOKER: RLS decides what you can see)
-- ---------------------------------------------------------------------------------------------
create function public.asset_exposure(p_asset uuid) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  a public.assets;
  riv record;
  n_rivers integer;
  n_zones integer;
  hits jsonb;
begin
  select * into a from public.assets where id = p_asset and retired_at is null;
  if not found then
    return null;
  end if;

  select count(*) into n_rivers from public.rivers where geom is not null;
  select count(*) into n_zones from public.hazard_zones where org_id = a.org_id;
  select r.name, r.source,
         extensions.st_distance(a.geom::extensions.geography, r.geom::extensions.geography) as d
    into riv
    from public.rivers r where r.geom is not null
   order by extensions.st_distance(a.geom::extensions.geography, r.geom::extensions.geography) limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('zone_id', z.id, 'name', z.name, 'scenario', z.scenario,
                                               'source', z.source, 'source_type', z.source_type, 'status', z.status)
                            order by z.name), '[]'::jsonb)
    into hits
    from public.hazard_zones z
   where z.org_id = a.org_id and extensions.st_intersects(z.geom, a.geom);

  return jsonb_build_object(
    'asset_id', a.id, 'org_id', a.org_id, 'name', a.name, 'kind', a.kind,
    'geometry_type', initcap(lower(extensions.geometrytype(a.geom))),
    'lon', extensions.st_x(extensions.st_pointonsurface(a.geom)),
    'lat', extensions.st_y(extensions.st_pointonsurface(a.geom)),
    'record_source_type', a.source_type,
    'elevation', case when a.elevation_m is null
        then jsonb_build_object('status', 'not_provided',
             'note', 'No elevation was supplied and no elevation dataset is integrated.')
        else jsonb_build_object('status', 'provided', 'value_m', a.elevation_m, 'source_type', a.elevation_source_type) end,
    'waterway', case when n_rivers = 0
        then jsonb_build_object('status', 'not_assessed',
             'note', 'No river geometry has been imported, so distance to waterways is not assessed.')
        else jsonb_build_object('status', 'assessed', 'nearest', riv.name, 'distance_m', round(riv.d::numeric, 0),
             'source', riv.source, 'note', 'Straight-line distance to imported river geometry, not a flow path.') end,
    'hazard', case when n_zones = 0
        then jsonb_build_object('status', 'not_assessed', 'loaded_zones', 0,
             'note', 'No hazard zones are loaded for this organisation, so exposure to hazard layers is not assessed.')
        when jsonb_array_length(hits) > 0
        then jsonb_build_object('status', 'inside', 'loaded_zones', n_zones, 'zones', hits,
             'note', 'Inside the loaded zone(s) listed, as labelled by their sources. Zones are not validated.')
        else jsonb_build_object('status', 'outside_loaded_zones', 'loaded_zones', n_zones,
             'note', 'Outside the loaded zones. This does not mean safe: the zones may not cover every hazard or area.') end,
    'value', case when a.value_amount is null then null
        else jsonb_build_object('amount', a.value_amount, 'currency', a.value_currency, 'basis', a.value_basis,
             'label', 'User-supplied value used as an assumption. Not an established loss.') end,
    'assumptions', jsonb_build_array(
        'Elevation is as supplied by the user with the stated source type.',
        'Distance to waterways is straight-line to imported river geometry.',
        'Hazard zones are as labelled by their sources and have not been validated.',
        'No damage curve is applied and no loss is estimated.')
  );
end $$;

create function public.portfolio_exposure(p_org uuid) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare rows jsonb; inside_value jsonb;
begin
  select coalesce(jsonb_agg(public.asset_exposure(x.id) order by x.name), '[]'::jsonb) into rows
    from (select id, name from public.assets where org_id = p_org and retired_at is null order by name limit 500) x;
  select coalesce(jsonb_agg(jsonb_build_object('currency', t.cur, 'amount', t.total, 'assets', t.n)
                            order by t.cur), '[]'::jsonb)
    into inside_value
    from (select x -> 'value' ->> 'currency' as cur,
                 sum((x -> 'value' ->> 'amount')::numeric) as total,
                 count(*) as n
            from jsonb_array_elements(rows) x
           where x -> 'hazard' ->> 'status' = 'inside' and x -> 'value' is not null
             and jsonb_typeof(x -> 'value') = 'object'
           group by x -> 'value' ->> 'currency') t;
  return jsonb_build_object(
    'org_id', p_org, 'assets', rows, 'value_inside_loaded_zones_by_currency', inside_value,
    'assumptions', jsonb_build_array(
        'Values are as supplied by users and are assumptions, not established losses.',
        'The total is the supplied value of assets inside a loaded zone; no damage curve is applied.',
        'Assets with no supplied value are not counted.'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Analytics (SECURITY INVOKER). Only stored readings are summarised; nothing is filled in.
-- Statistics use good/unchecked, non-estimated readings. Counts of every quality class are
-- returned so poor data is visible, not hidden.
-- ---------------------------------------------------------------------------------------------
create function public.analytics_station(
  p_station uuid, p_from timestamptz, p_to timestamptz, p_level double precision default null
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  st public.stations;
  s record;
  sensors jsonb := '[]'::jsonb;
  one jsonb; monthly jsonb; weekly jsonb; seasonal jsonb; annual jsonb; exceed jsonb;
  expected numeric;
begin
  if p_to <= p_from or p_to - p_from > interval '5 years' then
    raise exception 'the window must be positive and at most 5 years' using errcode = '22023';
  end if;
  select * into st from public.stations where id = p_station;
  if not found then
    return null;
  end if;
  for s in
    select id, kind, unit, expected_interval_s, source_type::text as source_type
      from public.sensors where station_id = p_station order by kind, created_at
  loop
    expected := greatest(1, floor(extract(epoch from (p_to - p_from)) / s.expected_interval_s));

    select jsonb_build_object(
        'readings', count(*),
        'used_in_statistics', count(*) filter (where x.used),
        'quality_good', count(*) filter (where x.q = 'good'),
        'quality_unchecked', count(*) filter (where x.q = 'unchecked'),
        'quality_suspect', count(*) filter (where x.q = 'suspect'),
        'quality_bad', count(*) filter (where x.q = 'bad'),
        'estimated_excluded', count(*) filter (where x.st = 'estimated'),
        'min', min(x.value) filter (where x.used), 'mean', avg(x.value) filter (where x.used),
        'max', max(x.value) filter (where x.used),
        'first_at', min(x.observed_at), 'last_at', max(x.observed_at),
        'expected_readings', expected,
        'completeness', round(least(1, count(*) / expected)::numeric, 4))
      into one
      from (select r.value, r.observed_at, r.quality::text as q, r.source_type::text as st,
                   (r.quality::text in ('good', 'unchecked') and r.source_type::text <> 'estimated') as used
              from public.readings_calibrated r
             where r.sensor_id = s.id and r.observed_at >= p_from and r.observed_at < p_to) x;

    select coalesce(jsonb_agg(jsonb_build_object('month', t.m, 'readings', t.n, 'mean', t.mean, 'max', t.mx,
                                                 'sum', t.sm) order by t.m), '[]'::jsonb)
      into monthly
      from (select to_char(date_trunc('month', r.observed_at at time zone 'UTC'), 'YYYY-MM') as m,
                   count(*) as n, avg(r.value) as mean, max(r.value) as mx, sum(r.value) as sm
              from public.readings_calibrated r
             where r.sensor_id = s.id and r.observed_at >= p_from and r.observed_at < p_to
               and r.quality::text in ('good', 'unchecked') and r.source_type::text <> 'estimated'
             group by 1) t;

    select coalesce(jsonb_agg(jsonb_build_object(
             'week_start', w.ws, 'received', w.n, 'expected', w.exp,
             'completeness', round(least(1, w.n / greatest(w.exp, 1))::numeric, 4),
             'suspect', w.sus, 'bad', w.bad) order by w.ws), '[]'::jsonb)
      into weekly
      from (select date_trunc('week', r.observed_at at time zone 'UTC') as ws,
                   count(*) as n,
                   floor(extract(epoch from (
                       least(date_trunc('week', r.observed_at at time zone 'UTC') + interval '7 days',
                             p_to at time zone 'UTC')
                       - greatest(date_trunc('week', r.observed_at at time zone 'UTC'), p_from at time zone 'UTC')))
                     / s.expected_interval_s) as exp,
                   count(*) filter (where r.quality::text = 'suspect') as sus,
                   count(*) filter (where r.quality::text = 'bad') as bad
              from public.readings_calibrated r
             where r.sensor_id = s.id and r.observed_at >= p_from and r.observed_at < p_to
             group by 1) w;

    select coalesce(jsonb_agg(jsonb_build_object('month_number', t.mn, 'years_with_data', t.yrs,
                                                 'mean', t.mean, 'max', t.mx) order by t.mn), '[]'::jsonb)
      into seasonal
      from (select extract(month from r.observed_at at time zone 'UTC')::int as mn,
                   count(distinct extract(year from r.observed_at at time zone 'UTC')) as yrs,
                   avg(r.value) as mean, max(r.value) as mx
              from public.readings_calibrated r
             where r.sensor_id = s.id and r.observed_at >= p_from and r.observed_at < p_to
               and r.quality::text in ('good', 'unchecked') and r.source_type::text <> 'estimated'
             group by 1) t;

    select coalesce(jsonb_agg(jsonb_build_object('year', t.y, 'max', t.mx, 'readings', t.n) order by t.y), '[]'::jsonb)
      into annual
      from (select extract(year from r.observed_at at time zone 'UTC')::int as y, max(r.value) as mx, count(*) as n
              from public.readings_calibrated r
             where r.sensor_id = s.id and r.observed_at >= p_from and r.observed_at < p_to
               and r.quality::text in ('good', 'unchecked') and r.source_type::text <> 'estimated'
             group by 1) t;

    exceed := null;
    if p_level is not null and s.kind = 'water_level' then
      select coalesce(jsonb_agg(jsonb_build_object('year', t.y, 'days_at_or_above', t.d) order by t.y), '[]'::jsonb)
        into exceed
        from (select extract(year from r.observed_at at time zone 'UTC')::int as y,
                     count(distinct (r.observed_at at time zone 'UTC')::date) as d
                from public.readings_calibrated r
               where r.sensor_id = s.id and r.observed_at >= p_from and r.observed_at < p_to
                 and r.quality::text in ('good', 'unchecked') and r.source_type::text <> 'estimated'
                 and r.value >= p_level
               group by 1) t;
    end if;

    sensors := sensors || jsonb_build_array(jsonb_build_object(
        'sensor_id', s.id, 'kind', s.kind, 'unit', s.unit, 'source_type', s.source_type,
        'expected_interval_s', s.expected_interval_s, 'summary', one, 'monthly', monthly,
        'weekly_performance', weekly, 'seasonal', seasonal, 'annual_maxima', annual,
        'days_at_or_above_level', exceed));
  end loop;
  return jsonb_build_object(
    'station_id', st.id, 'org_id', st.org_id, 'station', st.name,
    'window_from', p_from, 'window_to', p_to, 'level', p_level, 'sensors', sensors);
end $$;

-- How stored predictions did against what was observed afterwards. Warning probability is required.
create function public.prediction_verification(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_warn double precision
) returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  if p_warn is null or p_warn <= 0 or p_warn > 1 then
    raise exception 'the warning probability is required, in (0, 1]' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'model', m.name || ' ' || m.version, 'model_version_id', m.id,
        'predictions', g.n_all, 'outcome_unknown', g.n_unknown,
        'hits', g.hits, 'misses', g.misses, 'false_alarms', g.fa, 'correct_negatives', g.cn,
        'brier', g.brier, 'includes_synthetic', g.synth) order by m.name, m.version)
    from (
      select o.model_version_id,
             count(*) as n_all,
             count(*) filter (where not o.known) as n_unknown,
             count(*) filter (where o.known and o.happened and o.probability >= p_warn) as hits,
             count(*) filter (where o.known and o.happened and o.probability < p_warn) as misses,
             count(*) filter (where o.known and not o.happened and o.probability >= p_warn) as fa,
             count(*) filter (where o.known and not o.happened and o.probability < p_warn) as cn,
             avg(power(o.probability - (case when o.happened then 1 else 0 end), 2)) filter (where o.known) as brier,
             bool_or(o.st = 'synthetic') as synth
        from (
          select p.model_version_id, p.probability, p.source_type::text as st,
                 x.happened, (x.n_obs > 0 or x.happened) as known
            from public.predictions p
            cross join lateral (
              select count(*) as n_obs, coalesce(bool_or(r.value >= (p.input_snapshot -> 'threshold' ->> 'value')::double precision), false) as happened
                from public.readings_calibrated r
               where r.sensor_id = (p.input_snapshot ->> 'stage_sensor_id')::uuid
                 and r.observed_at > p.issued_at and r.observed_at <= p.valid_to
                 and r.quality::text in ('good', 'unchecked') and r.source_type::text <> 'estimated'
            ) x
           where p.org_id = p_org and p.target = 'flood_occurrence' and p.probability is not null
             and p.issued_at >= p_from and p.issued_at < p_to and p.valid_to <= now()
             and p.input_snapshot -> 'threshold' ->> 'value' is not null
             and p.input_snapshot ->> 'stage_sensor_id' is not null
        ) o
       group by o.model_version_id
    ) g join public.model_versions m on m.id = g.model_version_id), '[]'::jsonb);
end $$;

revoke all on function public.add_asset(uuid, text, text, text, numeric, public.source_type, numeric, text, text, text, public.source_type),
                       public.set_asset_value(uuid, numeric, text, text),
                       public.retire_asset(uuid),
                       public.add_hazard_zone(uuid, text, text, text, text, public.source_type, text),
                       public.log_report_export(uuid, text, text, timestamptz, timestamptz, text, jsonb),
                       public.asset_exposure(uuid), public.portfolio_exposure(uuid),
                       public.analytics_station(uuid, timestamptz, timestamptz, double precision),
                       public.prediction_verification(uuid, timestamptz, timestamptz, double precision)
  from public, anon, service_role;
grant execute on function public.add_asset(uuid, text, text, text, numeric, public.source_type, numeric, text, text, text, public.source_type),
                          public.set_asset_value(uuid, numeric, text, text),
                          public.retire_asset(uuid),
                          public.add_hazard_zone(uuid, text, text, text, text, public.source_type, text),
                          public.log_report_export(uuid, text, text, timestamptz, timestamptz, text, jsonb),
                          public.asset_exposure(uuid), public.portfolio_exposure(uuid),
                          public.analytics_station(uuid, timestamptz, timestamptz, double precision),
                          public.prediction_verification(uuid, timestamptz, timestamptz, double precision)
  to authenticated;

-- DOWN:
--   drop function public.prediction_verification, public.analytics_station, public.portfolio_exposure, public.asset_exposure, public.log_report_export,
--     public.add_hazard_zone, public.retire_asset, public.set_asset_value, public.add_asset,
--     private.geom_from_geojson;
--   drop table public.report_exports, public.assets, public.hazard_zones;
--   delete from public.role_permissions where permission_key in ('assets.read','assets.manage','hazard.manage');
--   delete from public.permissions where key in ('assets.read','assets.manage','hazard.manage');
