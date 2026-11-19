"""HS-GEO-005: GeoJSON/Shapefile/GeoPackage import: validation, reprojection, provenance."""

import os
from pathlib import Path

import psycopg
import pytest
from conftest import Db

try:
    import geopandas as gpd
    import shapely
    from shapely.geometry import LineString, Point, Polygon
except ImportError:  # the geo group is optional locally, mandatory in CI
    if os.environ.get("REQUIRE_POSTGIS"):
        raise
    pytest.skip("geo dependency group not installed (uv run --group geo)", allow_module_level=True)

from hydrosight_api.geoimport import (
    ImportError_,
    file_sha256,
    load_features,
    read_layer,
)


def _rivers_gdf(crs: str | None = "EPSG:4326") -> "gpd.GeoDataFrame":
    return gpd.GeoDataFrame(
        {
            "NAME": ["Nile", "Nile", "Kagera", "  ", "Not a river", None],
            "geometry": [
                LineString([(32.0, 0.0), (32.5, 0.5)]),
                LineString([(32.5, 0.5), (33.0, 1.0)]),
                LineString([(31.0, -1.0, 1200.0), (31.4, -1.2, 1190.0)]),  # has Z
                LineString([(30.0, 0.0), (30.1, 0.1)]),  # blank name
                Point(32.0, 0.0),  # wrong geometry type
                LineString([(30.0, 1.0), (30.2, 1.1)]),  # missing name
            ],
        },
        crs=crs,
    )


@pytest.fixture(params=["geojson", "gpkg", "shp"])
def rivers_file(request: pytest.FixtureRequest, tmp_path: Path) -> Path:
    gdf = _rivers_gdf()
    if request.param == "shp":  # shapefiles cannot hold mixed geometry types: drop the Point
        gdf = gdf[gdf.geometry.geom_type != "Point"]
    path = tmp_path / f"rivers.{request.param}"
    gdf.to_file(
        path, driver={"geojson": "GeoJSON", "gpkg": "GPKG", "shp": "ESRI Shapefile"}[request.param]
    )
    return path


def test_reads_all_three_formats_merges_by_name_and_reports_skips(rivers_file: Path) -> None:
    r = read_layer(rivers_file, "rivers", "NAME")
    names = {f.name for f in r.features}
    assert names == {"Nile", "Kagera"}
    nile = next(f for f in r.features if f.name == "Nile")
    geom = shapely.from_wkb(nile.wkb)
    assert geom.geom_type == "MultiLineString" and len(geom.geoms) == 2  # two segments merged
    kagera = shapely.from_wkb(next(f for f in r.features if f.name == "Kagera").wkb)
    assert not shapely.has_z(kagera)  # Z dropped
    reasons = " | ".join(r.skipped)
    assert "empty name" in reasons
    if rivers_file.suffix != ".shp":
        assert "Point is not valid for rivers" in reasons


def test_reprojects_to_lonlat(tmp_path: Path) -> None:
    pt = gpd.GeoSeries([LineString([(500000, 0), (500000, 110574)])], crs="EPSG:32636")  # UTM 36N
    path = tmp_path / "utm.geojson"
    gpd.GeoDataFrame({"NAME": ["Utm"]}, geometry=pt).to_file(path, driver="GeoJSON")
    r = read_layer(path, "rivers", "NAME")
    x0, y0, x1, y1 = shapely.from_wkb(r.features[0].wkb).bounds
    assert round(x0, 3) == 33.0 and round(y0, 3) == 0.0  # central meridian of zone 36 is 33 E
    assert round(y1, 1) == 1.0 and round(x1, 3) == 33.0


def test_missing_crs_is_refused_unless_stated(tmp_path: Path) -> None:
    path = tmp_path / "nocrs.shp"
    _rivers_gdf(crs=None).iloc[:3].to_file(path)
    with pytest.raises(ImportError_, match="no CRS"):
        read_layer(path, "rivers", "NAME")
    assert len(read_layer(path, "rivers", "NAME", assume_crs="EPSG:4326").features) == 2


def test_wrong_crs_guess_is_skipped_not_loaded(tmp_path: Path) -> None:
    path = tmp_path / "utm_as_lonlat.shp"
    gpd.GeoDataFrame(
        {"NAME": ["Bad"]}, geometry=[LineString([(500000, 9_900_000), (500100, 9_900_100)])]
    ).to_file(path)
    r = read_layer(path, "rivers", "NAME", assume_crs="EPSG:4326")
    assert r.features == [] and "outside lon/lat range" in r.skipped[0]


def test_unknown_name_field_lists_columns(rivers_file: Path) -> None:
    with pytest.raises(ImportError_, match="name field 'WRONG' not found"):
        read_layer(rivers_file, "rivers", "WRONG")


def test_catchments_repair_invalid_polygons_and_reject_lines(tmp_path: Path) -> None:
    bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)])  # self-intersecting
    gdf = gpd.GeoDataFrame(
        {"NAME": ["Bowtie", "Square", "Line"]},
        geometry=[
            bowtie,
            Polygon([(10, 0), (11, 0), (11, 1), (10, 1)]),
            LineString([(0, 0), (1, 1)]),
        ],
        crs="EPSG:4326",
    )
    path = tmp_path / "c.geojson"
    gdf.to_file(path, driver="GeoJSON")
    r = read_layer(path, "catchments", "NAME")
    assert {f.name for f in r.features} == {"Bowtie", "Square"}
    for f in r.features:
        g = shapely.from_wkb(f.wkb)
        assert g.geom_type == "MultiPolygon" and g.is_valid
    assert any("LineString is not valid for catchments" in s for s in r.skipped)


def test_sha256_is_stable(tmp_path: Path) -> None:
    p = tmp_path / "x.txt"
    p.write_text("abc")
    assert file_sha256(p) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


# ---- database (needs PostGIS: CI) -------------------------------------------------------------


def _load(db: Db, path: Path, source: str = "Test publisher v1", licence: str = "ODbL-1.0") -> int:
    r = read_layer(path, "rivers", "NAME")
    return load_features(
        db.conn, "rivers", r.features, source=source, licence=licence, source_type="measured",
        filename=path.name, sha256=file_sha256(path), skipped_count=len(r.skipped), imported_by="test",
    )  # fmt: skip


def test_load_writes_geometry_provenance_and_is_idempotent(
    db: Db, postgis: bool, tmp_path: Path
) -> None:
    path = tmp_path / "r.geojson"
    _rivers_gdf().to_file(path, driver="GeoJSON")
    assert _load(db, path) == 2
    assert _load(db, path) == 2  # re-import updates, never duplicates
    assert db.one("select count(*) from public.rivers where source = 'Test publisher v1'") == 2
    assert db.one("select count(*) from public.geo_imports") == 2  # every import is recorded
    row = db.q("select kind, licence, source_type::text, feature_count, skipped_count, file_sha256 "
               "from public.geo_imports order by imported_at desc limit 1")[0]  # fmt: skip
    assert row[:4] == ("rivers", "ODbL-1.0", "measured", 2) and row[4] >= 2 and len(row[5]) == 64
    assert db.one("select extensions.st_srid(geom) from public.rivers where name = 'Nile'") == 4326
    assert (
        db.one("select extensions.st_numgeometries(geom) from public.rivers where name = 'Nile'")
        == 2
    )
    assert db.one("select count(*) from public.rivers_geo") == 2


def test_load_requires_source_and_licence(db: Db, postgis: bool, tmp_path: Path) -> None:
    path = tmp_path / "r.geojson"
    _rivers_gdf().to_file(path, driver="GeoJSON")
    with pytest.raises(ValueError, match="licence is required"):
        _load(db, path, licence="  ")
    with pytest.raises(ValueError, match="source is required"):
        _load(db, path, source="")
    with pytest.raises(ValueError, match="source_type"):
        load_features(db.conn, "rivers", [], source="s", licence="l", source_type="official",
                      filename="f", sha256="h", skipped_count=0, imported_by="t")  # fmt: skip


def test_app_roles_cannot_run_the_import(db: Db, postgis: bool, tmp_path: Path) -> None:
    path = tmp_path / "r.geojson"
    _rivers_gdf().to_file(path, driver="GeoJSON")
    db.anon()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        _load(db, path)
