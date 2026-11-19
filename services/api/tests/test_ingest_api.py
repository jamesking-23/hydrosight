"""HTTP layer of ingestion: header handling and error mapping (database logic is in test_readings)."""

from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from hydrosight_api.ingest import Ingestor, db_ingestor
from hydrosight_api.main import app

BODY = {"readings": [{"sensor_id": "x", "observed_at": "2026-01-01T00:00:00Z", "value": 1}]}


def _client(ingestor: Ingestor) -> TestClient:
    app.dependency_overrides[db_ingestor] = lambda: ingestor
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset() -> Any:
    yield
    app.dependency_overrides.clear()


def test_missing_key_is_401_and_nothing_is_called() -> None:
    called: list[str] = []
    r = _client(lambda k, _: called.append(k) or {}).post("/v1/readings", json=BODY)
    assert r.status_code == 401 and not called


def test_success_passes_database_result_through() -> None:
    result = {"accepted": 1, "duplicate": 0, "rejected": 0, "results": []}
    r = _client(lambda k, items: result if k == "hsk_a" and len(items) == 1 else {}).post(
        "/v1/readings", json=BODY, headers={"X-API-Key": "hsk_a"}
    )
    assert r.status_code == 200 and r.json() == result


@pytest.mark.parametrize("payload", [{}, {"readings": []}, {"readings": [1] * 1001}])
def test_bad_shape_is_422(payload: dict[str, Any]) -> None:
    r = _client(lambda *_: {}).post("/v1/readings", json=payload, headers={"X-API-Key": "k"})
    assert r.status_code == 422


def test_unconfigured_database_is_explicit_503() -> None:
    app.dependency_overrides.clear()
    r = TestClient(app).post("/v1/readings", json=BODY, headers={"X-API-Key": "k"})
    assert r.status_code == 503 and "not configured" in r.json()["detail"]


def test_database_errors_map_to_http_codes(monkeypatch: pytest.MonkeyPatch) -> None:
    from hydrosight_api import ingest
    from hydrosight_api.config import Settings

    cases = [
        (psycopg.errors.InvalidAuthorizationSpecification("x"), 401),
        (psycopg.errors.InsufficientPrivilege("x"), 403),
        (psycopg.errors.InvalidParameterValue("x"), 422),
        (psycopg.OperationalError("x"), 503),
    ]
    for exc, code in cases:

        def boom(*_a: Any, _e: Exception = exc, **_k: Any) -> Any:
            raise _e

        monkeypatch.setattr(ingest.psycopg, "connect", boom)
        run = db_ingestor(Settings(database_url="postgresql://u@h/d"))
        with pytest.raises(Exception) as info:  # noqa: PT011 - HTTPException
            run("k", [{}])
        assert info.value.status_code == code  # type: ignore[attr-defined]
