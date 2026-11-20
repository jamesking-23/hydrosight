"""HS-ING-006..013: devices and credentials, device ingestion, clock skew, QC flags, calibration,
gaps and interpolation, device health. Needs PostGIS (CI); skipped locally with a reason."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from conftest import World
from helpers import fails
from test_alerts import _add_user, _evaluate, _rule
from test_readings import _ingest, _item, _key, _sensor
from test_stations import _station

NoPerm = psycopg.errors.InsufficientPrivilege
BadInput = psycopg.errors.InvalidParameterValue
BadState = psycopg.errors.ObjectNotInPrerequisiteState
BadKey = psycopg.errors.InvalidAuthorizationSpecification


def _iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(UTC) + delta).isoformat()


def _device(w: World, kinds: tuple[str, ...] = ("water_level",), interval: int = 300,
            code: str = "D-1", name: str = "Dev") -> tuple[Any, list[Any], Any, str]:  # fmt: skip
    """A station with one sensor per kind, provisioned as one device by alice (org_admin)."""
    w.as_("alice")
    st = _station(w, w.org_a, code)
    sensors = [
        w.db.one(
            "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)"
            " values (%s, %s, %s, 'u', %s, 'synthetic') returning id",
            (w.org_a, st, k, interval),
        )
        for k in kinds
    ]
    res = w.db.one(
        "select public.provision_device(%s, %s, %s, %s, %s::uuid[], null)",
        (w.org_a, name, st, interval, sensors),
    )
    return st, sensors, uuid.UUID(res["device_id"]), res["api_key"]


def _batch(w: World, key: str, readings: list[dict[str, Any]], **meta: Any) -> dict[str, Any]:
    w.db.service()
    body = {"readings": readings, **meta}
    return w.db.one("select public.ingest_device_batch(%s, %s::jsonb)", (key, json.dumps(body)))  # type: ignore[no-any-return]


def _ins(w: World, sensor: Any, value: float, age_min: float, seq: int | None = None,
         source: str = "synthetic", received_ago_min: float = 0) -> Any:  # fmt: skip
    w.db.su()
    return w.db.one(
        "insert into public.readings (org_id, sensor_id, observed_at, value, source_type, sequence, received_at)"
        " select org_id, id, now() - make_interval(mins => %s), %s, %s::public.source_type, %s,"
        " now() - make_interval(mins => %s) from public.sensors where id = %s returning id",
        (age_min, value, source, seq, received_ago_min, sensor),
    )


def _qc(w: World) -> dict[str, Any]:
    w.db.service()
    return w.db.one("select public.run_qc(null)")  # type: ignore[no-any-return]


def _cfg(w: World, sensor: Any, mn: Any = None, mx: Any = None, rate: Any = None,
         flat: Any = None, cross: Any = None) -> None:  # fmt: skip
    w.as_("alice")
    w.db.q(
        "select public.set_sensor_qc_config(%s, %s, %s, %s, %s, %s)",
        (sensor, mn, mx, rate, flat, cross),
    )


def _flags(w: World, reading: Any) -> dict[str, str]:
    w.db.su()
    return dict(
        w.db.q(
            "select check_name, severity from public.reading_flags where reading_id = %s",
            (reading,),
        )
    )


def _quality(w: World, reading: Any) -> str:
    w.db.su()
    return str(w.db.one("select quality::text from public.readings where id = %s", (reading,)))


# --------------------------------------------------------------------------- device registry


def test_provisioning_returns_a_device_key_once_and_stores_only_its_hash(geo_world: World) -> None:
    w = geo_world
    _, sensors, dev, key = _device(w)
    assert key.startswith("hsk_")
    w.db.su()
    assert (
        w.db.one(
            "select count(*) from public.api_keys where device_id = %s and key_hash = %s",
            (dev, key),
        )
        == 0
    )
    assert (
        w.db.one(
            "select count(*) from public.api_keys where device_id = %s and revoked_at is null",
            (dev,),
        )
        == 1
    )
    assert w.db.one("select scopes from public.api_keys where device_id = %s", (dev,)) == [
        "readings.write"
    ]
    assert w.db.one("select device_id from public.sensors where id = %s", (sensors[0],)) == dev
    assert w.db.one("select count(*) from public.audit_log where entity_type = 'devices'") >= 1


def test_only_device_managers_in_the_same_org_can_provision(geo_world: World) -> None:
    w = geo_world
    w.as_("alice")
    st = _station(w, w.org_a, "P-1")
    for who in ("dave", "carol", "bob"):
        w.as_(who)
        fails(
            w.db,
            NoPerm,
            "select public.provision_device(%s, 'X', %s, 300, '{}'::uuid[], null)",
            (w.org_a, st),
        )
    w.as_("frank")  # field_technician holds devices.manage and readings.write
    assert w.db.one(
        "select public.provision_device(%s, 'X', %s, 300, '{}'::uuid[], null)", (w.org_a, st)
    )


def test_device_key_writes_only_its_own_sensors(geo_world: World) -> None:
    w = geo_world
    _, s1, _, key1 = _device(w, code="D-1", name="One")
    _, s2, _, _ = _device(w, code="D-2", name="Two")
    res = _batch(w, key1, [_item(s1[0]), _item(s2[0])])
    assert (res["accepted"], res["rejected"]) == (1, 1)
    assert res["results"][1]["reason"] == "sensor_not_on_device"


def test_unbound_org_key_cannot_use_the_device_endpoint_but_v1_still_works(
    geo_world: World,
) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    org_key = _key(w, w.org_a)
    w.db.service()
    fails(
        w.db,
        NoPerm,
        "select public.ingest_device_batch(%s, %s::jsonb)",
        (org_key, json.dumps({"readings": [_item(s[0])]})),
    )
    assert _ingest(w, org_key, [_item(s[0])])["accepted"] == 1


def test_rotation_revokes_the_old_key_and_retirement_revokes_all(geo_world: World) -> None:
    w = geo_world
    _, s, dev, old = _device(w)
    w.as_("alice")
    new = w.db.one("select public.rotate_device_key(%s)", (dev,))
    assert new != old
    w.db.service()
    fails(
        w.db,
        BadKey,
        "select public.ingest_device_batch(%s, %s::jsonb)",
        (old, json.dumps({"readings": [_item(s[0])]})),
    )
    assert _batch(w, new, [_item(s[0])])["accepted"] == 1
    w.as_("alice")
    w.db.q("select public.retire_device(%s)", (dev,))
    w.db.service()
    fails(
        w.db,
        BadKey,
        "select public.ingest_device_batch(%s, %s::jsonb)",
        (new, json.dumps({"readings": [_item(s[0], 2.0)]})),
    )
    w.as_("alice")
    fails(w.db, BadState, "select public.rotate_device_key(%s)", (dev,))


def test_app_roles_cannot_write_devices_calibrations_or_flags_directly(geo_world: World) -> None:
    w = geo_world
    _, s, dev, _ = _device(w)
    w.as_("alice")
    for sql in (
        "update public.devices set status = 'retired'",
        "delete from public.devices",
        "insert into public.calibrations (org_id, sensor_id, effective_from, note) select org_id, id, now(), 'abc' from public.sensors",
        "update public.device_health set battery_pct = 100",
        "insert into public.reading_flags (reading_id, org_id, sensor_id, check_name, severity) values (1, gen_random_uuid(), gen_random_uuid(), 'range', 'bad')",
    ):
        fails(w.db, NoPerm, sql)


def test_devices_are_tenant_isolated(geo_world: World) -> None:
    w = geo_world
    _device(w)
    w.as_("bob")
    assert w.db.one("select count(*) from public.devices") == 0
    assert w.db.one("select count(*) from public.device_status") == 0


# --------------------------------------------------------------------------- device ingestion


def test_clock_skew_is_corrected_and_the_original_timestamp_is_kept(geo_world: World) -> None:
    w = geo_world
    _, s, _, key = _device(w)
    device_time = datetime.now(UTC) - timedelta(hours=2)  # the device clock runs 2 h behind
    res = _batch(w, key, [_item(s[0], 1.0, (device_time - timedelta(minutes=1)).isoformat())],
                 sent_at=device_time.isoformat())  # fmt: skip
    assert res["skew_corrected"] is True and abs(res["clock_skew_s"] - 7200) < 10
    w.db.su()
    obs, dev_obs, skew = w.db.q(
        "select observed_at, device_observed_at, clock_skew_s from public.readings"
    )[0]
    assert datetime.now(UTC) - obs < timedelta(minutes=3)
    assert abs((dev_obs - (device_time - timedelta(minutes=1))).total_seconds()) < 1
    assert abs(skew - 7200) < 10


def test_small_skew_is_recorded_but_not_corrected_and_absurd_skew_is_refused(
    geo_world: World,
) -> None:
    w = geo_world
    _, s, _, key = _device(w)
    at = _iso(timedelta(minutes=-1))
    res = _batch(w, key, [_item(s[0], 1.0, at)], sent_at=_iso(timedelta(seconds=-10)))
    assert res["skew_corrected"] is False
    w.db.su()
    assert w.db.one("select observed_at = %s::timestamptz from public.readings", (at,)) is True
    w.db.service()
    body = {"sent_at": _iso(timedelta(days=-40)), "readings": [_item(s[0], 2.0)]}
    fails(
        w.db, BadInput, "select public.ingest_device_batch(%s, %s::jsonb)", (key, json.dumps(body))
    )


def test_offline_buffered_uploads_are_accepted_and_marked_delayed(geo_world: World) -> None:
    w = geo_world
    _, s, _, key = _device(w)
    items = [_item(s[0], 1.0 + i, _iso(timedelta(hours=-3, minutes=5 * i))) for i in range(3)]
    res = _batch(w, key, items, sent_at=_iso())
    assert res["accepted"] == 3
    w.db.su()
    assert w.db.one("select bool_and(delayed) from public.readings") is True


def test_battery_signal_sequence_and_last_seen_are_stored(geo_world: World) -> None:
    w = geo_world
    _, s, dev, key = _device(w)
    items = [{**_item(s[0], 1.0), "sequence": 41}]
    _batch(w, key, items, battery_pct=87.5, signal_dbm=-71, firmware="1.2.3", sent_at=_iso())
    w.db.su()
    batt, sig, fw, seen = w.db.q(
        "select battery_pct, signal_dbm, firmware, last_seen_at from public.device_health"
    )[0]
    assert (batt, sig, fw) == (87.5, -71, "1.2.3") and seen is not None
    assert w.db.one("select sequence from public.readings") == 41
    # invalid health values are ignored, never stored
    _batch(w, key, [_item(s[0], 2.0, _iso(timedelta(minutes=-2)))], battery_pct=900)
    w.db.su()
    assert (
        w.db.one("select battery_pct from public.device_health where device_id = %s", (dev,))
        == 87.5
    )


def test_bad_sequence_is_rejected_as_malformed_and_empty_batch_is_refused(geo_world: World) -> None:
    w = geo_world
    _, s, _, key = _device(w)
    res = _batch(
        w,
        key,
        [
            {**_item(s[0]), "sequence": -3},
            {**_item(s[0], 2.0, _iso(timedelta(minutes=-2))), "sequence": "x"},
        ],
    )
    assert res["rejected"] == 2
    w.db.service()
    fails(
        w.db,
        BadInput,
        "select public.ingest_device_batch(%s, %s::jsonb)",
        (key, json.dumps({"readings": []})),
    )


# --------------------------------------------------------------------------- raw data and QC


def test_raw_readings_are_immutable_but_quality_can_change(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    rid = _ins(w, s, 1.0, 5, source="measured")
    w.db.su()
    fails(w.db, BadState, "update public.readings set value = 9 where id = %s", (rid,))
    fails(w.db, BadState, "update public.readings set observed_at = now() where id = %s", (rid,))
    assert w.db.run("update public.readings set quality = 'good' where id = %s", (rid,)) == 1


def test_without_configuration_readings_stay_unchecked_but_are_marked_processed(
    geo_world: World,
) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    rid = _ins(w, s[0], 1.0, 5)
    assert _qc(w)["unchecked_no_config"] == 1
    assert _quality(w, rid) == "unchecked"
    w.db.su()
    assert w.db.one("select qc_at is not null from public.readings where id = %s", (rid,)) is True
    assert _qc(w)["processed"] == 0


def test_range_failure_is_bad_and_a_clean_reading_is_good(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _cfg(w, s[0], mn=0, mx=10)
    ok, high = _ins(w, s[0], 3.0, 10), _ins(w, s[0], 11.0, 5)
    _qc(w)
    assert _quality(w, ok) == "good" and _flags(w, ok) == {}
    assert _quality(w, high) == "bad" and _flags(w, high)["range"] == "bad"


def test_spike_is_flagged_and_raw_value_is_untouched(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _cfg(w, s[0], rate=1.0)
    _ins(w, s[0], 1.0, 30)
    spike = _ins(w, s[0], 5.0, 25)
    _qc(w)
    assert _quality(w, spike) == "suspect" and _flags(w, spike)["spike"] == "suspect"
    w.db.su()
    assert w.db.one("select value from public.readings where id = %s", (spike,)) == 5.0


def test_flatline_is_flagged_after_n_identical_readings(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _cfg(w, s[0], flat=3)
    r = [_ins(w, s[0], 2.0, m) for m in (15, 10, 5)]
    _qc(w)
    assert _flags(w, r[0]) == {} and _flags(w, r[1]) == {}
    assert _flags(w, r[2])["flatline"] == "suspect"


def test_cross_sensor_disagreement_flags_both_twins(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w, kinds=("water_level", "water_level"))
    for sensor in s:
        _cfg(w, sensor, cross=0.5)
    a, b = _ins(w, s[0], 1.0, 5), _ins(w, s[1], 2.0, 5)
    _qc(w)
    assert _flags(w, a)["cross_sensor"] == "suspect" and _flags(w, b)["cross_sensor"] == "suspect"
    c, d = _ins(w, s[0], 1.0, 2), _ins(w, s[1], 1.2, 2)
    _qc(w)
    assert _flags(w, c) == {} and _flags(w, d) == {}


def test_sequence_checks_and_stale_arrival_are_informational_or_suspect(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _cfg(w, s[0], mn=0, mx=100)
    r1 = _ins(w, s[0], 1.0, 30, seq=10)
    r2 = _ins(w, s[0], 1.1, 25, seq=14)  # 3 records missing
    r3 = _ins(w, s[0], 1.2, 20, seq=14)  # replayed counter
    r4 = _ins(w, s[0], 1.3, 90, seq=9, received_ago_min=0)  # arrives 90 min late (interval 5 min)
    _qc(w)
    assert _flags(w, r1) == {}
    assert _flags(w, r2).get("duplicate_sequence") == "suspect"
    assert _flags(w, r3).get("duplicate_sequence") == "suspect"
    assert _flags(w, r4)["stale"] == "info"
    w.db.su()
    assert (
        w.db.one("select quality::text from public.readings where id = %s", (r4,)) == "good"
    )  # info never degrades


def test_sequence_gap_is_recorded(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _ins(w, s[0], 1.0, 30, seq=10)
    r2 = _ins(w, s[0], 1.1, 25, seq=14)
    _qc(w)
    assert _flags(w, r2)["sequence_gap"] == "info"
    w.db.su()
    assert (
        w.db.one(
            "select detail ->> 'missing' from public.reading_flags where reading_id = %s", (r2,)
        )
        == "3"
    )


def test_engine_evaluates_suspect_readings_but_ignores_bad_ones(geo_world: World) -> None:
    w = geo_world
    _, s = _sensor(w, w.org_a)
    _rule(w, s, value=5.0, cooldown=0)
    w.db.su()
    bad = _ins(w, s, 9.0, 1, source="measured")
    w.db.run("update public.readings set quality = 'bad' where id = %s", (bad,))
    assert _evaluate(w, [s])["evaluated"] == 0
    w.db.su()
    w.db.run("update public.readings set quality = 'suspect' where id = %s", (bad,))
    assert _evaluate(w, [s])["created"] == 1
    w.db.su()
    ev = w.db.one("select evidence -> 0 ->> 'quality' from public.alerts")
    assert ev == "suspect"  # the human reviewer sees the flag


# --------------------------------------------------------------------------- calibration


def test_calibration_is_applied_at_read_time_and_raw_is_retained(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _ins(w, s[0], 1.0, 2)
    w.as_("alice")
    w.db.q(
        "select public.add_calibration(%s, 2.0, 0.5, now() - interval '1 day', 'Checked against staff gauge')",
        (s[0],),
    )
    w.db.q(
        "select public.add_calibration(%s, 9.0, 0.0, now() + interval '1 day', 'Future change, not yet effective')",
        (s[0],),
    )
    w.as_("carol")
    row = w.db.q(
        "select last_value, last_raw_value, calibrated from public.sensor_status where sensor_id = %s",
        (s[0],),
    )[0]
    assert row == (2.5, 1.0, True)
    assert w.db.q("select value, raw_value from public.readings_calibrated")[0] == (2.5, 1.0)
    w.db.su()
    assert w.db.one("select value from public.readings") == 1.0


def test_calibration_needs_devices_manage_and_is_append_only(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    w.as_("carol")
    fails(w.db, NoPerm, "select public.add_calibration(%s, 1, 0, now(), 'abc')", (s[0],))
    w.as_("alice")
    w.db.q("select public.add_calibration(%s, 1, 1, now(), 'offset check')", (s[0],))
    w.db.su()
    fails(w.db, NoPerm, "update public.calibrations set scale = 3")


def test_alert_engine_uses_calibrated_values(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _rule(w, s[0], value=5.0, cooldown=0)
    _ins(w, s[0], 3.0, 1)
    assert _evaluate(w, [s[0]])["created"] == 0
    w.as_("alice")
    w.db.q(
        "select public.add_calibration(%s, 2.0, 0, now() - interval '1 day', 'Gain correction after survey')",
        (s[0],),
    )
    assert _evaluate(w, [s[0]])["created"] == 1
    w.db.su()
    assert w.db.one("select (evidence -> 0 ->> 'raw_value')::float from public.alerts") == 3.0


# --------------------------------------------------------------------------- gaps


def test_missing_stays_missing_and_interpolation_is_estimated_and_never_trusted(
    geo_world: World,
) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    a, b = _ins(w, s[0], 1.0, 60), _ins(w, s[0], 2.0, 30)
    w.as_("carol")
    gap = w.db.q(
        "select missing_intervals, has_estimates from public.sensor_gaps(%s, now() - interval '2 hours', now())",
        (s[0],),
    )
    assert gap == [(5, False)]
    w.as_("alice")
    start, end = w.db.q("select observed_at from public.readings order by observed_at")
    assert w.db.one("select public.interpolate_gap(%s, %s, %s)", (s[0], start[0], end[0])) == 5
    w.db.su()
    est = w.db.q(
        "select value, source_type::text, quality::text from public.readings where source_type = 'estimated' order by observed_at"
    )
    assert len(est) == 5 and all(r[1] == "estimated" for r in est)
    assert abs(est[0][0] - (1.0 + 1 / 6)) < 1e-9 and abs(est[-1][0] - (2.0 - 1 / 6)) < 1e-9
    assert (
        w.db.one("select count(*) from public.reading_flags where check_name = 'interpolated'") == 5
    )
    assert (
        w.db.one("select count(*) from public.readings where source_type <> 'estimated'") == 2
    )  # raw kept
    w.as_("carol")  # the gap is still reported, now marked as having estimates
    assert w.db.q(
        "select missing_intervals, has_estimates from public.sensor_gaps(%s, now() - interval '2 hours', now())",
        (s[0],),
    ) == [(5, True)]
    assert a and b


def test_estimated_readings_never_drive_freshness_or_alerts(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w)
    _rule(w, s[0], value=5.0, cooldown=0)
    _ins(w, s[0], 1.0, 20)
    _ins(w, s[0], 99.0, 1, source="estimated")
    assert _evaluate(w, [s[0]])["created"] == 0
    w.as_("carol")
    assert (
        w.db.one("select freshness from public.sensor_status where sensor_id = %s", (s[0],))
        == "stale"
    )


def test_interpolation_guards(geo_world: World) -> None:
    w = geo_world
    _, s, _, _ = _device(w, kinds=("water_level", "rainfall"))
    _ins(w, s[1], 1.0, 60)
    _ins(w, s[1], 2.0, 30)
    for age in (300, 30):
        _ins(w, s[0], 1.0, age)
    w.db.su()
    t = [
        r[0]
        for r in w.db.q(
            "select observed_at from public.readings where sensor_id = %s order by observed_at",
            (s[1],),
        )
    ]
    long = [
        r[0]
        for r in w.db.q(
            "select observed_at from public.readings where sensor_id = %s order by observed_at",
            (s[0],),
        )
    ]
    w.as_("alice")
    fails(
        w.db, BadInput, "select public.interpolate_gap(%s, %s, %s)", (s[1], t[0], t[1])
    )  # rainfall
    fails(
        w.db, BadInput, "select public.interpolate_gap(%s, %s, %s)", (s[0], long[0], long[1])
    )  # too long
    w.as_("dave")
    fails(w.db, NoPerm, "select public.interpolate_gap(%s, %s, %s)", (s[0], long[0], long[1]))


# --------------------------------------------------------------------------- device health


def test_device_status_online_degraded_and_offline(geo_world: World) -> None:
    w = geo_world
    _, s, dev, key = _device(w, interval=300)
    w.as_("carol")
    assert w.db.q("select status, reasons from public.device_status") == [
        ("offline", ["never_reported"])
    ]
    _batch(w, key, [_item(s[0])], battery_pct=80, signal_dbm=-70)
    w.as_("carol")
    assert w.db.q("select status from public.device_status") == [("online",)]
    _batch(w, key, [_item(s[0], 2.0, _iso(timedelta(minutes=-2)))], battery_pct=5)
    w.as_("carol")
    assert w.db.q("select status, reasons from public.device_status") == [
        ("degraded", ["low_battery"])
    ]
    w.db.su()
    w.db.run(
        "update public.device_health set last_seen_at = now() - interval '16 minutes' where device_id = %s",
        (dev,),
    )
    w.as_("carol")
    status, reasons = w.db.q("select status, reasons from public.device_status")[0]
    assert status == "offline" and reasons == ["no_contact_within_3x_interval"]


def test_recent_quality_flags_degrade_a_device_and_retired_devices_disappear(
    geo_world: World,
) -> None:
    w = geo_world
    _, s, dev, key = _device(w)
    _cfg(w, s[0], mn=0, mx=10)
    _batch(w, key, [_item(s[0], 50.0)], battery_pct=90)
    _qc(w)
    w.as_("carol")
    assert w.db.q("select status, reasons from public.device_status") == [
        ("degraded", ["recent_quality_flags"])
    ]
    w.as_("alice")
    w.db.q("select public.retire_device(%s)", (dev,))
    assert w.db.one("select count(*) from public.device_status") == 0


def test_offline_multiple_is_configurable(geo_world: World) -> None:
    w = geo_world
    _, s, dev, key = _device(w, interval=300)
    _batch(w, key, [_item(s[0])])
    w.db.su()
    w.db.run("update public.devices set offline_multiple = 10 where id = %s", (dev,))
    w.db.run(
        "update public.device_health set last_seen_at = now() - interval '16 minutes' where device_id = %s",
        (dev,),
    )
    w.as_("carol")
    assert w.db.one("select status from public.device_status") == "online"


def test_community_member_sees_no_device_internals(geo_world: World) -> None:
    w = geo_world
    _device(w)
    _add_user(w, "outsider", "community_member", w.org_a)
    w.as_("outsider")
    assert w.db.one("select count(*) from public.devices") == 0
