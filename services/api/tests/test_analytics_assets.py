"""HS-ANA-001..018: assets, exposure indicators, hazard zones, analytics, prediction
verification and the export log. Needs PostGIS (CI); skipped locally."""

import json
import uuid
from datetime import datetime, timedelta
from typing import Any

import psycopg
from conftest import World
from helpers import fails
from test_prediction_engine import REG, _register, _seed_station_with_history, _station_a

NoPerm = psycopg.errors.InsufficientPrivilege
BadInput = psycopg.errors.InvalidParameterValue
Check = psycopg.errors.CheckViolation

ADD = (
    "select public.add_asset(%s, %s, %s, %s, %s::numeric, %s::public.source_type, %s::numeric, %s, %s, null,"
    " 'estimated'::public.source_type)"
)
ZONE = "select public.add_hazard_zone(%s, %s, %s, %s, %s, 'estimated'::public.source_type, %s)"
VALUE_BASIS = "Replacement cost from the 2026 district valuation roll (test fixture)"


def _pt(lon: float, lat: float) -> str:
    return json.dumps({"type": "Point", "coordinates": [lon, lat]})


def _square(lon: float, lat: float, d: float = 0.01) -> str:
    ring = [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
    ]
    return json.dumps({"type": "Polygon", "coordinates": [ring]})


def _asset(w: World, who: str, name: str, geojson: str, *, org: Any = None, value: tuple[Any, ...] | None = None,
           elevation: tuple[Any, Any] = (None, None)) -> uuid.UUID:  # fmt: skip
    w.as_(who)
    amount, cur, basis = value or (None, None, None)
    return w.db.one(
        ADD,
        (org or w.org_a, name, "building", geojson, elevation[0], elevation[1], amount, cur, basis),
    )  # type: ignore[no-any-return]


def _zone(w: World, who: str, geojson: str, *, org: Any = None, name: str = "Zone A") -> uuid.UUID:
    w.as_(who)
    return w.db.one(
        ZONE,
        (
            org or w.org_a,
            name,
            "1 in 100 year (as labelled by the source)",
            "Test study 2024",
            "CC-BY test",
            geojson,
        ),
    )  # type: ignore[no-any-return]


def _exposure(w: World, who: str, asset: Any) -> Any:
    w.as_(who)
    return w.db.one("select public.asset_exposure(%s)", (asset,))


# --- assets ---------------------------------------------------------------------------------
def test_assets_need_permission_and_stay_in_their_organisation(geo_world: World) -> None:
    w = geo_world
    a = _asset(w, "alice", "Clinic", _pt(30.0, 0.05))
    assert a and _asset(w, "alice", "Market", _square(30.0, 0.05))
    for who in ("dave", "eve"):  # community member; government authority reads but cannot register
        w.as_(who)
        fails(
            w.db, NoPerm, ADD, (w.org_a, "X", "building", _pt(30, 0), None, None, None, None, None)
        )
    w.as_("bob")
    fails(w.db, NoPerm, ADD, (w.org_a, "X", "building", _pt(30, 0), None, None, None, None, None))
    assert w.db.q("select 1 from public.assets") == []  # cannot see org A's assets
    assert w.db.one("select public.asset_exposure(%s)", (a,)) is None
    w.as_("eve")
    assert len(w.db.q("select 1 from public.assets")) == 2  # but can read them
    w.as_("dave")
    assert w.db.q("select 1 from public.assets") == []


def test_geometry_is_validated(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    args = (w.org_a, "X", "building", None, None, None, None, None, None)
    fails(w.db, BadInput, ADD, (*args[:3], "not geojson", *args[4:]))
    line = json.dumps({"type": "LineString", "coordinates": [[30, 0], [30.1, 0.1]]})
    fails(w.db, Check, ADD, (*args[:3], line, *args[4:]))  # points and polygons only
    fails(w.db, Check, ADD, (*args[:3], _pt(200.0, 0.0), *args[4:]))  # outside lon/lat range
    bowtie = json.dumps(
        {"type": "Polygon", "coordinates": [[[30, 0], [30.1, 0.1], [30.1, 0], [30, 0.1], [30, 0]]]}
    )
    fails(w.db, BadInput, ADD, (*args[:3], bowtie, *args[4:]))  # self-intersecting
    fails(
        w.db, Check, "select public.add_asset(%s, 'X', 'castle', %s)", (w.org_a, _pt(30, 0))
    )  # unknown kind


def test_value_and_elevation_need_their_documentation(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    pt = _pt(30.0, 0.05)
    fails(
        w.db, Check, ADD, (w.org_a, "X", "building", pt, 1200.5, None, None, None, None)
    )  # elevation, no source
    fails(
        w.db, Check, ADD, (w.org_a, "X", "building", pt, None, None, 5000, None, None)
    )  # amount, no currency
    fails(
        w.db, Check, ADD, (w.org_a, "X", "building", pt, None, None, 5000, "UGX", "guess")
    )  # basis too short
    fails(w.db, Check, ADD, (w.org_a, "X", "building", pt, None, None, -1, "UGX", VALUE_BASIS))
    ok = _asset(
        w,
        "alice",
        "School",
        pt,
        value=(250000000, "ugx", VALUE_BASIS),
        elevation=(1204.5, "estimated"),
    )
    w.as_("alice")
    w.db.run(
        "select public.set_asset_value(%s, null, null, null)", (ok,)
    )  # removing a value is allowed
    assert w.db.one("select value_amount from public.assets where id = %s", (ok,)) is None
    fails(w.db, BadInput, "select public.set_asset_value(%s, 100, 'UGX', 'x')", (ok,))
    w.as_("dave")
    fails(w.db, NoPerm, "select public.set_asset_value(%s, 100, 'UGX', %s)", (ok, VALUE_BASIS))
    w.as_("alice")
    for sql in ("update public.assets set name = 'x'", "delete from public.assets"):
        fails(w.db, NoPerm, sql)  # no direct writes


# --- exposure indicators -----------------------------------------------------------------------
def test_missing_layers_are_not_assessed_never_safe(geo_world: World) -> None:
    w = geo_world
    a = _asset(w, "alice", "Clinic", _pt(30.0, 0.05), value=(1000, "UGX", VALUE_BASIS))
    e = _exposure(w, "alice", a)
    assert e["elevation"]["status"] == "not_provided"
    assert (
        e["waterway"]["status"] == "not_assessed" and "No river geometry" in e["waterway"]["note"]
    )
    assert e["hazard"]["status"] == "not_assessed" and e["hazard"]["loaded_zones"] == 0
    assert "Not an established loss" in e["value"]["label"]
    assert any("No damage curve" in s for s in e["assumptions"])
    b = _asset(w, "alice", "Bare", _pt(30.0, 0.05))
    assert _exposure(w, "alice", b)["value"] is None  # no value supplied, none invented


def test_distance_and_hazard_intersection(geo_world: World) -> None:
    w = geo_world
    w.db.su()
    w.db.run(
        "insert into public.rivers (name, geom, source, source_type) values ('Test river',"
        " extensions.st_geomfromtext('MULTILINESTRING((30.0 0.0, 30.0 0.1))', 4326), 'test fixture', 'synthetic')"
    )
    near = _asset(w, "alice", "Near", _pt(30.001, 0.05), elevation=(1204.5, "measured"))
    far = _asset(w, "alice", "Far", _pt(30.5, 0.5))
    _zone(w, "carol", _square(30.0, 0.05, 0.01))
    e = _exposure(w, "alice", near)
    assert e["waterway"]["status"] == "assessed" and e["waterway"]["nearest"] == "Test river"
    assert (
        100 <= float(e["waterway"]["distance_m"]) <= 125
    )  # ~0.001 degree of longitude at the equator
    assert "not a flow path" in e["waterway"]["note"]
    assert e["elevation"] == {"status": "provided", "value_m": 1204.5, "source_type": "measured"}
    assert e["hazard"]["status"] == "inside" and e["hazard"]["zones"][0]["status"] == "unvalidated"
    f = _exposure(w, "alice", far)
    assert (
        f["hazard"]["status"] == "outside_loaded_zones"
        and "does not mean safe" in f["hazard"]["note"]
    )


def test_portfolio_sums_only_supplied_values_inside_loaded_zones(geo_world: World) -> None:
    w = geo_world
    _asset(w, "alice", "In 1", _pt(30.0, 0.05), value=(1000, "UGX", VALUE_BASIS))
    _asset(w, "alice", "In 2", _pt(30.001, 0.051), value=(500, "UGX", VALUE_BASIS))
    _asset(w, "alice", "In no value", _pt(30.002, 0.052))
    _asset(w, "alice", "Out", _pt(31.0, 1.0), value=(99999, "UGX", VALUE_BASIS))
    _zone(w, "carol", _square(30.0, 0.05, 0.01))
    w.as_("alice")
    p = w.db.one("select public.portfolio_exposure(%s)", (w.org_a,))
    assert len(p["assets"]) == 4
    assert p["value_inside_loaded_zones_by_currency"] == [
        {"currency": "UGX", "amount": 1500, "assets": 2}
    ]
    assert any("no damage curve" in s.lower() for s in p["assumptions"])
    w.as_("bob")  # another organisation sees nothing of it
    assert w.db.one("select public.portfolio_exposure(%s)", (w.org_a,))["assets"] == []


def test_retired_assets_leave_the_exposure_views(geo_world: World) -> None:
    w = geo_world
    a = _asset(w, "alice", "Old shed", _pt(30.0, 0.05))
    w.as_("alice")
    w.db.run("select public.retire_asset(%s)", (a,))
    assert w.db.one("select public.asset_exposure(%s)", (a,)) is None
    assert w.db.one("select public.portfolio_exposure(%s)", (w.org_a,))["assets"] == []
    w.as_("dave")
    fails(w.db, NoPerm, "select public.retire_asset(%s)", (a,))


def test_hazard_zones_need_provenance_polygons_and_authority(geo_world: World) -> None:
    w = geo_world
    assert _zone(w, "carol", _square(30, 0.05))
    w.as_("carol")
    fails(
        w.db, BadInput, ZONE, (w.org_a, "P", "scenario text", "src", "licence", _pt(30, 0))
    )  # not a polygon
    fails(
        w.db, Check, ZONE, (w.org_a, "P", "scenario text", "", "licence", _square(30, 0))
    )  # source required
    fails(
        w.db, Check, ZONE, (w.org_a, "P", "scenario text", "src", "", _square(30, 0))
    )  # licence required
    fails(
        w.db,
        Check,
        "select public.add_hazard_zone(%s, 'P', 'scenario text', 'src', 'lic', 'forecast', %s)",
        (w.org_a, _square(30, 0)),
    )
    for who in ("dave", "bob"):
        w.as_(who)
        fails(w.db, NoPerm, ZONE, (w.org_a, "P", "scenario text", "src", "licence", _square(30, 0)))
    w.db.su()
    assert w.db.one("select status::text from public.hazard_zones") == "unvalidated"


# --- export log ----------------------------------------------------------------------------------
LOG = "select public.log_report_export(%s, 'analytics', 'csv', now() - interval '30 days', now(), %s, '{\"rows\": 3}'::jsonb)"


def test_export_log_is_append_only_and_tenant_scoped(geo_world: World) -> None:
    w = geo_world
    sha = "a" * 64
    w.as_("alice")
    assert w.db.one(LOG, (w.org_a, sha))
    fails(w.db, Check, LOG, (w.org_a, "not-a-hash"))
    w.as_("dave")
    fails(w.db, NoPerm, LOG, (w.org_a, sha))
    w.as_("bob")
    fails(w.db, NoPerm, LOG, (w.org_a, sha))
    assert w.db.q("select 1 from public.report_exports") == []
    w.db.su()
    fails(w.db, NoPerm, "update public.report_exports set format = 'pdf'")
    fails(w.db, NoPerm, "delete from public.report_exports")
    w.db.service()
    fails(w.db, NoPerm, "insert into public.report_exports (org_id, kind, format, content_sha256, generated_by)"
          " values (%s, 'assets', 'csv', %s, %s)", (w.org_a, sha, w.users["alice"]))  # fmt: skip


# --- analytics ------------------------------------------------------------------------------------
def _window(end: datetime, hours: int) -> tuple[datetime, datetime]:
    return end - timedelta(hours=hours - 1), end + timedelta(hours=1)


def test_station_analytics_summarise_what_is_stored(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w, hours=24 * 30)
    w.db.su()
    w.db.run(
        "update public.readings set quality = 'bad' where observed_at > %s",
        (end - timedelta(hours=24),),
    )
    frm, to = _window(end, 24 * 30)
    w.as_("carol")
    out = w.db.one("select public.analytics_station(%s, %s, %s, 1.5)", (st, frm, to))
    kinds = {s["kind"]: s for s in out["sensors"]}
    assert set(kinds) == {"water_level", "rainfall"}
    lvl = kinds["water_level"]["summary"]
    assert lvl["readings"] == 720 and lvl["quality_bad"] == 24
    assert lvl["used_in_statistics"] == 720 - 24 and lvl["completeness"] == 1.0
    assert lvl["min"] <= lvl["mean"] <= lvl["max"]
    assert kinds["water_level"]["source_type"] == "synthetic"
    assert sum(m["readings"] for m in kinds["water_level"]["monthly"]) == 720 - 24
    assert sum(x["received"] for x in kinds["water_level"]["weekly_performance"]) == 720
    assert kinds["water_level"]["days_at_or_above_level"] is not None
    assert (
        kinds["rainfall"]["days_at_or_above_level"] is None
    )  # a level only applies to water level
    assert (
        kinds["water_level"]["annual_maxima"][0]["year"] == end.year
        or len(kinds["water_level"]["annual_maxima"]) == 2
    )


def test_gaps_show_as_lower_completeness_not_filled_in(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w, hours=24 * 10)
    w.db.su()
    w.db.run("delete from public.readings where observed_at between %s and %s",
             (end - timedelta(hours=100), end - timedelta(hours=50)))  # fmt: skip
    frm, to = _window(end, 24 * 10)
    w.as_("carol")
    out = w.db.one("select public.analytics_station(%s, %s, %s)", (st, frm, to))
    s = next(x for x in out["sensors"] if x["kind"] == "water_level")["summary"]
    assert s["readings"] == 240 - 51 and s["completeness"] < 0.8
    assert s["expected_readings"] == 240 or s["expected_readings"] == 241


def test_analytics_window_limits_and_tenant_isolation(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w, hours=24 * 10)
    w.as_("carol")
    fails(
        w.db,
        BadInput,
        "select public.analytics_station(%s, now(), now() - interval '1 day')",
        (st,),
    )
    fails(
        w.db,
        BadInput,
        "select public.analytics_station(%s, now() - interval '6 years', now())",
        (st,),
    )
    w.as_("bob")
    assert (
        w.db.one("select public.analytics_station(%s, now() - interval '10 days', now())", (st,))
        is None
    )
    w.as_("dave")  # a community member cannot read readings
    out = w.db.one("select public.analytics_station(%s, now() - interval '10 days', now())", (st,))
    assert out is None or all(s["summary"]["readings"] == 0 for s in out["sensors"])


# --- prediction verification -----------------------------------------------------------------------
def test_prediction_verification_counts_outcomes_independently(geo_world: World) -> None:
    w = geo_world
    st, end = _seed_station_with_history(w, hours=24 * 20)
    model = _register(w, "carol", "persistence")
    w.db.su()
    sensor = w.db.one(
        "select id from public.sensors where station_id = %s and kind = 'water_level'", (st,)
    )
    thr = 1.0
    cases = [
        (end - timedelta(hours=h), p)
        for h, p in ((300, 0.8), (200, 0.2), (150, 0.6), (100, 0.9), (40, 0.1))
    ]
    cases.append((end - timedelta(hours=24 * 20 + 40), 0.7))  # before any reading: outcome unknown
    snap = json.dumps(
        {
            "stage_sensor_id": str(sensor),
            "threshold": {"value": thr, "unit": "m", "rationale": "fixture"},
        }
    )
    w.db.service()
    for issued, prob in cases:
        w.db.run(
            "insert into public.predictions (org_id, station_id, model_version_id, target, issued_at, valid_from,"
            " valid_to, horizon_hours, probability, source_type, input_snapshot) values"
            " (%s,%s,%s,'flood_occurrence',%s,%s,%s,6,%s,'synthetic',%s::jsonb)",
            (w.org_a, st, model, issued, issued, issued + timedelta(hours=6), prob, snap),
        )
    w.db.run(
        "insert into public.predictions (org_id, station_id, model_version_id, target, issued_at, valid_from,"
        " valid_to, horizon_hours, probability, source_type, input_snapshot) values"
        " (%s,%s,%s,'flood_occurrence', now(), now(), now() + interval '6 hours', 6, 0.5,'synthetic',%s::jsonb)",
        (w.org_a, st, model, snap),
    )  # still in the future: not yet verifiable

    expected = dict(hits=0, misses=0, false_alarms=0, correct_negatives=0, unknown=0)
    w.db.su()
    for issued, prob in cases:
        n, mx = w.db.q(
            "select count(*), max(value) from public.readings_calibrated where sensor_id = %s"
            " and observed_at > %s and observed_at <= %s", (sensor, issued, issued + timedelta(hours=6)))[0]  # fmt: skip
        if n == 0:
            expected["unknown"] += 1
            continue
        happened, warned = mx >= thr, prob >= 0.5
        key = {(True, True): "hits", (True, False): "misses", (False, True): "false_alarms",
               (False, False): "correct_negatives"}[(happened, warned)]  # fmt: skip
        expected[key] += 1
    w.as_("carol")
    res = w.db.one(
        "select public.prediction_verification(%s, now() - interval '60 days', now() + interval '1 day', 0.5)",
        (w.org_a,),
    )
    assert (
        len(res) == 1
        and res[0]["model"] == "persistence 1"
        and res[0]["includes_synthetic"] is True
    )
    r = res[0]
    assert (r["hits"], r["misses"], r["false_alarms"], r["correct_negatives"]) == (
        expected["hits"], expected["misses"], expected["false_alarms"], expected["correct_negatives"])  # fmt: skip
    assert r["outcome_unknown"] == expected["unknown"] == 1 and r["predictions"] == 6
    assert 0 <= r["brier"] <= 1
    fails(
        w.db,
        BadInput,
        "select public.prediction_verification(%s, now() - interval '1 day', now(), 0)",
        (w.org_a,),
    )
    w.as_("bob")
    assert (
        w.db.one(
            "select public.prediction_verification(%s, now() - interval '60 days', now(), 0.5)",
            (w.org_a,),
        )
        == []
    )


def test_register_helper_import_is_used() -> None:
    assert "register_model_version" in REG and callable(_station_a)
