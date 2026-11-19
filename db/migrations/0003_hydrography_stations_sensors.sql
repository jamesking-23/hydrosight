-- requires: postgis
-- 0003_hydrography_stations_sensors.sql
-- Phase 2: rivers, catchments, locations, monitoring stations, sensors, import provenance.
--
-- Design notes
--  * Rivers and catchments are GLOBAL reference geography (no org_id): readable by any signed-in
--    user, written only by the import pipeline (service role). Their geometry may be NULL until
--    real data is imported: HydroSight never invents river geometry.
--  * Locations, stations and sensors are TENANT data (org_id, RLS). Everything starts as
--    `prototype` (rule 4); app roles can never change `status` or `source_type`.
--  * A demo organisation (organizations.is_demo) owns SYNTHETIC demo stations. Any signed-in user
--    may read (never write) rows of a demo organisation.
--  * Geometry is EPSG:4326 (lon/lat). Every geometry column has a GiST index.
--  * Skipped automatically where PostGIS is unavailable (local pgserver); CI and Supabase have it.

alter table public.organizations add column is_demo boolean not null default false;

create function private.is_demo_org(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.organizations o where o.id = p_org and o.is_demo) $$;
revoke all on function private.is_demo_org(uuid) from public;
grant execute on function private.is_demo_org(uuid) to authenticated, service_role;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------------------------
-- Provenance of every geographic import (licence is mandatory and never defaulted)
-- ---------------------------------------------------------------------------------------------
create table public.geo_imports (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('rivers', 'catchments')),
  source        text not null check (length(btrim(source)) > 0),
  licence       text not null check (length(btrim(licence)) > 0),
  source_type   public.source_type not null,
  filename      text not null,
  file_sha256   text not null,
  feature_count integer not null check (feature_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  imported_by   text not null,
  imported_at   timestamptz not null default now()
);

create table public.rivers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  geom        extensions.geometry(MultiLineString, 4326),  -- NULL until real geometry is imported
  source      text not null,
  source_type public.source_type not null,
  import_id   uuid references public.geo_imports (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (name, source)
);
create index rivers_geom_gix on public.rivers using gist (geom);

create table public.catchments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  geom        extensions.geometry(MultiPolygon, 4326),
  source      text not null,
  source_type public.source_type not null,
  import_id   uuid references public.geo_imports (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (name, source)
);
create index catchments_geom_gix on public.catchments using gist (geom);

-- ---------------------------------------------------------------------------------------------
-- Tenant tables
-- ---------------------------------------------------------------------------------------------
create table public.locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  kind        text not null check (kind in ('district', 'subcounty', 'village', 'town', 'site')),
  geom        extensions.geometry(Point, 4326) not null,
  source_type public.source_type not null,
  status      public.service_status not null default 'prototype',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (extensions.st_x(geom) between -180 and 180 and extensions.st_y(geom) between -90 and 90)
);
create index locations_org_idx on public.locations (org_id);
create index locations_geom_gix on public.locations using gist (geom);

create table public.stations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  code                  text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'),
  name                  text not null check (length(btrim(name)) between 1 and 120),
  river_id              uuid references public.rivers (id) on delete set null,
  catchment_id          uuid references public.catchments (id) on delete set null,
  location_id           uuid references public.locations (id) on delete set null,
  geom                  extensions.geometry(Point, 4326) not null,
  elevation_m           numeric(7, 2),
  elevation_source_type public.source_type,
  source_type           public.source_type not null,  -- provenance of the station RECORD
  status                public.service_status not null default 'prototype',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, code),
  unique (id, org_id),
  check (extensions.st_x(geom) between -180 and 180 and extensions.st_y(geom) between -90 and 90),
  check ((elevation_m is null) = (elevation_source_type is null))  -- an elevation always states its source
);
create index stations_org_idx on public.stations (org_id);
create index stations_river_idx on public.stations (river_id);
create index stations_geom_gix on public.stations using gist (geom);

create table public.sensors (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  station_id        uuid not null,
  kind              text not null check (kind in ('water_level', 'rainfall', 'flow', 'temperature', 'soil_moisture')),
  unit              text not null check (length(btrim(unit)) > 0),
  expected_interval_s integer not null check (expected_interval_s between 10 and 604800),
  source_type       public.source_type not null,
  status            public.service_status not null default 'prototype',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (station_id, org_id) references public.stations (id, org_id) on delete cascade  -- same organisation, always
);
create index sensors_station_idx on public.sensors (station_id);
create index sensors_org_idx on public.sensors (org_id);

create trigger locations_touch before update on public.locations
  for each row execute function private.touch_updated_at();
create trigger stations_touch before update on public.stations
  for each row execute function private.touch_updated_at();
create trigger sensors_touch before update on public.sensors
  for each row execute function private.touch_updated_at();

create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function private.audit_row_change();
create trigger audit_stations after insert or update or delete on public.stations
  for each row execute function private.audit_row_change();
create trigger audit_sensors after insert or update or delete on public.sensors
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------------------------
-- Row-level security and least-privilege grants
-- ---------------------------------------------------------------------------------------------
alter table public.geo_imports enable row level security;
alter table public.rivers      enable row level security;
alter table public.catchments  enable row level security;
alter table public.locations   enable row level security;
alter table public.stations    enable row level security;
alter table public.sensors     enable row level security;

revoke all on public.geo_imports, public.rivers, public.catchments, public.locations,
  public.stations, public.sensors from anon, authenticated, service_role;

-- global reference geography: readable by signed-in users, written only by the import pipeline
grant select on public.rivers, public.catchments to authenticated, service_role;
create policy rivers_read     on public.rivers     for select to authenticated using (true);
create policy catchments_read on public.catchments for select to authenticated using (true);
grant select (id, kind, source, licence, source_type, imported_at) on public.geo_imports to authenticated;
grant select on public.geo_imports to service_role;
create policy geo_imports_read on public.geo_imports for select to authenticated using (true);

-- locations
grant select, delete on public.locations to authenticated;
grant insert (org_id, name, kind, geom, source_type) on public.locations to authenticated;
grant update (name, kind, geom) on public.locations to authenticated;
grant select on public.locations to service_role;
create policy locations_select on public.locations for select to authenticated
  using (private.has_permission(org_id, 'sensors.read') or private.is_demo_org(org_id));
create policy locations_insert on public.locations for insert to authenticated
  with check (private.has_permission(org_id, 'devices.manage'));
create policy locations_update on public.locations for update to authenticated
  using (private.has_permission(org_id, 'devices.manage'))
  with check (private.has_permission(org_id, 'devices.manage'));
create policy locations_delete on public.locations for delete to authenticated
  using (private.has_permission(org_id, 'devices.manage'));

-- stations: `status` is never writable by app roles (promotion is a later, evidence-linked step)
grant select, delete on public.stations to authenticated;
grant insert (org_id, code, name, river_id, catchment_id, location_id, geom, elevation_m,
              elevation_source_type, source_type, notes) on public.stations to authenticated;
grant update (name, river_id, catchment_id, location_id, geom, elevation_m,
              elevation_source_type, notes) on public.stations to authenticated;
grant select on public.stations to service_role;
create policy stations_select on public.stations for select to authenticated
  using (private.has_permission(org_id, 'sensors.read') or private.is_demo_org(org_id));
create policy stations_insert on public.stations for insert to authenticated
  with check (private.has_permission(org_id, 'devices.manage'));
create policy stations_update on public.stations for update to authenticated
  using (private.has_permission(org_id, 'devices.manage'))
  with check (private.has_permission(org_id, 'devices.manage'));
create policy stations_delete on public.stations for delete to authenticated
  using (private.has_permission(org_id, 'devices.manage'));

-- sensors
grant select, delete on public.sensors to authenticated;
grant insert (org_id, station_id, kind, unit, expected_interval_s, source_type) on public.sensors to authenticated;
grant update (unit, expected_interval_s) on public.sensors to authenticated;
grant select on public.sensors to service_role;
create policy sensors_select on public.sensors for select to authenticated
  using (private.has_permission(org_id, 'sensors.read') or private.is_demo_org(org_id));
create policy sensors_insert on public.sensors for insert to authenticated
  with check (private.has_permission(org_id, 'devices.manage'));
create policy sensors_update on public.sensors for update to authenticated
  using (private.has_permission(org_id, 'devices.manage'))
  with check (private.has_permission(org_id, 'devices.manage'));
create policy sensors_delete on public.sensors for delete to authenticated
  using (private.has_permission(org_id, 'devices.manage'));

-- ---------------------------------------------------------------------------------------------
-- Map-friendly read views (security_invoker: the caller's RLS applies, not the owner's)
-- ---------------------------------------------------------------------------------------------
create view public.stations_geo with (security_invoker = true) as
select s.id, s.org_id, s.code, s.name,
       extensions.st_y(s.geom) as lat, extensions.st_x(s.geom) as lon,
       r.name as river_name, s.elevation_m, s.elevation_source_type,
       s.source_type, s.status, s.notes
from public.stations s
left join public.rivers r on r.id = s.river_id;

create view public.rivers_geo with (security_invoker = true) as
select id, name, source, source_type, extensions.st_asgeojson(geom)::jsonb as geojson
from public.rivers where geom is not null;

create view public.catchments_geo with (security_invoker = true) as
select id, name, source, source_type, extensions.st_asgeojson(geom)::jsonb as geojson
from public.catchments where geom is not null;

revoke all on public.stations_geo, public.rivers_geo, public.catchments_geo from anon, authenticated, service_role;
grant select on public.stations_geo, public.rivers_geo, public.catchments_geo to authenticated, service_role;

-- DOWN (manual, destructive):
--   drop view public.catchments_geo, public.rivers_geo, public.stations_geo;
--   drop table public.sensors, public.stations, public.locations, public.catchments, public.rivers, public.geo_imports;
--   drop function private.touch_updated_at(), private.is_demo_org(uuid);
--   alter table public.organizations drop column is_demo;
