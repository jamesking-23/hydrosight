"""Forecast adapter. The fixture is HAND-WRITTEN to the documented Locationforecast shape;
it is not a recording of the live service (UNVERIFIED against api.met.no)."""

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from hydrosight_api import forecast_met as fm

DOC = {
    "properties": {
        "meta": {"updated_at": "2026-11-20T06:15:00Z"},
        "timeseries": [
            {"time": "2026-11-20T07:00:00Z", "data": {"next_1_hours": {"details": {"precipitation_amount": 0.4}}}},
            {"time": "2026-11-20T08:00:00Z", "data": {"next_1_hours": {"details": {"precipitation_amount": 0.0}}}},
            {"time": "2026-11-20T09:00:00Z", "data": {"next_6_hours": {"details": {"precipitation_amount": 3.0}}}},
            {"time": "2026-11-20T10:00:00Z", "data": {"next_1_hours": {"details": {"precipitation_amount": -1}}}},
            {"time": "2026-11-20T11:00:00Z", "data": {"next_1_hours": {"details": {"precipitation_amount": "x"}}}},
            {"time": "2026-11-20T12:00:00Z"},
        ],
    }
}  # fmt: skip


def test_parses_only_valid_one_hour_amounts() -> None:
    issued, rows = fm.parse_precipitation(DOC)
    assert issued == datetime(2026, 11, 20, 6, 15, tzinfo=UTC)
    assert [(t.hour, v) for t, v in rows] == [
        (7, 0.4),
        (8, 0.0),
    ]  # 6h, negative, text, empty: skipped


@pytest.mark.parametrize(
    "bad",
    [{}, {"properties": {}}, {"properties": {"meta": {"updated_at": "nope"}, "timeseries": []}}],
)
def test_unexpected_shape_raises(bad: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="Locationforecast"):
        fm.parse_precipitation(bad)


def test_url_truncates_coordinates_to_four_decimals() -> None:
    assert fm.url_for(0.4236123456, 33.2040987) == f"{fm.ENDPOINT}?lat=0.4236&lon=33.2041"


class FakeConn:
    def __init__(self, stations: list[tuple[Any, ...]]) -> None:
        self.stations, self.inserted = stations, []

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> Any:
        if sql.lstrip().startswith("select"):
            return type("R", (), {"fetchall": lambda _s: self.stations})()
        self.inserted.append(params)
        return None


def test_run_stores_rows_and_reports_failures_without_stopping() -> None:
    conn = FakeConn([("s1", "o", 0.1, 30.0), ("s2", "o", 0.2, 31.0)])
    calls: list[str] = []

    def fetch(url: str, ua: str) -> bytes:
        calls.append(ua)
        if "lat=0.2000" in url:
            raise OSError("network down")
        return json.dumps(DOC).encode()

    out = fm.run(conn, fetch, "HydroSight/1.0 (contact: ops@example.com)", pause_s=0)  # type: ignore[arg-type]
    assert out == {"stations": 2, "values": 2, "failed_stations": 1}
    assert len(conn.inserted) == 2
    assert all("contact" in ua for ua in calls)


def test_dry_run_stores_nothing_and_anonymous_user_agent_is_refused() -> None:
    conn = FakeConn([("s1", "o", 0.1, 30.0)])
    out = fm.run(conn, lambda *_: json.dumps(DOC).encode(), "a@b.c", dry_run=True, pause_s=0)  # type: ignore[arg-type]
    assert out["values"] == 2 and conn.inserted == []
    with pytest.raises(ValueError, match="identify"):
        fm.run(conn, lambda *_: b"", "python-requests", pause_s=0)  # type: ignore[arg-type]


def test_cli_refuses_to_run_without_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FORECAST_USER_AGENT", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert fm.main([]) == 2
