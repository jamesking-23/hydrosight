"""HS-GEO-001..004: stations/sensors are tenant-isolated, unvalidated-by-default, provenance-carrying,
and spatially indexed. Needs PostGIS (CI); skipped locally with an explicit reason."""

import psycopg
import pytest
from conftest import SEED, World
from helpers import fails

POINT = "extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)"
INSERT_STATION = (
    "insert into public.stations (org_id, code, name, geom, source_type) "
    f"values (%s, %s, %s, {POINT}, 'measured') returning id"
)


def _station(
    w: World, org: object, code: str = "ST-001", lon: float = 32.5, lat: float = 0.3
) -> object:
    return w.db.one(INSERT_STATION, (org, code, f"Station {code}", lon, lat))


def _seed_demo(w: World) -> None:
    w.db.su()
    w.db.conn.execute(SEED.read_text())


def test_org_isolation_for_stations_and_sensors(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    sid = _station(w, w.org_a)
    w.db.one(
        "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)"
        " values (%s, %s, 'water_level', 'm', 900, 'measured') returning id",
        (w.org_a, sid),
    )
    w.as_("bob")
    assert w.db.one("select count(*) from public.stations") == 0
    assert w.db.one("select count(*) from public.sensors") == 0
    assert w.db.one("select count(*) from public.stations_geo") == 0
    assert w.db.run("update public.stations set name = 'x'") == 0
    assert w.db.run("delete from public.stations") == 0
    fails(w.db, psycopg.errors.InsufficientPrivilege if False else psycopg.errors.Error,  # noqa: SIM210
          INSERT_STATION, (w.org_a, "X-1", "Intruder", 32.0, 0.0))  # fmt: skip
    w.as_("alice")
    assert w.db.one("select count(*) from public.stations") == 1


def test_anonymous_sees_nothing(geo_world: World) -> None:
    w = geo_world
    _seed_demo(w)
    w.db.anon()
    for rel in (
        "stations",
        "sensors",
        "locations",
        "rivers",
        "catchments",
        "stations_geo",
        "rivers_geo",
    ):
        fails(w.db, psycopg.errors.InsufficientPrivilege, f"select count(*) from public.{rel}")


def test_demo_stations_readable_by_any_signed_in_user_but_not_writable(geo_world: World) -> None:
    w = geo_world
    _seed_demo(w)
    demo_org = w.db.one("select id from public.organizations where is_demo")
    w.as_("bob")  # an org_admin of a different organisation
    assert w.db.one("select count(*) from public.stations where org_id = %s", (demo_org,)) == 6
    assert w.db.one("select count(*) from public.sensors where org_id = %s", (demo_org,)) == 12
    assert w.db.run("update public.stations set name = 'Hacked'") == 0
    assert w.db.run("delete from public.stations") == 0
    fails(w.db, psycopg.errors.Error, INSERT_STATION, (demo_org, "X-1", "Intruder", 32.0, 0.0))
    # a user with no membership at all can still read the demo (and nothing else)
    w.db.su()
    nobody = w.db.one("insert into auth.users (email) values ('nobody@x.test') returning id")
    w.db.act(nobody, "nobody@x.test", "aal1")  # type: ignore[arg-type]
    assert w.db.one("select count(*) from public.stations") == 6


def test_demo_data_is_synthetic_unvalidated_and_labelled(geo_world: World) -> None:
    w = geo_world
    _seed_demo(w)
    w.db.su()
    rows = w.db.q(
        "select source_type::text, status::text, notes from public.stations where code like 'DEMO-%'"
    )
    assert len(rows) == 6
    assert {r[0] for r in rows} == {"synthetic"} and {r[1] for r in rows} == {"unvalidated"}
    assert all(r[2].startswith("SYNTHETIC DEMO") for r in rows)
    assert w.db.one("select count(*) from public.sensors where source_type <> 'synthetic'") == 0
    assert (
        w.db.one("select count(*) from public.rivers where geom is not null") == 0
    )  # no invented geometry


def test_seed_is_idempotent(geo_world: World) -> None:
    w = geo_world
    _seed_demo(w)
    _seed_demo(w)
    assert w.db.one("select count(*) from public.stations") == 6
    assert w.db.one("select count(*) from public.sensors") == 12
    assert w.db.one("select count(*) from public.rivers") == 6


def test_status_and_source_type_cannot_be_set_by_app_roles(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    sid = _station(w, w.org_a)
    fails(w.db, psycopg.errors.InsufficientPrivilege,
          "update public.stations set status = 'operational' where id = %s", (sid,))  # fmt: skip
    fails(w.db, psycopg.errors.InsufficientPrivilege,
          "update public.stations set source_type = 'measured' where id = %s", (sid,))  # fmt: skip
    fails(w.db, psycopg.errors.InsufficientPrivilege,
          "insert into public.stations (org_id, code, name, geom, source_type, status) values "
          f"(%s, 'Z-1', 'z', {POINT}, 'measured', 'validated')", (w.org_a, 32.0, 0.0))  # fmt: skip
    assert w.db.one("select status::text from public.stations where id = %s", (sid,)) == "unvalidated"


def test_station_writes_need_devices_manage_and_mfa(geo_world: World) -> None:
    w = geo_world
    w.as_("carol")  # hydrologist: can read, cannot manage devices
    fails(w.db, psycopg.errors.Error, INSERT_STATION, (w.org_a, "C-1", "x", 32.0, 0.0))
    w.as_("frank", aal="aal1")  # field technician without MFA
    fails(w.db, psycopg.errors.Error, INSERT_STATION, (w.org_a, "F-1", "x", 32.0, 0.0))
    w.as_("frank", aal="aal2")
    assert _station(w, w.org_a, "F-2")


def test_hydrologist_can_read_org_stations(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    _station(w, w.org_a)
    w.as_("carol")
    assert w.db.one("select count(*) from public.stations") == 1
    w.as_("dave")  # community_member: no sensors.read
    assert w.db.one("select count(*) from public.stations") == 0


def test_sensor_must_belong_to_stations_organisation(geo_world: World) -> None:
    w = geo_world
    w.as_("bob")
    sid = _station(w, w.org_b, "B-1")
    w.db.su()
    with pytest.raises(psycopg.errors.ForeignKeyViolation), w.db.conn.transaction():
        w.db.conn.execute(
            "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)"
            " values (%s, %s, 'rainfall', 'mm', 900, 'measured')", (w.org_a, sid))  # fmt: skip


def test_elevation_requires_a_source_and_coordinates_are_bounded(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    fails(w.db, psycopg.errors.CheckViolation,
          f"insert into public.stations (org_id, code, name, geom, elevation_m, source_type) "
          f"values (%s, 'E-1', 'e', {POINT}, 1200, 'measured')", (w.org_a, 32.0, 0.0))  # fmt: skip
    fails(w.db, psycopg.errors.CheckViolation,
          f"insert into public.stations (org_id, code, name, geom, source_type) "
          f"values (%s, 'E-2', 'e', {POINT}, 'measured')", (w.org_a, 32.0, 95.0))  # fmt: skip


def test_station_changes_are_audited(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    sid = _station(w, w.org_a)
    w.db.run("update public.stations set name = 'Renamed' where id = %s", (sid,))
    w.db.su()
    acts = w.db.q("select action from public.audit_log where entity_type = 'stations' order by id")
    assert acts == [("insert",), ("update",)]


def test_stations_geo_exposes_lat_lon_and_river(geo_world: World) -> None:
    w = geo_world
    _seed_demo(w)
    w.as_("alice")
    row = w.db.q(
        "select lat, lon, river_name, source_type::text from public.stations_geo where code = 'DEMO-NILE-01'"
    )[0]
    assert (round(float(row[0]), 4), round(float(row[1]), 4)) == (0.4236, 33.204)
    assert row[2] == "Nile" and row[3] == "synthetic"


def test_river_geometry_view_hides_rivers_without_geometry(geo_world: World) -> None:
    w = geo_world
    _seed_demo(w)
    w.db.su()
    w.db.run("insert into public.rivers (name, geom, source, source_type) values "
             "('Test', extensions.st_setsrid(extensions.st_geomfromtext('MULTILINESTRING((32 0,33 1))'),4326),"
             " 'test file', 'measured')")  # fmt: skip
    w.as_("carol")
    assert [r[0] for r in w.db.q("select name from public.rivers_geo")] == ["Test"]
    assert w.db.one("select count(*) from public.rivers") == 7


def test_app_roles_cannot_write_reference_geography(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    for sql in (
        "insert into public.rivers (name, source, source_type) values ('X', 's', 'measured')",
        "insert into public.catchments (name, source, source_type) values ('X', 's', 'measured')",
        "update public.rivers set name = 'X'",
        "insert into public.geo_imports (kind, source, licence, source_type, filename, file_sha256, feature_count, imported_by)"
        " values ('rivers','s','l','measured','f','h',1,'me')",
    ):
        fails(w.db, psycopg.errors.InsufficientPrivilege, sql)
    fails(w.db, psycopg.errors.InsufficientPrivilege, "select filename from public.geo_imports")


def test_spatial_queries_use_gist_indexes(geo_world: World) -> None:
    """Build requirement: spatial queries use GiST indexes (confirmed with EXPLAIN)."""
    w = geo_world
    w.db.su()
    w.db.run(
        "insert into public.stations (org_id, code, name, geom, source_type) "
        "select %s, 'G-' || g, 'g' || g, extensions.st_setsrid(extensions.st_makepoint("
        "29.5 + (g %% 50) * 0.1, -1.4 + (g / 50) * 0.01), 4326), 'synthetic' from generate_series(1, 5000) g",
        (w.org_a,),
    )
    w.db.run("analyze public.stations")
    plan = "\n".join(
        r[0]
        for r in w.db.q(
            "explain select id from public.stations where geom OPERATOR(extensions.&&) "
            "extensions.st_makeenvelope(30.0, -1.0, 30.2, -0.9, 4326)"
        )
    )
    assert "stations_geom_gix" in plan, plan
    plan2 = "\n".join(
        r[0]
        for r in w.db.q(
            "explain select id from public.stations order by geom OPERATOR(extensions.<->) "
            "extensions.st_setsrid(extensions.st_makepoint(30.0, -1.0), 4326) limit 5"
        )
    )
    assert "stations_geom_gix" in plan2, plan2


@pytest.mark.parametrize("table", ["rivers", "catchments", "locations", "stations"])
def test_every_geometry_column_has_a_gist_index(geo_world: World, table: str) -> None:
    n = geo_world.db.one(
        "select count(*) from pg_indexes where schemaname='public' and tablename=%s and indexdef ilike '%%using gist%%'",
        (table,),
    )
    assert n == 1
