"""Device fleet simulator for SYNTHETIC data, with injected faults.

Safety: `seed` works only in an organisation flagged as demo, and every sensor it creates is
source_type 'synthetic', so simulated data can never be shown or exported as measured.

    # create a synthetic fleet in the demo org; writes device keys to a private file (never commit)
    DATABASE_URL=... python -m hydrosight_api.simulator seed --devices 50 --out fleet.json
    # replay one hour of data with faults, straight into the database functions, and time it
    DATABASE_URL=... python -m hydrosight_api.simulator run --fleet fleet.json --steps 12 \
        --faults "dropout:3:4-8,spike:7:6,drift:11:2-12,flatline:15:3-12,clock_skew:19:0-12,buffered:23:4-8"
    # or send through the HTTP API
    python -m hydrosight_api.simulator run --fleet fleet.json --target http --url https://<api>

Fault kinds: dropout (device sends nothing), buffered (device holds data and uploads later),
spike (one wild value), drift (primary water-level sensor slowly diverges from its twin),
flatline (value frozen), clock_skew (device clock 2 hours behind).
"""

import argparse
import json
import math
import os
import random
import statistics
import sys
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

FAULT_KINDS = ("dropout", "buffered", "spike", "drift", "flatline", "clock_skew")
SKEW_S = 7200  # clock_skew fault: the device clock runs two hours behind
Sender = Callable[[str, dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class Fault:
    kind: str
    device: int
    start: int
    end: int  # inclusive


def parse_faults(spec: str) -> list[Fault]:
    """'kind:device:start-end' or 'kind:device:step', comma separated."""
    faults: list[Fault] = []
    for part in filter(None, (p.strip() for p in spec.split(","))):
        try:
            kind, dev, window = part.split(":")
            start, _, end = window.partition("-")
            fault = Fault(kind, int(dev), int(start), int(end) if end else int(start))
        except ValueError as exc:
            raise ValueError(f"bad fault '{part}': use kind:device:start-end") from exc
        if fault.kind not in FAULT_KINDS or fault.end < fault.start:
            raise ValueError(f"bad fault '{part}': kind must be one of {', '.join(FAULT_KINDS)}")
        faults.append(fault)
    return faults


@dataclass
class SimDevice:
    name: str
    key: str
    level: str  # primary water-level sensor id
    level_b: str  # redundant twin at the same station
    rain: str
    seq: dict[str, int] = field(default_factory=dict)
    held: list[dict[str, Any]] = field(default_factory=list)
    frozen: float | None = None
    last_sent_step: int | None = None


def _active(faults: list[Fault], kind: str, dev: int, step: int) -> Fault | None:
    return next(
        (f for f in faults if f.kind == kind and f.device == dev and f.start <= step <= f.end), None
    )


def device_batches(
    devices: list[SimDevice], step: int, observed: datetime, faults: list[Fault],
    rng: random.Random, send_time: datetime, steps_total: int,
) -> list[tuple[int, dict[str, Any]]]:  # fmt: skip
    """One simulation step: the batch each device sends now (devices that send nothing are absent)."""
    out: list[tuple[int, dict[str, Any]]] = []
    for i, d in enumerate(devices):
        base = 2.0 + (i % 7) * 0.4 + 0.5 * math.sin(2 * math.pi * (step + i) / 288)
        level = base + rng.gauss(0, 0.01)
        level_b = base + rng.gauss(0, 0.01)
        rain = round(rng.choice([0.0] * 9 + [rng.uniform(0.2, 2.0)]), 2)
        if _active(faults, "spike", i, step):
            level += 3.0
        if (f := _active(faults, "drift", i, step)) is not None:
            level += 0.05 * (step - f.start + 1)
        if (f := _active(faults, "flatline", i, step)) is not None:
            if d.frozen is None:
                d.frozen = level
            level = d.frozen
        else:
            d.frozen = None
        skew = timedelta(seconds=SKEW_S) if _active(faults, "clock_skew", i, step) else timedelta()
        stamp = (observed - skew).isoformat()
        if _active(faults, "dropout", i, step):
            continue  # nothing recorded, nothing sent: the data is genuinely missing
        rows = []
        for sensor, value in ((d.level, level), (d.level_b, level_b), (d.rain, rain)):
            d.seq[sensor] = d.seq.get(sensor, -1) + 1  # the device counts every record it makes
            rows.append({"sensor_id": sensor, "observed_at": stamp, "value": round(value, 4),
                         "sequence": d.seq[sensor]})  # fmt: skip
        d.held.extend(rows)
        if (
            (f := _active(faults, "buffered", i, step)) is not None
            and step < f.end
            and step < steps_total - 1
        ):
            continue  # the device holds readings and uploads them when its link returns
        batch = {
            "sent_at": (send_time - skew).isoformat(),
            "battery_pct": round(max(5.0, 100 - 0.4 * step - i * 0.3), 1),
            "signal_dbm": -65 - (i % 5) * 4,
            "firmware": "simulator-1",
            "readings": d.held,
        }
        d.held = []
        d.last_sent_step = step
        out.append((i, batch))
    return out


def summarize(latencies_ms: list[float]) -> dict[str, float]:
    if not latencies_ms:
        return {"n": 0}
    s = sorted(latencies_ms)

    def pct(p: float) -> float:
        return round(s[min(len(s) - 1, math.ceil(p / 100 * len(s)) - 1)], 2)

    return {"n": len(s), "mean_ms": round(statistics.fmean(s), 2), "p50_ms": pct(50),
            "p95_ms": pct(95), "p99_ms": pct(99), "max_ms": round(s[-1], 2)}  # fmt: skip


def run_fleet(devices: list[SimDevice], steps: int, interval_s: int, faults: list[Fault],
         send: Sender, seed: int = 7) -> dict[str, Any]:  # fmt: skip
    rng = random.Random(seed)
    now = datetime.now(UTC)
    latencies: list[float] = []
    totals = {"accepted": 0, "duplicate": 0, "rejected": 0, "batches": 0}
    errors: list[str] = []
    wall = time.perf_counter()
    for step in range(steps):
        observed = now - timedelta(seconds=(steps - 1 - step) * interval_s)
        for i, batch in device_batches(devices, step, observed, faults, rng, now, steps):
            t0 = time.perf_counter()
            try:
                res = send(devices[i].key, batch)
            except Exception as exc:  # noqa: BLE001 - a failed send is reported, never hidden
                errors.append(str(exc))
                continue
            latencies.append((time.perf_counter() - t0) * 1000)
            totals["batches"] += 1
            for k in ("accepted", "duplicate", "rejected"):
                totals[k] += int(res.get(k, 0))
    elapsed = time.perf_counter() - wall
    return {**totals, "errors": errors[:5], "error_count": len(errors),
            "latency": summarize(latencies), "elapsed_s": round(elapsed, 2),
            "batches_per_s": round(totals["batches"] / elapsed, 2) if elapsed else 0}  # fmt: skip


def db_sender(conn: Any) -> Sender:
    """Calls the same database functions as the API (ingest, quality control, alert engine)."""
    from hydrosight_api.ingest import post_process

    def send(key: str, batch: dict[str, Any]) -> dict[str, Any]:
        row = conn.execute(
            "select public.ingest_device_batch(%s, %s)", (key, Jsonb(batch))
        ).fetchone()
        return post_process(conn, batch["readings"], dict(row[0]))

    return send


def http_sender(url: str) -> Sender:
    def send(key: str, batch: dict[str, Any]) -> dict[str, Any]:
        req = urllib.request.Request(
            url.rstrip("/") + "/v1/ingest/readings", data=json.dumps(batch).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": key}, method="POST",
        )  # fmt: skip
        with urllib.request.urlopen(req, timeout=30) as resp:
            body: dict[str, Any] = json.loads(resp.read())
            return body

    return send


def run_simulation(devices: list[SimDevice], steps: int, interval_s: int, faults: list[Fault],
                   send: Sender, seed: int = 7) -> dict[str, Any]:  # fmt: skip
    return run_fleet(devices, steps, interval_s, faults, send, seed)


# --------------------------------------------------------------------------- seeding

POINT = "extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326)"


def seed_fleet(conn: Any, org_slug: str, n_devices: int, interval_s: int = 300) -> dict[str, Any]:
    """Create `n_devices` synthetic devices (each: a station, a primary and a twin water-level sensor,
    a rain gauge, QC configuration, a device key) in a DEMO organisation. Needs the database owner."""
    row = conn.execute(
        "select id, is_demo from public.organizations where slug = %s", (org_slug,)
    ).fetchone()
    if row is None:
        raise SystemExit(f"organisation '{org_slug}' not found")
    if not row[1]:
        raise SystemExit("refusing: the simulator only writes to organisations flagged is_demo")
    org = row[0]
    tag = f"{int(time.time()) % 10_000_000:07d}"
    devices: list[dict[str, Any]] = []
    for i in range(n_devices):
        code = f"SIM-{tag}-{i:03d}"
        st = conn.execute(
            "insert into public.stations (org_id, code, name, geom, source_type, notes) "
            f"values (%s, %s, %s, {POINT}, 'synthetic', 'SYNTHETIC simulator station') returning id",
            (org, code, f"Simulated {code}", 30.0 + (i % 10) * 0.2, -1.0 + (i // 10) * 0.2),
        ).fetchone()[0]
        sensors = {}
        for role, kind, unit in (
            ("level", "water_level", "m"),
            ("level_b", "water_level", "m"),
            ("rain", "rainfall", "mm"),
        ):
            sensors[role] = conn.execute(
                "insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)"
                " values (%s, %s, %s, %s, %s, 'synthetic') returning id",
                (org, st, kind, unit, interval_s),
            ).fetchone()[0]
        dev = conn.execute(
            "insert into public.devices (org_id, station_id, name, expected_interval_s) values (%s, %s, %s, %s) returning id",
            (org, st, code, interval_s),
        ).fetchone()[0]
        conn.execute(
            "update public.sensors set device_id = %s where id = any(%s)",
            (dev, list(sensors.values())),
        )
        conn.execute(
            "insert into public.device_health (device_id, org_id) values (%s, %s)", (dev, org)
        )
        for role in ("level", "level_b"):
            conn.execute(
                "insert into public.sensor_qc_config (sensor_id, org_id, min_value, max_value, max_rate_per_hour,"
                " flatline_n, cross_sensor_max_diff) values (%s, %s, 0, 20, 2.0, 6, 0.3)",
                (sensors[role], org),
            )
        conn.execute(
            "insert into public.sensor_qc_config (sensor_id, org_id, min_value, max_value) values (%s, %s, 0, 200)",
            (sensors["rain"], org),
        )
        key = "hsk_" + os.urandom(4).hex() + "_" + os.urandom(24).hex()
        conn.execute(
            "insert into public.api_keys (org_id, name, key_prefix, key_hash, scopes, device_id)"
            " values (%s, %s, %s, private.hash_secret(%s), array['readings.write'], %s)",
            (org, f"device: {code}", key[4:12], key, dev),
        )
        devices.append({"name": code, "key": key, **{k: str(v) for k, v in sensors.items()}})
    return {"org": org_slug, "interval_s": interval_s, "devices": devices}


def load_fleet(path: str) -> tuple[list[SimDevice], int]:
    data = json.loads(open(path).read())  # noqa: SIM115
    return [
        SimDevice(d["name"], d["key"], d["level"], d["level_b"], d["rain"]) for d in data["devices"]
    ], int(data["interval_s"])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="hydrosight_api.simulator", description=__doc__.split("\n")[0]
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    sd = sub.add_parser("seed")
    sd.add_argument("--devices", type=int, default=50)
    sd.add_argument("--org-slug", default="hydrosight-demo")
    sd.add_argument("--interval", type=int, default=300)
    sd.add_argument("--out", default="fleet.json")
    rn = sub.add_parser("run")
    rn.add_argument("--fleet", default="fleet.json")
    rn.add_argument("--steps", type=int, default=12)
    rn.add_argument("--faults", default="")
    rn.add_argument("--target", choices=("db", "http"), default="db")
    rn.add_argument("--url", default="")
    a = ap.parse_args(argv)
    if a.cmd == "seed":
        url = os.environ.get("DATABASE_URL", "")
        if not url:
            print("DATABASE_URL is not set.")
            return 2
        with psycopg.connect(url, prepare_threshold=None) as conn:
            fleet = seed_fleet(conn, a.org_slug, a.devices, a.interval)
        fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump(fleet, fh)
        print(
            f"created {len(fleet['devices'])} synthetic devices; keys written to {a.out} (private, never commit)"
        )
        return 0
    devices, interval = load_fleet(a.fleet)
    faults = parse_faults(a.faults)
    if a.target == "http":
        if not a.url:
            print("--url is required for --target http")
            return 2
        print(
            json.dumps(
                run_simulation(devices, a.steps, interval, faults, http_sender(a.url)), indent=2
            )
        )
        return 0
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL is not set.")
        return 2
    with psycopg.connect(url, prepare_threshold=None, autocommit=False) as conn:
        result = run_simulation(devices, a.steps, interval, faults, db_sender(conn))
        conn.commit()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
