# ADR-003: Geography model, demo data and map

Status: accepted (prototype), 2026-11-19

## Decisions
1. **Reference geography is global; stations are tenant data.** `rivers` and `catchments` are readable by any signed-in user and writable only by the service role (via the import CLI). `locations`, `stations`, `sensors` carry `org_id` with RLS (`sensors.read` to read, `devices.manage` to write).
2. **Demo org.** `organizations.is_demo` lets any signed-in user read that org's stations and sensors, never write them. Reversible; owner to confirm (OPEN_QUESTIONS).
3. **No self-promotion.** App roles cannot write `status` or `source_type` after creation; column grants enforce it. Promotion will need a dedicated function with an evidence link.
4. **No invented geometry.** Demo rivers are names only (`geom` NULL). Real geometry arrives only through the import CLI, which requires CRS, source and licence and stores a file hash.
5. **Elevation needs a source.** `elevation_m` and `elevation_source_type` are both set or both null.
6. **GiST indexes** on every geometry column; verified with EXPLAIN.
7. **MapLibre worker served statically** (`public/vendor`, copied by script) and `setWorkerUrl`, because the bundled worker fails under Turbopack. Layers are added on `style.load` so stations show even when tiles fail.
8. **Optional `geo` dependency group** (GeoPandas/pyogrio/shapely/pyproj) so normal API installs stay light; CI installs it.

## Consequences
Spatial migrations are skipped when PostGIS is absent locally (`-- requires: postgis`); CI is the authority for them.
