import pytest
from fastapi.testclient import TestClient

from hydrosight_api import main
from hydrosight_api.config import Settings
from hydrosight_api.main import app

client = TestClient(app)


def test_health_is_ok() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_ready_reports_unset_database_explicitly() -> None:
    app.dependency_overrides[main.get_settings] = lambda: Settings(database_url="")
    try:
        res = client.get("/ready")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"]["ok"] is False
    assert "DATABASE_URL" in body["checks"]["database"]["detail"]


def test_ready_reports_ok_when_database_reachable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "check_database", lambda _url: (True, "ok"))
    app.dependency_overrides[main.get_settings] = lambda: Settings(database_url="postgresql://x")
    try:
        res = client.get("/ready")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_ready_never_raises_on_unreachable_database() -> None:
    app.dependency_overrides[main.get_settings] = lambda: Settings(
        database_url="postgresql://nobody:nopass@127.0.0.1:1/none"
    )
    try:
        res = client.get("/ready")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503
    assert res.json()["checks"]["database"]["ok"] is False
