"""Import river and catchment geometry (GeoJSON, Shapefile, GeoPackage) into PostGIS.

Run from the services/api directory with the optional `geo` dependency group installed:

    uv run --group geo python -m hydrosight_api.geoimport rivers path/to/rivers.gpkg \\
        --name-field NAME --source "Publisher, dataset, version" --licence "ODbL-1.0" \\
        --source-type measured [--layer LAYER] [--assume-crs EPSG:32636] [--dry-run]

Rules (see docs/DATA_SOURCES.md):
  * `--source` and `--licence` are mandatory and never defaulted: provenance must be stated.
  * Nothing is invented: unusable features are SKIPPED and reported, never silently repaired
    beyond making invalid polygons valid.
  * Re-importing the same source updates geometry by (name, source); it never deletes rows.
  * The heavy GIS libraries are optional so they are not part of the deployed API bundle.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg

KINDS = ("rivers", "catchments")
SOURCE_TYPES = ("measured", "estimated", "forecast", "community", "synthetic")
LINE_TYPES = {"LineString", "MultiLineString"}
POLYGON_TYPES = {"Polygon", "MultiPolygon"}


class ImportError_(Exception):  # noqa: N801 - avoids shadowing the builtin ImportError
    """The file cannot be imported as-is (bad CRS, missing field, etc.)."""


@dataclass
class Feature:
    name: str
    wkb: bytes  # EPSG:4326, 2D, always a Multi* geometry


@dataclass
class ReadResult:
    features: list[Feature] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)  # human-readable reasons
    rows_read: int = 0


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_layer(
    path: Path,
    kind: str,
    name_field: str,
    *,
    layer: str | None = None,
    assume_crs: str | None = None,
) -> ReadResult:
    """Read, validate, reproject to EPSG:4326 and merge features by name."""
    if kind not in KINDS:
        raise ImportError_(f"kind must be one of {KINDS}")
    try:
        import geopandas  # type: ignore[import-untyped,unused-ignore]
        import shapely  # type: ignore[import-untyped,unused-ignore]
    except ImportError as exc:  # pragma: no cover - exercised only without the geo group
        raise ImportError_("install the geo group: uv run --group geo ...") from exc

    gdf = geopandas.read_file(path, layer=layer)
    if name_field not in gdf.columns:
        raise ImportError_(f"name field {name_field!r} not found; columns: {sorted(gdf.columns)}")
    if gdf.crs is None:
        if not assume_crs:
            raise ImportError_("file has no CRS; pass --assume-crs (e.g. EPSG:4326) if you know it")
        gdf = gdf.set_crs(assume_crs)
    gdf = gdf.to_crs(4326)

    allowed = LINE_TYPES if kind == "rivers" else POLYGON_TYPES
    result = ReadResult(rows_read=len(gdf))
    parts: dict[str, list[Any]] = defaultdict(list)

    for idx, row in gdf.iterrows():
        geom = row.geometry
        name = "" if row[name_field] is None else str(row[name_field]).strip()
        label = f"row {idx}"
        if not name or name.lower() == "nan":
            result.skipped.append(f"{label}: empty name")
            continue
        if geom is None or geom.is_empty:
            result.skipped.append(f"{label} ({name}): empty geometry")
            continue
        geom = shapely.force_2d(geom)
        if geom.geom_type not in allowed:
            result.skipped.append(f"{label} ({name}): {geom.geom_type} is not valid for {kind}")
            continue
        if kind == "catchments" and not geom.is_valid:
            geom = shapely.make_valid(geom)
            if geom.geom_type not in allowed:
                # make_valid may return a collection; keep only its polygonal parts
                polys = [g for g in getattr(geom, "geoms", []) if g.geom_type in POLYGON_TYPES]
                if not polys:
                    result.skipped.append(
                        f"{label} ({name}): invalid polygon could not be repaired"
                    )
                    continue
                geom = shapely.union_all(polys)
        minx, miny, maxx, maxy = geom.bounds
        if not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90):
            result.skipped.append(
                f"{label} ({name}): coordinates outside lon/lat range (wrong CRS?)"
            )
            continue
        parts[name].append(geom)

    for name, geoms in parts.items():
        if kind == "rivers":
            lines = [
                g for geom in geoms for g in (geom.geoms if hasattr(geom, "geoms") else [geom])
            ]
            multi = shapely.MultiLineString(lines)
        else:
            merged = shapely.union_all(geoms)
            multi = merged if merged.geom_type == "MultiPolygon" else shapely.MultiPolygon([merged])
        result.features.append(Feature(name=name, wkb=bytes(shapely.to_wkb(multi))))
    return result


def load_features(
    conn: psycopg.Connection[Any],
    kind: str,
    features: list[Feature],
    *,
    source: str,
    licence: str,
    source_type: str,
    filename: str,
    sha256: str,
    skipped_count: int,
    imported_by: str,
) -> int:
    """Insert provenance + upsert features. The caller owns the transaction (commit/rollback)."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    if not source.strip():
        raise ValueError("source is required (state where the data comes from)")
    if not licence.strip():
        raise ValueError("licence is required (state the licence, or 'UNVERIFIED')")
    if source_type not in SOURCE_TYPES:
        raise ValueError(f"source_type must be one of {SOURCE_TYPES}")

    import_id = conn.execute(
        "insert into public.geo_imports (kind, source, licence, source_type, filename, file_sha256,"
        " feature_count, skipped_count, imported_by) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
        " returning id",
        (
            kind,
            source,
            licence,
            source_type,
            filename,
            sha256,
            len(features),
            skipped_count,
            imported_by,
        ),
    ).fetchone()
    if import_id is None:  # pragma: no cover - INSERT ... RETURNING always yields a row
        raise RuntimeError("could not record the import")
    table = "rivers" if kind == "rivers" else "catchments"
    for f in features:
        conn.execute(
            f"insert into public.{table} (name, geom, source, source_type, import_id)"  # noqa: S608
            " values (%s, extensions.st_setsrid(extensions.st_geomfromwkb(%s), 4326), %s, %s, %s)"
            " on conflict (name, source) do update set geom = excluded.geom,"
            " source_type = excluded.source_type, import_id = excluded.import_id",
            (f.name, f.wkb, source, source_type, import_id[0]),
        )
    return len(features)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Import rivers/catchments into PostGIS")
    ap.add_argument("kind", choices=KINDS)
    ap.add_argument("path", type=Path)
    ap.add_argument("--name-field", required=True)
    ap.add_argument("--source", required=True, help="publisher, dataset and version")
    ap.add_argument("--licence", required=True, help="licence of the data, or UNVERIFIED")
    ap.add_argument("--source-type", required=True, choices=SOURCE_TYPES)
    ap.add_argument("--layer")
    ap.add_argument("--assume-crs")
    ap.add_argument("--dry-run", action="store_true", help="validate and report; write nothing")
    args = ap.parse_args(argv)

    from hydrosight_api.config import get_settings

    result = read_layer(
        args.path, args.kind, args.name_field, layer=args.layer, assume_crs=args.assume_crs
    )
    print(
        f"read {result.rows_read} rows -> {len(result.features)} {args.kind}, "
        f"{len(result.skipped)} skipped"
    )
    for reason in result.skipped[:50]:
        print(f"  skipped: {reason}")
    if args.dry_run:
        print("dry run: nothing written")
        return 0
    url = get_settings().database_url
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    with psycopg.connect(url) as conn:
        n = load_features(
            conn,
            args.kind,
            result.features,
            source=args.source,
            licence=args.licence,
            source_type=args.source_type,
            filename=args.path.name,
            sha256=file_sha256(args.path),
            skipped_count=len(result.skipped),
            imported_by="geoimport-cli",
        )
        conn.commit()
    print(f"imported {n} {args.kind} with source={args.source!r} licence={args.licence!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
