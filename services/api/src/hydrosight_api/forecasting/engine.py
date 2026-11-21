"""Database side of the prediction engine: load readings, run registered baseline models,
store predictions and backtest results. Runs with the service role (append-only on both tables).

Rules kept here:
  * Only model versions a person has registered are run. This code cannot register or promote.
  * The event threshold comes from an ACTIVE, approved threshold rule that has a documented
    basis. Without one, no occurrence forecast is issued ("no basis" is reported, not hidden).
  * Stale input is never forecast from: if the newest observation is too old, nothing is issued.
  * Readings are the calibrated view, good or unchecked quality only, measured or synthetic
    only (interpolated `estimated` values never drive a forecast).

    DATABASE_URL=... python -m hydrosight_api.forecasting.engine predict
"""

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from hydrosight_api.forecasting.baselines import (
    EmpiricalExceedance,
    Persistence,
    RainfallAccumulation,
    RateOfRise,
)
from hydrosight_api.forecasting.harness import BacktestConfig, backtest
from hydrosight_api.forecasting.series import DataOrigin, Model, Series

MAX_INPUT_AGE_STEPS = 3  # newest observation must be within 3 hourly steps of "now"
MIN_HISTORY_STEPS = 24 * 14


@dataclass(frozen=True)
class Threshold:
    rule_id: str
    value: float
    unit: str
    rationale: str


def build_model(name: str, version: str) -> Model | None:
    """Rebuild a registered baseline from its name and version string."""
    if name == "persistence" and version == "1":
        return Persistence()
    if name == "empirical_exceedance" and version == "1":
        return EmpiricalExceedance()
    if name == "rate_of_rise" and (m := re.fullmatch(r"1-lb(\d+)", version)):
        return RateOfRise(int(m.group(1)))
    if name == "rainfall_accumulation" and (
        m := re.fullmatch(r"1-d(0\.\d+)-w(\d+)-b(\d+)", version)
    ):
        return RainfallAccumulation(float(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _origin(source_type: str) -> DataOrigin:
    if source_type == "synthetic":
        return "synthetic"
    if source_type == "measured":
        return "real_unconfirmed"  # real, but nobody has confirmed it for model use yet
    raise ValueError(f"sensor source_type '{source_type}' cannot feed a forecast")


def load_series(
    conn: psycopg.Connection[Any], org_id: Any, station_id: Any, kind: str, since: datetime
) -> tuple[Series, str, str] | None:
    """Hourly mean of calibrated readings for the station's sensor of this kind.
    Returns (series, sensor_id, sensor_source_type) or None when there is no sensor/data."""
    sensor = conn.execute(
        "select id, unit, source_type::text from public.sensors"
        " where org_id = %s and station_id = %s and kind = %s order by created_at limit 1",
        (org_id, station_id, kind),
    ).fetchone()
    if sensor is None:
        return None
    rows = conn.execute(
        "select date_bin('1 hour', observed_at, timestamptz '2000-01-01') as t, avg(value)"
        " from public.readings_calibrated"
        " where sensor_id = %s and observed_at >= %s and quality in ('good', 'unchecked')"
        " and source_type in ('measured', 'synthetic') group by 1 order by 1",
        (sensor[0], since),
    ).fetchall()
    if not rows:
        return None
    start, end = rows[0][0], rows[-1][0]
    n = int((end - start).total_seconds() // 3600) + 1
    values: list[float | None] = [None] * n
    for t, v in rows:
        values[int((t - start).total_seconds() // 3600)] = float(v)
    return (
        Series(start, 1, tuple(values), _origin(sensor[2]), str(sensor[1])),
        str(sensor[0]),
        str(sensor[2]),
    )


def active_threshold(
    conn: psycopg.Connection[Any], org_id: Any, station_id: Any
) -> Threshold | None:
    """The approved, documented water-level rule for this station (most specific scope first)."""
    row = conn.execute(
        "select r.id, r.threshold_value, s.unit, r.rationale"
        " from public.threshold_rules r"
        " join public.stations st on st.id = %s and st.org_id = r.org_id"
        " join public.sensors s on s.station_id = st.id and s.kind = 'water_level'"
        " where r.org_id = %s and r.status = 'active' and r.comparator = '>='"
        " and coalesce(r.sensor_kind, 'water_level') = 'water_level'"
        " and (r.scope = 'organisation' or (r.scope = 'sensor' and r.scope_id = s.id)"
        "      or (r.scope = 'location' and r.scope_id = st.location_id))"
        " order by case r.scope when 'sensor' then 0 when 'location' then 1 else 2 end,"
        "          r.threshold_value limit 1",
        (station_id, org_id),
    ).fetchone()
    if row is None:
        return None
    return Threshold(str(row[0]), float(row[1]), str(row[2]), str(row[3] or ""))


def registered_models(conn: psycopg.Connection[Any], org_id: Any) -> list[tuple[str, str, str]]:
    rows = conn.execute(
        "select id::text, name, version from public.model_versions"
        " where org_id = %s and kind = 'baseline' and target = 'flood_occurrence'"
        " order by name, version",
        (org_id,),
    ).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def predict_station(
    conn: psycopg.Connection[Any],
    org_id: Any,
    station_id: Any,
    *,
    horizon_hours: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    since = now - timedelta(days=120)
    report: dict[str, Any] = {"station_id": str(station_id), "issued": 0, "skipped": []}
    thr = active_threshold(conn, org_id, station_id)
    if thr is None or len(thr.rationale.strip()) < 20:
        report["skipped"].append("no active threshold rule with a documented basis")
        return report
    stage_loaded = load_series(conn, org_id, station_id, "water_level", since)
    if stage_loaded is None:
        report["skipped"].append("no usable water-level readings")
        return report
    stage, stage_sensor, _ = stage_loaded
    last_t = stage.time(len(stage) - 1)
    if now - last_t > timedelta(hours=MAX_INPUT_AGE_STEPS):
        report["skipped"].append(f"stale input: newest observation {last_t.isoformat()}")
        return report
    if len(stage) < MIN_HISTORY_STEPS:
        report["skipped"].append(f"not enough history ({len(stage)} h, need {MIN_HISTORY_STEPS})")
        return report
    rain_loaded = load_series(conn, org_id, station_id, "rainfall", since)
    rain: Series | None = None
    rain_sensor: str | None = None
    if rain_loaded is not None:
        r, rain_sensor, _ = rain_loaded
        # Align rain to the stage grid; missing hours stay None.
        off = int((r.start - stage.start).total_seconds() // 3600)
        vals: list[float | None] = [None] * len(stage)
        for j, v in enumerate(r.values):
            if 0 <= off + j < len(stage):
                vals[off + j] = v
        rain = Series(stage.start, 1, tuple(vals), r.origin, r.unit)
    origin: DataOrigin = (
        stage.origin if rain is None or rain.origin == stage.origin else "synthetic"
    )
    h = horizon_hours
    for model_id, name, version in registered_models(conn, org_id):
        model = build_model(name, version)
        if model is None:
            report["skipped"].append(f"{name} {version}: no implementation for this version")
            continue
        try:
            model.fit(stage, rain, train_end=len(stage), horizon_steps=h, threshold=thr.value)
            pred = model.predict(stage, rain, horizon_steps=h, threshold=thr.value)
        except ValueError as exc:
            report["skipped"].append(f"{name} {version}: {exc}")
            continue
        if pred is None:
            report["skipped"].append(f"{name} {version}: cannot forecast from the latest data")
            continue
        snapshot = {
            "stage_sensor_id": stage_sensor,
            "rain_sensor_id": rain_sensor,
            "series_from": stage.start.isoformat(),
            "series_to": last_t.isoformat(),
            "n_hours": len(stage),
            "data_origin": origin,
            "threshold": {
                "rule_id": thr.rule_id,
                "value": thr.value,
                "unit": thr.unit,
                "rationale": thr.rationale,
            },
            "model_inputs": pred.inputs,
        }
        conn.execute(
            "insert into public.predictions (org_id, station_id, model_version_id, target,"
            " issued_at, valid_from, valid_to, horizon_hours, probability, p10, p50, p90, unit,"
            " source_type, input_snapshot)"
            " values (%s,%s,%s,'flood_occurrence',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                org_id, station_id, model_id, last_t, last_t, last_t + timedelta(hours=h), h,
                pred.probability, pred.p10, pred.p50, pred.p90, stage.unit,
                "synthetic" if origin == "synthetic" else "forecast", Jsonb(snapshot),
            ),
        )  # fmt: skip
        report["issued"] += 1
    return report


def backtest_station(
    conn: psycopg.Connection[Any],
    org_id: Any,
    station_id: Any,
    model_version_id: str,
    *,
    horizon_hours: int,
    warn_probability: float,
    holdout_fraction: float,
    run_by: str,
) -> dict[str, Any]:
    """Backtest one registered model on this station's stored history and save the result."""
    row = conn.execute(
        "select name, version from public.model_versions where id = %s and org_id = %s",
        (model_version_id, org_id),
    ).fetchone()
    thr = active_threshold(conn, org_id, station_id)
    if row is None or thr is None or len(thr.rationale.strip()) < 20:
        return {"saved": False, "reason": "unknown model, or no active documented threshold"}
    model = build_model(row[0], row[1])
    loaded = load_series(conn, org_id, station_id, "water_level", datetime(2000, 1, 1, tzinfo=UTC))
    if model is None or loaded is None:
        return {"saved": False, "reason": "no implementation or no readings"}
    stage, _, _ = loaded
    rl = load_series(conn, org_id, station_id, "rainfall", stage.start)
    rain: Series | None = None
    if rl is not None:
        off = int((rl[0].start - stage.start).total_seconds() // 3600)
        vals: list[float | None] = [None] * len(stage)
        for j, v in enumerate(rl[0].values):
            if 0 <= off + j < len(stage):
                vals[off + j] = v
        rain = Series(stage.start, 1, tuple(vals), rl[0].origin, rl[0].unit)
    n = len(stage)
    split = int(n * (1 - holdout_fraction))
    cfg = BacktestConfig(
        horizon_steps=horizon_hours, threshold=thr.value, threshold_unit=thr.unit,
        threshold_basis=thr.rationale, warn_probability=warn_probability,
        train_end=split, holdout_start=split, holdout_end=n,
    )  # fmt: skip
    try:
        res = backtest(model, stage, rain, cfg)
    except ValueError as exc:
        return {"saved": False, "reason": str(exc)}
    r = res.to_row()
    conn.execute(
        "insert into public.backtest_runs (org_id, model_version_id, station_id, evaluation_origin,"
        " train_end, holdout_start, holdout_end, horizon_hours, event_threshold,"
        " event_threshold_unit, event_basis, n_forecasts, hits, misses, false_alarms,"
        " correct_negatives, pod, far, csi, brier, median_lead_time_s, reliability,"
        " extreme_events, is_synthetic, notes, run_by)"
        " values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            org_id, model_version_id, station_id, r["evaluation_origin"], stage.time(split),
            stage.time(split), stage.time(n - 1), r["horizon_hours"], r["event_threshold"],
            r["event_threshold_unit"], r["event_basis"], r["n_forecasts"], r["hits"], r["misses"],
            r["false_alarms"], r["correct_negatives"], r["pod"], r["far"], r["csi"], r["brier"],
            r["median_lead_time_s"], Jsonb(r["reliability"]), Jsonb(r["extreme_events"]),
            r["is_synthetic"], r["notes"], run_by,
        ),
    )  # fmt: skip
    return {"saved": True, "n_forecasts": r["n_forecasts"], "is_synthetic": r["is_synthetic"]}


def main(argv: list[str]) -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL is not set; nothing was done.")
        return 2
    if len(argv) < 2 or argv[1] != "predict":
        print("usage: python -m hydrosight_api.forecasting.engine predict [horizon_hours]")
        return 2
    horizon = int(argv[2]) if len(argv) > 2 else 6
    out: list[dict[str, Any]] = []
    with psycopg.connect(url, prepare_threshold=None) as conn:
        for org_id, station_id in conn.execute(
            "select org_id, id from public.stations order by org_id, code"
        ).fetchall():
            out.append(predict_station(conn, org_id, station_id, horizon_hours=horizon))
    print(json.dumps(out, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
