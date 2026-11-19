"""Hourly rainfall forecast from MET Norway Locationforecast 2.0 (free; CC BY 4.0, commercial
use allowed; requires an identifying User-Agent with contact details and <= 4 decimals in
coordinates). Stored as source_type 'forecast' with model and licence recorded per row.

    FORECAST_USER_AGENT="HydroSight/1.0 (contact: you@example.com)" DATABASE_URL=... \
        python -m hydrosight_api.forecast_met [--dry-run]

Live behaviour against api.met.no is UNVERIFIED from the build environment (no network);
parsing is tested against a hand-written fixture that follows the documented response shape.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import psycopg

ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
MODEL = "MET Norway Locationforecast 2.0"
LICENCE = "CC BY 4.0 (MET Norway)"
Fetch = Callable[[str, str], bytes]  # (url, user_agent) -> body


def _utc(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


def parse_precipitation(doc: dict[str, Any]) -> tuple[datetime, list[tuple[datetime, float]]]:
    """Return (issued_at, [(valid_at, mm over the following hour)]). Entries without a
    1-hour precipitation amount are skipped (never guessed). Raises ValueError on a
    response that does not look like Locationforecast."""
    try:
        issued = _utc(doc["properties"]["meta"]["updated_at"])
        series = doc["properties"]["timeseries"]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("unexpected Locationforecast response shape") from exc
    out: list[tuple[datetime, float]] = []
    for entry in series:
        details = ((entry.get("data") or {}).get("next_1_hours") or {}).get("details") or {}
        amount = details.get("precipitation_amount")
        if isinstance(amount, int | float) and not isinstance(amount, bool) and amount >= 0:
            out.append((_utc(entry["time"]), float(amount)))
    return issued, out


def url_for(lat: float, lon: float) -> str:
    # The terms ask for at most 4 decimals (cache-friendliness and privacy).
    return f"{ENDPOINT}?lat={lat:.4f}&lon={lon:.4f}"


def http_fetch(url: str, user_agent: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})  # noqa: S310
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310
        return resp.read()  # type: ignore[no-any-return]


def run(
    conn: psycopg.Connection[Any],
    fetch: Fetch,
    user_agent: str,
    dry_run: bool = False,
    pause_s: float = 1.0,
) -> dict[str, int]:
    """Fetch and store a forecast for every station. A failure for one station is counted
    and reported, never hidden, and does not stop the others."""
    if "@" not in user_agent and "http" not in user_agent:
        raise ValueError("User-Agent must identify the app and include contact details")
    stations = conn.execute(
        "select id, org_id, lat, lon from public.stations_geo order by code"
    ).fetchall()
    stored = failed = 0
    for i, (station_id, org_id, lat, lon) in enumerate(stations):
        if i:
            time.sleep(pause_s)
        try:
            issued, rows = parse_precipitation(
                json.loads(fetch(url_for(float(lat), float(lon)), user_agent))
            )
        except Exception as exc:  # noqa: BLE001 - report per-station failure and continue
            failed += 1
            print(f"station {station_id}: forecast not stored ({type(exc).__name__}: {exc})")
            continue
        if not dry_run:
            for valid_at, mm in rows:
                conn.execute(
                    "insert into public.forecasts (org_id, station_id, issued_at, valid_at,"
                    " variable, value, model, provider_licence)"
                    " values (%s, %s, %s, %s, 'precipitation_mm_1h', %s, %s, %s)"
                    " on conflict do nothing",
                    (org_id, station_id, issued, valid_at, mm, MODEL, LICENCE),
                )
        stored += len(rows)
    return {"stations": len(stations), "values": stored, "failed_stations": failed}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0] if __doc__ else "")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    ua = os.environ.get("FORECAST_USER_AGENT", "")
    url = os.environ.get("DATABASE_URL", "")
    if not ua or not url:
        print("FORECAST_USER_AGENT and DATABASE_URL must be set; nothing was fetched.")
        return 2
    with psycopg.connect(url, prepare_threshold=None) as conn:
        summary = run(conn, http_fetch, ua, dry_run=args.dry_run)
    print(json.dumps(summary))
    return 1 if summary["stations"] and summary["failed_stations"] == summary["stations"] else 0


if __name__ == "__main__":
    sys.exit(main())
