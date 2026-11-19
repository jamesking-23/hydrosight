"""HS-ING-001..005: readings ingestion, plausibility, freshness, forecasts, isolation.
Needs PostGIS (CI); skipped locally with an explicit reason."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest
from conftest import SEED, World
from helpers import fails
from test_stations import _station

KEY_COUNTER = [0]


def _iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def _sensor(w: World, org: Any, kind: str = "water_level", interval: int = 900,
            stype: str = "measured", code: str = "ST-001") -> tuple[Any, Any]:  # fmt: skip
    """Create a station + sensor as the org admin of `org` (alice for A, bob for B)."""
    w.as_("alice" if org == w.org_a else "bob")
    sid = _station(w, org, code)
    sensor = w.db.one(
        "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)"
        " values (%s, %s, %s, 'u', %s, %s) returning id",
        (org, sid, kind, interval, stype),
    )
    return sid, sensor


def _key(w: World, org: Any, scopes: tuple[str, ...] = ("readings.write",), **cols: Any) -> str:
    KEY_COUNTER[0] += 1
    key = f"hsk_test{KEY_COUNTER[0]:04d}_{uuid.uuid4().hex}"
    w.db.su()
    w.db.run(
        "insert into public.api_keys (org_id, name, key_prefix, key_hash, scopes, expires_at, revoked_at)"
        " values (%s, 'k', 'test', private.hash_secret(%s), %s, %s, %s)",
        (org, key, list(scopes), cols.get("expires_at"), cols.get("revoked_at")),
    )
    return key


def _ingest(w: World, key: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    w.db.service()
    return w.db.one("select public.ingest_readings(%s, %s::jsonb)", (key, json.dumps(items)))  # type: ignore[no-any-return]


def _item(sensor: Any, value: Any = 1.5, at: str | None = None) -> dict[str, Any]:
    return {
        "sensor_id": str(sensor),
        "observed_at": at or _iso(timedelta(minutes=-1)),
        "value": value,
    }


def test_accepts_valid_reading_and_inherits_sensor_source_type(geo_world: World) -> None:
    w = geo_world
    _, s_meas = _sensor(w, w.org_a, code="M-1")
    _, s_syn = _sensor(w, w.org_a, stype="synthetic", code="S-1")
    key = _key(w, w.org_a)
    res = _ingest(w, key, [_item(s_meas), _item(s_syn)])
    assert (res["accepted"], res["duplicate"], res["rejected"]) == (2, 0, 0)
    w.db.su()
    rows = dict(w.db.q("select sensor_id::text, source_type::text from public.readings"))
    assert rows[str(s_meas)] == "measured"
    assert rows[str(s_syn)] == "synthetic"  # a synthetic sensor can never yield "measured"
    assert w.db.one("select distinct quality::text from public.readings") == "unchecked"


def test_duplicate_is_idempotent_and_conflict_is_rejected_not_overwritten(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    key = _key(w, w.org_a)
    at = _iso(timedelta(minutes=-2))
    assert _ingest(w, key, [_item(s, 2.0, at)])["accepted"] == 1
    assert _ingest(w, key, [_item(s, 2.0, at)])["duplicate"] == 1
    res = _ingest(w, key, [_item(s, 9.9, at)])
    assert res["results"][0]["reason"] == "conflicts_with_stored_value"
    w.db.su()
    assert w.db.one("select value from public.readings") == 2.0


@pytest.mark.parametrize(
    ("kind", "value", "at", "reason"),
    [
        ("water_level", 1.0, timedelta(minutes=30), "timestamp_in_future"),
        ("water_level", 1.0, timedelta(days=-31), "too_old"),
        ("rainfall", -0.1, timedelta(minutes=-1), "negative_rainfall"),
        ("water_level", "1.0", timedelta(minutes=-1), "malformed"),
        ("water_level", None, timedelta(minutes=-1), "malformed"),
    ],
)
def test_rejections(geo_world: World, kind: str, value: Any, at: timedelta, reason: str) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a, kind=kind)
    key = _key(w, w.org_a)
    res = _ingest(w, key, [_item(s, value, _iso(at))])
    assert res["rejected"] == 1 and res["results"][0]["reason"] == reason
    w.db.su()
    assert w.db.one("select count(*) from public.readings") == 0


def test_malformed_ids_and_times_are_rejected_and_do_not_block_the_batch(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    key = _key(w, w.org_a)
    res = _ingest(w, key, [
        {"sensor_id": "not-a-uuid", "observed_at": _iso(), "value": 1},
        {"sensor_id": str(s), "observed_at": "yesterday-ish", "value": 1},
        "nonsense",
        _item(s, 3.0),
    ])  # fmt: skip
    assert (res["accepted"], res["rejected"]) == (1, 3)
    assert [r["reason"] for r in res["results"][:3]] == ["malformed"] * 3


def test_absurd_values_are_flagged_suspect_but_stored(geo_world: World) -> None:
    w = geo_world
    _, rain = _sensor(w, w.org_a, kind="rainfall", code="R-1")
    key = _key(w, w.org_a)
    assert _ingest(w, key, [_item(rain, 900.0)])["accepted"] == 1
    w.db.su()
    assert w.db.one("select quality::text from public.readings") == "suspect"


def test_water_level_has_no_universal_threshold(geo_world: World) -> None:
    """Rule: no universal flood thresholds. A very high or negative river stage is not judged."""
    w = geo_world
    _, s = _sensor(w, w.org_a)
    key = _key(w, w.org_a)
    res = _ingest(w, key, [_item(s, 250.0, _iso(timedelta(minutes=-3))), _item(s, -2.0)])
    assert res["accepted"] == 2
    w.db.su()
    assert w.db.one("select count(*) from public.readings where quality = 'suspect'") == 0


def test_key_cannot_write_to_another_orgs_sensor(geo_world: World) -> None:
    w = geo_world
    _, sensor_a = _sensor(w, w.org_a)
    key_b = _key(w, w.org_b)
    res = _ingest(w, key_b, [_item(sensor_a)])
    assert res["results"][0]["reason"] == "unknown_sensor"  # same answer as a nonexistent sensor
    w.db.su()
    assert w.db.one("select count(*) from public.readings") == 0


def test_key_validation(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    w.db.service()
    items = json.dumps([_item(s)])
    bad = [
        ("hsk_nope", psycopg.errors.InvalidAuthorizationSpecification),
        (_key(w, w.org_a, scopes=("readings.read",)), psycopg.errors.InsufficientPrivilege),
        (_key(w, w.org_a, revoked_at=datetime.now(UTC)), psycopg.errors.InvalidAuthorizationSpecification),
        (_key(w, w.org_a, expires_at=datetime.now(UTC) - timedelta(days=1)),
         psycopg.errors.InvalidAuthorizationSpecification),
    ]  # fmt: skip
    w.db.service()
    for key, exc in bad:
        fails(w.db, exc, "select public.ingest_readings(%s, %s::jsonb)", (key, items))


@pytest.mark.parametrize("payload", ["[]", "{}", "null", json.dumps([{}] * 1001)])
def test_batch_size_and_shape_limits(geo_world: World, payload: str) -> None:
    w = geo_world
    key = _key(w, w.org_a)
    w.db.service()
    fails(w.db, psycopg.errors.InvalidParameterValue,
          "select public.ingest_readings(%s, %s::jsonb)", (key, payload))  # fmt: skip


def test_app_roles_cannot_write_readings_or_call_ingest(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    key = _key(w, w.org_a)
    for who in ("alice", "frank"):  # even an org admin / technician cannot insert directly
        w.as_(who)
        fails(w.db, psycopg.errors.InsufficientPrivilege,
              "insert into public.readings (org_id, sensor_id, observed_at, value, source_type)"
              " values (%s, %s, now(), 1, 'measured')", (w.org_a, s))  # fmt: skip
        fails(w.db, psycopg.errors.InsufficientPrivilege,
              "select public.ingest_readings(%s, '[]'::jsonb)", (key,))  # fmt: skip
    w.db.anon()
    for rel in ("readings", "forecasts", "sensor_status", "forecast_latest"):
        fails(w.db, psycopg.errors.InsufficientPrivilege, f"select count(*) from public.{rel}")  # noqa: S608


def test_reading_visibility_is_tenant_scoped(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _ingest(w, _key(w, w.org_a), [_item(s)])
    w.as_("alice")
    assert w.db.one("select count(*) from public.readings") == 1
    w.as_("carol")  # hydrologist has readings.read
    assert w.db.one("select count(*) from public.readings") == 1
    w.as_("dave")  # community member: no readings.read
    assert w.db.one("select count(*) from public.readings") == 0
    w.as_("bob")
    assert w.db.one("select count(*) from public.readings") == 0
    assert w.db.one("select count(*) from public.sensor_status") == 0


def test_demo_org_readings_visible_to_any_signed_in_user_but_not_writable(geo_world: World) -> None:
    w = geo_world
    w.db.su()
    w.db.conn.execute(SEED.read_text())
    sensor = w.db.one("select id from public.sensors limit 1")
    org = w.db.one("select org_id from public.sensors where id = %s", (sensor,))
    w.db.run(
        "insert into public.readings (org_id, sensor_id, observed_at, value, source_type)"
        " values (%s, %s, now(), 1.0, 'synthetic')", (org, sensor),
    )  # fmt: skip
    w.as_("bob")
    assert w.db.one("select count(*) from public.readings") == 1
    fails(w.db, psycopg.errors.InsufficientPrivilege,
          "insert into public.readings (org_id, sensor_id, observed_at, value, source_type)"
          " values (%s, %s, now(), 2.0, 'measured')", (org, sensor))  # fmt: skip


def test_freshness_is_computed_from_expected_interval(geo_world: World) -> None:
    """Never show a last-known value as live (rule 6)."""
    w = geo_world
    interval = 900
    cases = {"live": 60, "stale": interval * 5, "offline": interval * 40}
    sensors: dict[str, Any] = {}
    for i, name in enumerate(["never", *cases]):
        _, sensors[name] = _sensor(w, w.org_a, code=f"F-{i}", interval=interval)
    w.db.su()
    for name, age_s in cases.items():
        w.db.run(
            "insert into public.readings (org_id, sensor_id, observed_at, value, source_type)"
            " values (%s, %s, now() - make_interval(secs => %s), 1.0, 'measured')",
            (w.org_a, sensors[name], age_s),
        )
    got = dict(w.db.q("select sensor_id::text, freshness from public.sensor_status"))
    assert got[str(sensors["never"])] == "never_reported"
    for name in cases:
        assert got[str(sensors[name])] == name
    never = w.db.q("select last_value, last_observed_at from public.sensor_status where sensor_id = %s",
                   (sensors["never"],))  # fmt: skip
    assert never == [(None, None)]


def test_forecasts_are_forecast_typed_licence_carrying_and_latest_run_wins(
    geo_world: World,
) -> None:
    w = geo_world
    station, _ = _sensor(w, w.org_a)
    valid = datetime.now(UTC) + timedelta(hours=3)
    w.db.service()
    ins = (
        "insert into public.forecasts (org_id, station_id, issued_at, valid_at, variable, value,"
        " model, provider_licence) values (%s, %s, %s, %s, 'precipitation_mm_1h', %s, 'm', 'CC BY 4.0')"
    )
    w.db.run(ins, (w.org_a, station, datetime.now(UTC) - timedelta(hours=6), valid, 1.0))
    w.db.run(ins, (w.org_a, station, datetime.now(UTC) - timedelta(hours=1), valid, 4.0))
    fails(
        w.db, psycopg.errors.CheckViolation, ins, (w.org_a, station, datetime.now(UTC), valid, -1.0)
    )
    fails(w.db, psycopg.errors.CheckViolation,
          "insert into public.forecasts (org_id, station_id, issued_at, valid_at, variable, value,"
          " model, provider_licence, source_type) values (%s, %s, now(), now(),"
          " 'precipitation_mm_1h', 1, 'm', 'l', 'measured')", (w.org_a, station))  # fmt: skip
    w.as_("alice")
    assert w.db.q("select value from public.forecast_latest") == [(4.0,)]
    assert w.db.one("select distinct source_type::text from public.forecast_latest") == "forecast"
    w.as_("bob")
    assert w.db.one("select count(*) from public.forecast_latest") == 0
    w.as_("alice")
    fails(
        w.db,
        psycopg.errors.InsufficientPrivilege,
        ins,
        (w.org_a, station, datetime.now(UTC), valid, 1.0),
    )


def test_readings_write_scope_is_not_privileged_and_given_to_device_roles(geo_world: World) -> None:
    w = geo_world
    w.db.su()
    assert (
        w.db.one("select privileged from public.permissions where key = 'readings.write'") is False
    )
    roles = {
        r[0]
        for r in w.db.q(
            "select role_key from public.role_permissions where permission_key = 'readings.write'"
        )
    }
    assert roles == {"org_admin", "field_technician", "sensor_operator"}
