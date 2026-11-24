"""HTTP load test for device ingestion (Phase 10). SYNTHETIC data only.

Usage (after `python -m hydrosight_api.simulator seed ... --out fleet.json` in a demo organisation):
    uv run python scripts/load-test.py --url http://localhost:8100 --fleet fleet.json \
        --concurrency 20 --requests 2000
Each request is one device batch (3 readings) with a fresh timestamp. Prints throughput, latency
percentiles and a count per HTTP status. These numbers describe THIS server, database and network;
they are not an SLA and say nothing about production.
"""

import argparse
import json
import random
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Lock

from hydrosight_api.simulator import device_batches, load_fleet


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--fleet", default="fleet.json")
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--requests", type=int, default=1000)
    a = ap.parse_args()
    devices, _ = load_fleet(a.fleet)
    steps = [0] * len(devices)
    lock = Lock()
    t0 = datetime.now(UTC) - timedelta(days=30)
    lat: list[float] = []
    codes: Counter[str] = Counter()

    def one(n: int) -> None:
        i = n % len(devices)
        with lock:
            step = steps[i]
            steps[i] += 1
        rng = random.Random(n)
        observed = t0 + timedelta(minutes=5 * step)
        out = device_batches([devices[i]], step, observed, [], rng, datetime.now(UTC), 1)
        if not out:
            return
        req = urllib.request.Request(
            a.url.rstrip("/") + "/v1/ingest/readings",
            data=json.dumps(out[0][1]).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": devices[i].key},
            method="POST",
        )
        s = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                r.read()
                code = str(r.status)
        except urllib.error.HTTPError as e:
            code = str(e.code)
        except Exception as e:  # noqa: BLE001
            code = type(e).__name__
        ms = (time.perf_counter() - s) * 1000
        with lock:
            lat.append(ms)
            codes[code] += 1

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=a.concurrency) as ex:
        list(ex.map(one, range(a.requests)))
    wall = time.perf_counter() - start
    q = statistics.quantiles(lat, n=100) if len(lat) > 1 else [0] * 99
    print(
        json.dumps(
            {
                "requests": len(lat),
                "concurrency": a.concurrency,
                "wall_s": round(wall, 2),
                "throughput_rps": round(len(lat) / wall, 1),
                "latency_ms": {
                    "p50": round(q[49], 1),
                    "p95": round(q[94], 1),
                    "p99": round(q[98], 1),
                    "max": round(max(lat), 1),
                },
                "status": dict(codes),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
