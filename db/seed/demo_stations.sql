-- Demo seed: SYNTHETIC stations near named Ugandan rivers. Idempotent. Not a migration.
-- Coordinates are APPROXIMATE, placed by hand for demonstration only. They are not surveyed
-- station locations and do not represent real monitoring equipment. Everything here is
-- source_type = 'synthetic' and status = 'unvalidated'. River geometry is NOT included: it must
-- come from a licensed import (see docs/DATA_SOURCES.md).

insert into public.organizations (name, slug, is_demo)
values ('HydroSight Demo (synthetic data)', 'hydrosight-demo', true)
on conflict (slug) do nothing;

insert into public.rivers (name, source, source_type) values
  ('Nile', 'demo seed: name only, no geometry', 'synthetic'),
  ('Kagera', 'demo seed: name only, no geometry', 'synthetic'),
  ('Rwizi', 'demo seed: name only, no geometry', 'synthetic'),
  ('Nyamwamba', 'demo seed: name only, no geometry', 'synthetic'),
  ('Manafwa', 'demo seed: name only, no geometry', 'synthetic'),
  ('Katonga', 'demo seed: name only, no geometry', 'synthetic')
on conflict (name, source) do nothing;

with demo as (select id from public.organizations where slug = 'hydrosight-demo'),
pts(code, name, river, lon, lat, note) as (values
  ('DEMO-NILE-01',      'Nile, Jinja area (demo)',          'Nile',      33.2040,  0.4236, 'Approximate placement near Jinja.'),
  ('DEMO-KAGERA-01',    'Kagera, south-west (demo)',        'Kagera',    31.4000, -1.0000, 'Approximate placement; not a real gauge.'),
  ('DEMO-RWIZI-01',     'Rwizi, Mbarara area (demo)',       'Rwizi',     30.6500, -0.6100, 'Approximate placement near Mbarara.'),
  ('DEMO-NYAMWAMBA-01', 'Nyamwamba, Kasese area (demo)',    'Nyamwamba', 30.0800,  0.1800, 'Approximate placement near Kasese.'),
  ('DEMO-MANAFWA-01',   'Manafwa, Mbale area (demo)',       'Manafwa',   34.2500,  1.0000, 'Approximate placement; not a real gauge.'),
  ('DEMO-KATONGA-01',   'Katonga, central Uganda (demo)',   'Katonga',   31.8500,  0.1000, 'Approximate placement; not a real gauge.')
)
insert into public.stations (org_id, code, name, river_id, geom, source_type, notes)
select demo.id, p.code, p.name, r.id,
       extensions.st_setsrid(extensions.st_makepoint(p.lon, p.lat), 4326),
       'synthetic', 'SYNTHETIC DEMO. ' || p.note
from pts p
cross join demo
join public.rivers r on r.name = p.river and r.source = 'demo seed: name only, no geometry'
on conflict (org_id, code) do nothing;

insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)
select s.org_id, s.id, k.kind, k.unit, k.iv, 'synthetic'
from public.stations s
cross join (values ('water_level', 'm', 900), ('rainfall', 'mm', 900)) as k(kind, unit, iv)
where s.code like 'DEMO-%'
  and not exists (select 1 from public.sensors x where x.station_id = s.id and x.kind = k.kind);
