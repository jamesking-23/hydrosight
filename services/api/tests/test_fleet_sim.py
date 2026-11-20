"""HS-ING-014..016: device simulator with injected faults; 50-device end-to-end test with measured
latency. The unit tests run anywhere; the fleet test needs PostGIS (CI)."""

import random
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import World

from hydrosight_api.simulator import (
    SKEW_S,
    SimDevice,
    db_sender,
    device_batches,
    parse_faults,
    run_fleet,
    seed_fleet,
    summarize,
)


def _devs(n: int = 3) -> list[SimDevice]:
    return [SimDevice(f"d{i}", f"k{i}", f"l{i}", f"b{i}", f"r{i}") for i in range(n)]


def _step(
    devs: list[SimDevice], step: int, spec: str, total: int = 12
) -> list[tuple[int, dict[str, Any]]]:
    now = datetime.now(UTC)
    return device_batches(devs, step, now, parse_faults(spec), random.Random(1), now, total)  # noqa: S311


def test_fault_spec_parsing_and_validation() -> None:
    f = parse_faults("dropout:3:4-8, spike:7:6")
    assert [(x.kind, x.device, x.start, x.end) for x in f] == [
        ("dropout", 3, 4, 8),
        ("spike", 7, 6, 6),
    ]
    for bad in ("nope:1:1", "spike:x:1", "spike:1:9-2", "spike"):
        with pytest.raises(ValueError):  # noqa: PT011
            parse_faults(bad)


def test_dropout_sends_nothing_and_does_not_count_records() -> None:
    d = _devs(2)
    assert [i for i, _ in _step(d, 5, "dropout:0:5-6")] == [1]
    assert d[0].seq == {}  # a device that is off records nothing


def test_sequence_numbers_count_per_sensor() -> None:
    d = _devs(1)
    for s in range(3):
        batch = _step(d, s, "")[0][1]
    assert [r["sequence"] for r in batch["readings"]] == [2, 2, 2]


def test_buffered_device_holds_then_uploads_everything_at_the_end_of_the_window() -> None:
    d = _devs(1)
    assert _step(d, 4, "buffered:0:4-6") == [] and _step(d, 5, "buffered:0:4-6") == []
    sent = _step(d, 6, "buffered:0:4-6")[0][1]
    assert len(sent["readings"]) == 9  # three steps x three sensors


def test_spike_drift_flatline_and_clock_skew_change_the_data() -> None:
    clean = _step(_devs(1), 3, "")[0][1]["readings"][0]["value"]
    spiked = _step(_devs(1), 3, "spike:0:3")[0][1]["readings"][0]["value"]
    assert spiked - clean > 2.5
    d = _devs(1)
    first = _step(d, 3, "flatline:0:3-9")[0][1]["readings"][0]["value"]
    assert _step(d, 4, "flatline:0:3-9")[0][1]["readings"][0]["value"] == first
    skewed = _step(_devs(1), 3, "clock_skew:0:3")[0][1]
    assert (
        abs(
            (datetime.fromisoformat(skewed["sent_at"]) - datetime.now(UTC)).total_seconds() + SKEW_S
        )
        < 5
    )


def test_latency_summary_is_computed_from_samples() -> None:
    s = summarize([float(x) for x in range(1, 101)])
    assert s["n"] == 100 and s["p50_ms"] == 50 and s["p95_ms"] == 95 and s["max_ms"] == 100
    assert summarize([]) == {"n": 0}


def test_run_fleet_reports_failed_sends_instead_of_hiding_them() -> None:
    def boom(_k: str, _b: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("link down")

    out = run_fleet(_devs(2), 2, 300, [], boom)
    assert out["error_count"] == 4 and out["batches"] == 0 and "link down" in out["errors"][0]


def test_seed_refuses_non_demo_organisations() -> None:
    class Conn:
        def execute(self, *_a: Any) -> Any:
            return type("R", (), {"fetchone": lambda _s: ("org-id", False)})()

    with pytest.raises(SystemExit, match="is_demo"):
        seed_fleet(Conn(), "customer", 1)


# --------------------------------------------------------------------------- end to end (CI)

N_DEVICES = 50
STEPS = 24
FAULTS = (
    "dropout:3:8-12,dropout:4:19-23,spike:7:10,drift:11:10-23,flatline:15:8-23,"
    "clock_skew:19:0-23,buffered:23:10-14"
)


def test_fifty_device_fleet_detects_injected_faults_and_reports_latency(geo_world: World) -> None:
    w = geo_world
    w.db.su()
    w.db.run("update public.organizations set is_demo = true where id = %s", (w.org_a,))
    slug = w.db.one("select slug from public.organizations where id = %s", (w.org_a,))
    fleet = seed_fleet(w.db.conn, slug, N_DEVICES, 300)
    devices = [
        SimDevice(d["name"], d["key"], d["level"], d["level_b"], d["rain"])
        for d in fleet["devices"]
    ]
    w.db.service()
    out = run_fleet(devices, STEPS, 300, parse_faults(FAULTS), db_sender(w.db.conn))
    print(
        "FLEET_LATENCY",
        out["latency"],
        "batches/s",
        out["batches_per_s"],
        "elapsed_s",
        out["elapsed_s"],
    )
    assert out["error_count"] == 0 and out["rejected"] == 0
    assert out["accepted"] > N_DEVICES * 3 * (STEPS - 6)

    w.db.su()

    def flags(dev: int, check: str) -> int:
        return w.db.one(  # type: ignore[no-any-return]
            "select count(*) from public.reading_flags f join public.sensors s on s.id = f.sensor_id"
            " join public.devices d on d.id = s.device_id where d.name = %s and f.check_name = %s",
            (fleet["devices"][dev]["name"], check),
        )

    assert flags(7, "spike") >= 1  # one wild value
    assert flags(11, "cross_sensor") >= 1  # slow drift away from the twin sensor
    assert flags(15, "flatline") >= 1  # frozen value
    # no false alarms: devices without injected faults carry no suspect or bad readings
    faulted = {3, 4, 7, 11, 15, 19, 23}
    clean = [d["name"] for i, d in enumerate(fleet["devices"]) if i not in faulted]
    assert w.db.one(
        "select count(*) from public.readings r join public.devices d on d.id = r.device_id"
        " where d.name = any(%s) and r.quality in ('suspect', 'bad')", (clean,)) == 0  # fmt: skip

    # a mid-run dropout leaves a gap that is reported, never filled automatically
    gap_sensor = fleet["devices"][3]["level"]
    gaps = w.db.q(
        "select missing_intervals from public.sensor_gaps(%s, now() - interval '3 hours', now())",
        (gap_sensor,),
    )
    assert gaps and gaps[0][0] >= 4
    assert w.db.one("select count(*) from public.readings where source_type = 'estimated'") == 0

    # clock skew was detected and corrected; buffered uploads are marked delayed
    name19, name23 = fleet["devices"][19]["name"], fleet["devices"][23]["name"]
    assert abs(w.db.one("select max(abs(clock_skew_s)) from public.readings r join public.devices d on d.id = r.device_id where d.name = %s", (name19,)) - SKEW_S) < 60  # fmt: skip
    assert w.db.one("select count(*) from public.readings r join public.devices d on d.id = r.device_id where d.name = %s and r.delayed", (name23,)) >= 6  # fmt: skip

    # a device whose last contact was a while ago is reported offline (time is advanced for the test)
    w.db.run("update public.device_health h set last_seen_at = now() - interval '20 minutes' from public.devices d where d.id = h.device_id and d.name = %s", (fleet["devices"][4]["name"],))  # fmt: skip
    status = dict(w.db.q("select name, status from public.device_status"))
    assert status[fleet["devices"][4]["name"]] == "offline"
    assert status[fleet["devices"][0]["name"]] in ("online", "degraded")
    assert w.db.one("select count(*) from public.device_status where status = 'offline'") >= 1
