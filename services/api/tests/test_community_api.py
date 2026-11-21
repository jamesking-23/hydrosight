"""Community API: photo sanitising (EXIF must not survive) and HTTP behaviour. No database needed."""

import base64
import io
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from hydrosight_api.community import (
    CommunityReport,
    PhotoError,
    Submitter,
    db_submitter,
    sanitize_photo,
)
from hydrosight_api.main import app


def _jpeg_with_gps(size: tuple[int, int] = (400, 200), orientation: int = 1) -> bytes:
    img = Image.new("RGB", size, (30, 90, 160))
    exif = Image.Exif()
    exif[0x0112] = orientation  # orientation
    exif[0x010F] = "SecretPhoneMaker"  # camera make
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (0.0, 18.0, 0.0)
    gps[3] = "E"
    gps[4] = (32.0, 35.0, 0.0)
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def test_exif_and_gps_do_not_survive() -> None:
    raw = _jpeg_with_gps()
    assert b"Exif" in raw and b"SecretPhoneMaker" in raw  # the fixture really carries metadata
    clean, ctype = sanitize_photo(raw)
    assert ctype == "image/jpeg"
    assert b"Exif" not in clean and b"SecretPhoneMaker" not in clean and b"GPS" not in clean
    with Image.open(io.BytesIO(clean)) as img:
        assert not img.getexif() and "exif" not in img.info and "icc_profile" not in img.info


def test_orientation_is_applied_before_tags_are_dropped() -> None:
    clean, _ = sanitize_photo(_jpeg_with_gps((400, 200), orientation=6))  # rotated 90 degrees
    with Image.open(io.BytesIO(clean)) as img:
        assert img.size == (200, 400)


def test_large_photos_are_shrunk_and_png_is_converted() -> None:
    big = io.BytesIO()
    Image.new("RGBA", (3200, 2400), (1, 2, 3, 128)).save(big, format="PNG")
    clean, ctype = sanitize_photo(big.getvalue())
    assert ctype == "image/jpeg"
    with Image.open(io.BytesIO(clean)) as img:
        assert max(img.size) == 1600 and img.format == "JPEG"


@pytest.mark.parametrize("raw", [b"", b"not an image", b"%PDF-1.7 hello", b"GIF89a" + b"0" * 40])
def test_non_images_are_refused(raw: bytes) -> None:
    with pytest.raises(PhotoError):
        sanitize_photo(raw)


def test_decompression_bomb_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("hydrosight_api.community.MAX_PIXELS", 10_000)
    out = io.BytesIO()
    Image.new("RGB", (400, 400)).save(out, format="PNG")
    with pytest.raises(PhotoError):
        sanitize_photo(out.getvalue())


BODY: dict[str, Any] = {
    "org": "demo",
    "client_id": str(uuid.uuid4()),
    "kind": "flooding",
    "lon": 32.58,
    "lat": 0.31,
    "observed_at": datetime.now(UTC).isoformat(),
    "consent_version": "community-report-2026-11",
}


@pytest.fixture(autouse=True)
def _reset() -> Any:
    yield
    app.dependency_overrides.clear()


def _client(submit: Submitter) -> TestClient:
    app.dependency_overrides[db_submitter] = lambda: submit
    return TestClient(app)


def test_report_is_labelled_unverified_community() -> None:
    seen: list[tuple[CommunityReport, bytes | None]] = []

    def submit(report: CommunityReport, photo: bytes | None) -> dict[str, Any]:
        seen.append((report, photo))
        return {"id": "r1", "status": "received"}

    r = _client(submit).post("/v1/community/reports", json=BODY)
    assert r.status_code == 201
    assert r.json()["source_type"] == "community" and r.json()["validation"] == "unvalidated"
    assert seen[0][1] is None


def test_photo_reaches_the_database_without_exif() -> None:
    seen: list[bytes | None] = []

    def submit(_: CommunityReport, photo: bytes | None) -> dict[str, Any]:
        seen.append(photo)
        return {"id": "r1", "status": "received"}

    body = {**BODY, "photo_base64": base64.b64encode(_jpeg_with_gps()).decode()}
    assert _client(submit).post("/v1/community/reports", json=body).status_code == 201
    assert seen[0] is not None and b"Exif" not in seen[0] and b"GPS" not in seen[0]


@pytest.mark.parametrize(
    ("patch", "code"),
    [
        ({"status": "validated"}, 422),  # cannot choose a status
        ({"source_type": "measured"}, 422),  # cannot choose a source
        ({"kind": "meteor"}, 422),
        ({"lat": 91}, 422),
        ({"client_id": "not-a-uuid"}, 422),
        ({"water_depth_cm": -1}, 422),
        ({"photo_base64": "!!!notbase64"}, 422),
        ({"photo_base64": base64.b64encode(b"hello").decode()}, 422),
        ({"photo_base64": base64.b64encode(b"0" * 1_600_000).decode()}, 413),
    ],
)
def test_bad_input_is_refused_and_nothing_is_stored(patch: dict[str, Any], code: int) -> None:
    called: list[int] = []

    def submit(*_: Any) -> dict[str, Any]:
        called.append(1)
        return {}

    client = _client(submit)
    assert client.post("/v1/community/reports", json={**BODY, **patch}).status_code == code
    assert not called


def test_unconfigured_database_is_explicit_503() -> None:
    app.dependency_overrides.clear()
    r = TestClient(app).post("/v1/community/reports", json=BODY)
    assert r.status_code == 503 and "not configured" in r.json()["detail"]
