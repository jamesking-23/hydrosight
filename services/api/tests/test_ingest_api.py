"""HTTP layer of ingestion: header handling and error mapping (database logic is in test_readings)."""

from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from hydrosight_api.ingest import BatchIngestor, Ingestor, db_device_ingestor, db_ingestor
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


class _Conn:
    def __init__(self, fail: bool = False) -> None:
        self.fail, self.calls = fail, []

    def transaction(self) -> Any:
        import contextlib

        return contextlib.nullcontext()

    def execute(self, sql: str, params: tuple[Any, ...]) -> Any:
        self.calls.append(params)
        if self.fail:
            raise psycopg.errors.DatabaseError("boom")
        return type("R", (), {"fetchone": lambda _s: ({"evaluated": 1, "created": 1},)})()


def test_alert_engine_runs_only_for_accepted_sensors() -> None:
    from hydrosight_api.ingest import post_process

    readings = [{"sensor_id": "s1"}, {"sensor_id": "s2"}, {"sensor_id": "s1"}, "junk"]
    result = {"results": [
        {"index": 0, "status": "accepted"}, {"index": 1, "status": "rejected"},
        {"index": 2, "status": "accepted"}, {"index": 3, "status": "rejected"},
    ]}  # fmt: skip
    conn = _Conn()
    out = post_process(conn, readings, result)
    assert conn.calls == [(["s1"],), (["s1"],)]  # quality control, then the engine
    assert out["alerts"]["created"] == 1 and out["quality"]["created"] == 1


def test_quality_and_engine_failures_are_reported_and_do_not_hide_stored_readings() -> None:
    from hydrosight_api.ingest import post_process

    out = post_process(
        _Conn(fail=True), [{"sensor_id": "s1"}], {"results": [{"index": 0, "status": "accepted"}]}
    )
    for step in ("quality", "alerts"):
        assert "failed" in out[step]["error"] and "stored" in out[step]["error"]
    nothing = post_process(
        _Conn(), [{"sensor_id": "s1"}], {"results": [{"index": 0, "status": "duplicate"}]}
    )
    assert nothing["alerts"] == {"evaluated": 0, "created": 0}
    assert nothing["quality"] == {"processed": 0}


DEVICE_BODY = {
    "sent_at": "2026-01-01T00:00:10Z",
    "battery_pct": 80,
    "signal_dbm": -70,
    "readings": [
        {"sensor_id": "x", "observed_at": "2026-01-01T00:00:00Z", "value": 1, "sequence": 7}
    ],
}


def _device_client(ingestor: BatchIngestor) -> TestClient:
    app.dependency_overrides[db_device_ingestor] = lambda: ingestor
    return TestClient(app)


def test_device_endpoint_requires_a_key_and_passes_the_batch_through() -> None:
    c = _device_client(
        lambda k, b: {"key": k, "n": len(b["readings"]), "battery": b["battery_pct"]}
    )
    assert c.post("/v1/ingest/readings", json=DEVICE_BODY).status_code == 401
    r = c.post("/v1/ingest/readings", json=DEVICE_BODY, headers={"X-API-Key": "hsk_d"})
    assert r.status_code == 200 and r.json() == {"key": "hsk_d", "n": 1, "battery": 80.0}


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"readings": []},
        {"readings": [1] * 1001},
        {**DEVICE_BODY, "surprise": 1},
        {**DEVICE_BODY, "battery_pct": "x"},
    ],
)
def test_device_endpoint_refuses_bad_shapes_including_unknown_fields(
    payload: dict[str, Any],
) -> None:
    r = _device_client(lambda *_: {}).post(
        "/v1/ingest/readings", json=payload, headers={"X-API-Key": "k"}
    )
    assert r.status_code == 422


def test_device_errors_carry_the_database_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    from hydrosight_api import ingest
    from hydrosight_api.config import Settings

    class Boom(psycopg.errors.InsufficientPrivilege):
        @property
        def diag(self) -> Any:  # type: ignore[override]
            return type("D", (), {"message_primary": "api key is not bound to a device"})()

    def boom(*_a: Any, **_k: Any) -> Any:
        raise Boom("x")

    monkeypatch.setattr(ingest.psycopg, "connect", boom)
    with pytest.raises(Exception) as info:  # noqa: PT011 - HTTPException
        db_device_ingestor(Settings(database_url="postgresql://u@h/d"))("k", {"readings": [{}]})
    assert info.value.status_code == 403  # type: ignore[attr-defined]
    assert "not bound to a device" in info.value.detail  # type: ignore[attr-defined]
