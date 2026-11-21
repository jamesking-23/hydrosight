"""Community reporting endpoints (public, no account needed).

Privacy: no IP address, user agent or device identifier is stored or logged by this code. Photos
are re-encoded here so EXIF (GPS, camera, time) cannot survive; the only location kept is the
one the person chose to share in the report itself. The database applies the safety rules
(always `community`, always `unvalidated`, consent recorded, rate caps, duplicate grouping)."""

import base64
import binascii
import io
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from psycopg.rows import dict_row
from pydantic import UUID4, BaseModel, ConfigDict, Field

from hydrosight_api.config import Settings, get_settings

router = APIRouter(prefix="/v1/community", tags=["community"])

MAX_PHOTO_UPLOAD_BYTES = 1_500_000  # what a phone sends after client-side compression
MAX_PIXELS = 25_000_000  # refuse decompression bombs
MAX_EDGE_PX = 1600
JPEG_QUALITY = 80

Kind = Literal[
    "flooding",
    "water_level",
    "blocked_drainage",
    "damaged_infrastructure",
    "dangerous_road",
    "other",
]


class PhotoError(ValueError):
    """The upload is not a usable photo."""


def sanitize_photo(raw: bytes) -> tuple[bytes, str]:
    """Re-encode as a plain JPEG: orientation applied, every metadata block dropped, size capped."""
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in {"JPEG", "PNG", "WEBP"}:
                raise PhotoError("photo must be a JPEG, PNG or WebP image")
            if img.width * img.height > MAX_PIXELS:
                raise PhotoError("photo has too many pixels")
            oriented = ImageOps.exif_transpose(img)  # bake in rotation before the tags are dropped
            oriented.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX))
            rgb = oriented.convert("RGB")
            clean = Image.new(
                "RGB", rgb.size
            )  # fresh image: nothing is carried over from the source
            clean.paste(rgb)
            out = io.BytesIO()
            clean.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise PhotoError("photo could not be read") from exc
    return out.getvalue(), "image/jpeg"


class CommunityReport(BaseModel):
    """Unknown fields are refused, never silently dropped. There is no field for status or source:
    a submitter cannot choose them."""

    model_config = ConfigDict(extra="forbid")

    org: str = Field(min_length=1, max_length=80, description="Organisation slug")
    client_id: UUID4 = Field(description="Made on the device; a retry never creates a duplicate")
    kind: Kind
    description: str | None = Field(default=None, max_length=1000)
    water_depth_cm: float | None = Field(default=None, ge=0, le=1000)
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    accuracy_m: float | None = Field(default=None, ge=0, le=100000)
    observed_at: datetime
    consent_version: str = Field(min_length=1, max_length=60)
    photo_base64: str | None = Field(default=None, max_length=2_200_000)


Submitter = Callable[[CommunityReport, bytes | None], dict[str, Any]]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _connect(settings: Settings) -> psycopg.Connection[Any]:
    if not settings.database_url:
        raise HTTPException(503, detail="database is not configured")
    try:
        return psycopg.connect(
            settings.database_url, row_factory=dict_row, connect_timeout=5, prepare_threshold=None
        )
    except psycopg.OperationalError as exc:
        raise HTTPException(503, detail="database unreachable") from exc


def db_submitter(settings: SettingsDep) -> Submitter:
    def run(report: CommunityReport, photo: bytes | None) -> dict[str, Any]:
        try:
            with _connect(settings) as conn:
                org = conn.execute(
                    "select id from public.organizations where slug = %s", (report.org,)
                ).fetchone()
                if org is None:
                    raise HTTPException(404, detail="unknown area")
                row = conn.execute(
                    "select public.submit_public_community_report("
                    "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) as result",
                    (
                        org["id"],
                        report.client_id,
                        report.kind,
                        report.description,
                        report.water_depth_cm,
                        report.lon,
                        report.lat,
                        report.accuracy_m,
                        report.observed_at,
                        report.consent_version,
                        photo,
                        "image/jpeg" if photo else None,
                    ),
                ).fetchone()
        except psycopg.errors.InsufficientPrivilege as exc:
            raise HTTPException(
                403, detail=exc.diag.message_primary or "reports are not accepted here"
            ) from exc
        except psycopg.errors.InvalidParameterValue as exc:
            raise HTTPException(422, detail=exc.diag.message_primary or "invalid report") from exc
        except psycopg.errors.ProgramLimitExceeded as exc:
            raise HTTPException(
                429, detail=exc.diag.message_primary or "too many reports; try again later"
            ) from exc
        except psycopg.OperationalError as exc:
            raise HTTPException(503, detail="database unreachable; nothing was stored") from exc
        if row is None or not isinstance(row["result"], dict):
            raise HTTPException(500, detail="unexpected database response")
        return dict(row["result"])

    return run


@router.post("/reports", status_code=201)
def submit_report(
    report: CommunityReport, submit: Annotated[Submitter, Depends(db_submitter)]
) -> dict[str, Any]:
    photo: bytes | None = None
    if report.photo_base64:
        try:
            raw = base64.b64decode(report.photo_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(422, detail="photo is not valid base64") from exc
        if len(raw) > MAX_PHOTO_UPLOAD_BYTES:
            raise HTTPException(413, detail="photo is too large; compress it before sending")
        try:
            photo, _ = sanitize_photo(raw)
        except PhotoError as exc:
            raise HTTPException(422, detail=str(exc)) from exc
    result = submit(report, photo)
    # Say plainly what the person's report is, so the app can show it honestly.
    return {
        **result,
        "label": "community report, not yet verified",
        "source_type": "community",
        "validation": "unvalidated",
    }


@router.get("/areas")
def list_areas(settings: SettingsDep) -> dict[str, Any]:
    """Organisations currently accepting community reports (name and slug only)."""
    with _connect(settings) as conn:
        rows = conn.execute(
            "select slug, name, is_demo from public.organizations"
            " where community_reports_open order by name"
        ).fetchall()
    return {
        "areas": [
            {"slug": r["slug"], "name": r["name"], "exercise": bool(r["is_demo"])} for r in rows
        ]
    }


@router.get("/areas/{slug}/resources")
def list_resources(slug: str, settings: SettingsDep) -> dict[str, Any]:
    """Published safe locations and emergency information. Empty until the organisation adds
    and a second person publishes them; nothing is made up."""
    with _connect(settings) as conn:
        rows = conn.execute(
            "select r.id, r.kind, r.title, r.body, r.phone, r.published_at,"
            " extensions.st_x(r.location) as lon, extensions.st_y(r.location) as lat"
            " from public.community_resources r join public.organizations o on o.id = r.org_id"
            " where o.slug = %s and o.community_reports_open and r.published"
            " order by r.kind, r.title",
            (slug,),
        ).fetchall()
    return {
        "resources": [
            {
                "id": str(r["id"]),
                "kind": r["kind"],
                "title": r["title"],
                "body": r["body"],
                "phone": r["phone"],
                "lon": r["lon"],
                "lat": r["lat"],
                "published_at": r["published_at"].isoformat(),
            }
            for r in rows
        ]
    }
