"""Readings ingestion endpoint. Authentication, tenancy and validation live in the database
(`public.ingest_readings`); this layer only transports the request and maps failures to
explicit HTTP errors. The API key is never logged."""

from collections.abc import Callable
from typing import Annotated, Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from hydrosight_api.config import Settings, get_settings

router = APIRouter(prefix="/v1", tags=["ingestion"])

Ingestor = Callable[[str, list[Any]], dict[str, Any]]


class ReadingsBatch(BaseModel):
    """Items are validated one by one in the database so one bad item never blocks the batch."""

    readings: list[Any] = Field(min_length=1, max_length=1000)


def evaluate_alerts(conn: Any, readings: list[Any], result: dict[str, Any]) -> dict[str, Any]:
    """Run the threshold engine for the sensors that just received accepted readings.
    Failure never undoes stored readings (savepoint) and is reported in the response, not hidden."""
    sensors = sorted(
        {
            str(readings[r["index"]].get("sensor_id"))
            for r in result.get("results", [])
            if r.get("status") == "accepted" and isinstance(readings[r["index"]], dict)
        }
    )
    if not sensors:
        result["alerts"] = {"evaluated": 0, "created": 0}
        return result
    try:
        with conn.transaction():
            row = conn.execute(
                "select public.evaluate_thresholds_for(%s::uuid[])", (sensors,)
            ).fetchone()
        result["alerts"] = dict(row[0]) if row and isinstance(row[0], dict) else {}
    except psycopg.Error:
        result["alerts"] = {"error": "threshold evaluation failed; readings were stored"}
    return result


def db_ingestor(settings: Annotated[Settings, Depends(get_settings)]) -> Ingestor:
    def run(api_key: str, readings: list[Any]) -> dict[str, Any]:
        if not settings.database_url:
            raise HTTPException(503, detail="database is not configured")
        try:
            with psycopg.connect(
                settings.database_url, connect_timeout=5, prepare_threshold=None
            ) as conn:
                row = conn.execute(
                    "select public.ingest_readings(%s, %s)", (api_key, Jsonb(readings))
                ).fetchone()
                if row is not None and isinstance(row[0], dict):
                    row = (evaluate_alerts(conn, readings, dict(row[0])),)
        except psycopg.errors.InvalidAuthorizationSpecification as exc:
            raise HTTPException(401, detail="invalid, expired or revoked API key") from exc
        except psycopg.errors.InsufficientPrivilege as exc:
            raise HTTPException(403, detail="API key lacks the readings.write scope") from exc
        except psycopg.errors.InvalidParameterValue as exc:
            raise HTTPException(422, detail="readings must hold 1 to 1000 items") from exc
        except psycopg.OperationalError as exc:
            raise HTTPException(503, detail="database unreachable; nothing was stored") from exc
        if row is None or not isinstance(row[0], dict):
            raise HTTPException(500, detail="unexpected database response")
        return dict(row[0])

    return run


@router.post("/readings")
def post_readings(
    batch: ReadingsBatch,
    ingest: Annotated[Ingestor, Depends(db_ingestor)],
    x_api_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Submit readings. Per-item results say accepted / duplicate / rejected(reason)."""
    if not x_api_key:
        raise HTTPException(401, detail="X-API-Key header is required")
    return ingest(x_api_key, batch.readings)
