"""Readings ingestion endpoint. Authentication, tenancy and validation live in the database
(`public.ingest_readings`); this layer only transports the request and maps failures to
explicit HTTP errors. The API key is never logged."""

import hashlib
from collections.abc import Callable
from typing import Annotated, Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

from hydrosight_api.config import Settings, get_settings

router = APIRouter(prefix="/v1", tags=["ingestion"])

Ingestor = Callable[[str, list[Any]], dict[str, Any]]
BatchIngestor = Callable[[str, dict[str, Any]], dict[str, Any]]


class ReadingsBatch(BaseModel):
    """Items are validated one by one in the database so one bad item never blocks the batch."""

    readings: list[Any] = Field(min_length=1, max_length=1000)


class DeviceBatch(BaseModel):
    """One upload from one device. Unknown fields are refused, never silently dropped."""

    model_config = ConfigDict(extra="forbid")

    sent_at: str | None = None  # device clock at send time; used to correct clock skew
    battery_pct: float | None = None
    signal_dbm: float | None = None
    firmware: str | None = Field(default=None, max_length=60)
    readings: list[Any] = Field(min_length=1, max_length=1000)


def accepted_sensors(readings: list[Any], result: dict[str, Any]) -> list[str]:
    return sorted(
        {
            str(readings[r["index"]].get("sensor_id"))
            for r in result.get("results", [])
            if r.get("status") == "accepted" and isinstance(readings[r["index"]], dict)
        }
    )


def post_process(conn: Any, readings: list[Any], result: dict[str, Any]) -> dict[str, Any]:
    """After readings are stored: quality control, then the threshold engine, for the sensors that
    just received accepted readings. Each step runs in a savepoint: a failure never undoes stored
    readings and is reported in the response, not hidden."""
    sensors = accepted_sensors(readings, result)
    if not sensors:
        result["quality"] = {"processed": 0}
        result["alerts"] = {"evaluated": 0, "created": 0}
        return result
    for name, sql in (
        ("quality", "select public.run_qc(%s::uuid[])"),
        ("alerts", "select public.evaluate_thresholds_for(%s::uuid[])"),
    ):
        try:
            with conn.transaction():
                row = conn.execute(sql, (sensors,)).fetchone()
            result[name] = dict(row[0]) if row and isinstance(row[0], dict) else {}
        except psycopg.Error:
            result[name] = {"error": f"{name} step failed; readings were stored"}
    return result


def rate_allowed(conn: Any, settings: Settings, api_key: str) -> bool:
    """Counts this request against the per-key and the overall bucket (own transaction, committed
    before anything else so a refused request still counts). The key is hashed, never stored.
    Fails open if the counter cannot be read: ingestion itself then reports the database problem."""
    digest = hashlib.sha256(api_key.encode()).hexdigest()[:32]
    try:
        with conn.transaction():
            per_key = conn.execute(
                "select public.rate_hit(%s, %s, 60)",
                (f"ingest:key:{digest}", settings.rate_limit_per_key_per_min),
            ).fetchone()
            overall = conn.execute(
                "select public.rate_hit('ingest:all', %s, 60)",
                (settings.rate_limit_global_per_min,),
            ).fetchone()
    except psycopg.Error:
        return True
    return bool(per_key and per_key[0]) and bool(overall and overall[0])


def _execute(
    settings: Settings,
    work: Callable[[Any], dict[str, Any]],
    key_scope_msg: str,
    api_key: str | None = None,
) -> dict[str, Any]:
    if not settings.database_url:
        raise HTTPException(503, detail="database is not configured")
    try:
        with psycopg.connect(
            settings.database_url, connect_timeout=5, prepare_threshold=None
        ) as conn:
            if api_key is not None and not rate_allowed(conn, settings, api_key):
                raise HTTPException(
                    429,
                    detail="rate limit reached; retry in a minute",
                    headers={"Retry-After": "60"},
                )
            result = work(conn)
    except psycopg.errors.InvalidAuthorizationSpecification as exc:
        raise HTTPException(401, detail="invalid, expired or revoked API key") from exc
    except psycopg.errors.InsufficientPrivilege as exc:
        raise HTTPException(403, detail=exc.diag.message_primary or key_scope_msg) from exc
    except psycopg.errors.InvalidParameterValue as exc:
        raise HTTPException(
            422, detail=exc.diag.message_primary or "readings must hold 1 to 1000 items"
        ) from exc
    except psycopg.OperationalError as exc:
        raise HTTPException(503, detail="database unreachable; nothing was stored") from exc
    if not isinstance(result, dict):
        raise HTTPException(500, detail="unexpected database response")
    return result


def db_ingestor(settings: Annotated[Settings, Depends(get_settings)]) -> Ingestor:
    def run(api_key: str, readings: list[Any]) -> dict[str, Any]:
        def work(conn: Any) -> dict[str, Any]:
            row = conn.execute(
                "select public.ingest_readings(%s, %s)", (api_key, Jsonb(readings))
            ).fetchone()
            if row is None or not isinstance(row[0], dict):
                raise HTTPException(500, detail="unexpected database response")
            return post_process(conn, readings, dict(row[0]))

        return _execute(settings, work, "API key lacks the readings.write scope", api_key)

    return run


def db_device_ingestor(settings: Annotated[Settings, Depends(get_settings)]) -> BatchIngestor:
    def run(api_key: str, batch: dict[str, Any]) -> dict[str, Any]:
        def work(conn: Any) -> dict[str, Any]:
            row = conn.execute(
                "select public.ingest_device_batch(%s, %s)", (api_key, Jsonb(batch))
            ).fetchone()
            if row is None or not isinstance(row[0], dict):
                raise HTTPException(500, detail="unexpected database response")
            return post_process(conn, batch["readings"], dict(row[0]))

        return _execute(settings, work, "API key cannot write readings from this device", api_key)

    return run


@router.post("/readings")
def post_readings(
    batch: ReadingsBatch,
    ingest: Annotated[Ingestor, Depends(db_ingestor)],
    x_api_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Submit readings (organisation key). Per-item: accepted / duplicate / rejected(reason)."""
    if not x_api_key:
        raise HTTPException(401, detail="X-API-Key header is required")
    return ingest(x_api_key, batch.readings)


@router.post("/ingest/readings")
def post_device_readings(
    batch: DeviceBatch,
    ingest: Annotated[BatchIngestor, Depends(db_device_ingestor)],
    x_api_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Device ingestion (device-bound key): corrects device clock skew, accepts buffered (delayed)
    uploads, and records sequence, battery and signal. Idempotent per sensor and timestamp."""
    if not x_api_key:
        raise HTTPException(401, detail="X-API-Key header is required")
    return ingest(x_api_key, batch.model_dump(exclude_none=True))
