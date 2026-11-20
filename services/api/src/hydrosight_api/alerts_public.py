"""Public, read-only feed of PUBLISHED public warnings in CAP 1.2. Nothing else is exposed:
drafts, internal advisories and other tenants' data never appear here."""

from typing import Annotated, Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg.rows import dict_row

from hydrosight_api.cap import alert_to_cap
from hydrosight_api.config import Settings, get_settings

router = APIRouter(prefix="/v1/cap", tags=["cap"])
SettingsDep = Annotated[Settings, Depends(get_settings)]

COLUMNS = """a.id, a.level::text, a.status::text, a.audience::text, a.title, a.hazard, a.location_text,
  a.expected_timing, a.duration_text, a.recommended_action, a.issuing_authority, a.confidence,
  a.published_at, a.expires_at, a.cancelled_at, a.cancel_reason, a.version, a.supersedes_id,
  o.slug as org_slug, o.name as org_name, o.is_demo"""


def _connect(settings: Settings) -> psycopg.Connection[dict[str, Any]]:
    if not settings.database_url:
        raise HTTPException(503, detail="database is not configured")
    try:
        return psycopg.connect(
            settings.database_url, row_factory=dict_row, connect_timeout=5, prepare_threshold=None
        )
    except psycopg.OperationalError as exc:
        raise HTTPException(503, detail="database unreachable") from exc


@router.get("/alerts")
def list_alerts(settings: SettingsDep) -> dict[str, Any]:
    with _connect(settings) as conn:
        rows = conn.execute(
            f"select {COLUMNS} from public.alerts a join public.organizations o on o.id = a.org_id"  # noqa: S608
            " where a.status = 'published' and a.audience = 'public'"
            " and (a.expires_at is null or a.expires_at > now()) order by a.published_at desc limit 200"
        ).fetchall()
    return {
        "alerts": [
            {
                "id": str(r["id"]),
                "level": r["level"],
                "title": r["title"],
                "location": r["location_text"],
                "published_at": r["published_at"].isoformat(),
                "expires_at": r["expires_at"].isoformat() if r["expires_at"] else None,
                "cap_url": f"/v1/cap/alerts/{r['id']}.xml",
                "exercise": r["is_demo"],
            }
            for r in rows
        ]
    }


@router.get("/alerts/{alert_id}.xml")
def get_cap(alert_id: str, settings: SettingsDep) -> Response:
    with _connect(settings) as conn:
        try:
            row = conn.execute(
                f"select {COLUMNS} from public.alerts a join public.organizations o on o.id = a.org_id"  # noqa: S608
                " where a.id = %s::uuid and a.audience = 'public' and a.published_at is not null"
                " and a.status in ('published', 'cancelled')",
                (alert_id,),
            ).fetchone()
        except psycopg.errors.InvalidTextRepresentation as exc:
            raise HTTPException(404, detail="alert not found") from exc
        if row is None:
            raise HTTPException(404, detail="alert not found")
        previous = None
        if row["supersedes_id"]:
            previous = conn.execute(
                "select id, published_at from public.alerts where id = %s", (row["supersedes_id"],)
            ).fetchone()
    xml = alert_to_cap(
        row,
        sender=f"{row['org_slug']}@{settings.cap_sender_domain}",
        sender_name=row["org_name"],
        previous=previous,
        exercise=bool(row["is_demo"]),
    )
    return Response(content=xml, media_type="application/cap+xml")
