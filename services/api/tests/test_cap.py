"""CAP 1.2 export. Structure follows the documented element order; NOT validated against the
official OASIS XSD (UNVERIFIED)."""

import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from hydrosight_api.cap import NS, alert_to_cap

T = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)


def _alert(**over: Any) -> dict[str, Any]:
    base = {
        "id": "11111111-1111-1111-1111-111111111111", "level": "warning", "status": "published",
        "audience": "public", "title": "Flood at Test Bridge", "hazard": "flood",
        "location_text": "Test Bridge", "expected_timing": "Next 6 hours", "duration_text": "About 12 hours",
        "recommended_action": "Move to higher ground", "issuing_authority": "District Disaster Office",
        "confidence": "medium", "published_at": T, "expires_at": T + timedelta(hours=6),
        "cancelled_at": None, "cancel_reason": None, "version": 1,
    }  # fmt: skip
    return {**base, **over}


def _parse(xml: bytes) -> ET.Element:
    return ET.fromstring(xml)  # noqa: S314 - our own generated output


def _find(el: ET.Element, path: str) -> ET.Element | None:
    return el.find(path, {"c": NS})


def test_published_alert_maps_to_cap_alert_message() -> None:
    root = _parse(alert_to_cap(_alert(), sender="org@hydrosight.example", sender_name="Org"))
    assert root.tag == f"{{{NS}}}alert"
    get = lambda p: _find(root, p).text if _find(root, p) is not None else None  # noqa: E731
    assert (
        get("c:msgType") == "Alert" and get("c:status") == "Actual" and get("c:scope") == "Public"
    )
    assert get("c:info/c:severity") == "Severe" and get("c:info/c:certainty") == "Likely"
    assert get("c:info/c:urgency") == "Unknown"  # never guessed from free-text timing
    assert get("c:info/c:area/c:areaDesc") == "Test Bridge"
    assert get("c:info/c:instruction") == "Move to higher ground"
    assert get("c:info/c:expires") == "2026-11-20T15:00:00+00:00"
    assert _find(root, "c:info/c:responseType") is None  # no automatic evacuation instruction


def test_element_order_matches_cap_1_2() -> None:
    root = _parse(alert_to_cap(_alert(), sender="s", sender_name="n"))
    order = [c.tag.split("}")[1] for c in root]
    assert order == ["identifier", "sender", "sent", "status", "msgType", "scope", "info"]
    info = [c.tag.split("}")[1] for c in _find(root, "c:info")]  # type: ignore[union-attr]
    expected = ["language", "category", "event", "urgency", "severity", "certainty", "effective",
                "expires", "senderName", "headline", "description", "instruction", "area"]  # fmt: skip
    assert info == expected


def test_update_references_the_previous_message_and_cancel_says_why() -> None:
    prev = {"id": "00000000-0000-0000-0000-000000000000", "published_at": T - timedelta(hours=1)}
    upd = _parse(alert_to_cap(_alert(version=2), sender="s", sender_name="n", previous=prev))
    assert _find(upd, "c:msgType").text == "Update"  # type: ignore[union-attr]
    assert (
        _find(upd, "c:references").text
        == "s,00000000-0000-0000-0000-000000000000,2026-11-20T08:00:00+00:00"
    )  # type: ignore[union-attr]
    canc = _parse(alert_to_cap(
        _alert(status="cancelled", cancelled_at=T + timedelta(hours=1), cancel_reason="River receded"),
        sender="s", sender_name="n",
    ))  # fmt: skip
    assert _find(canc, "c:msgType").text == "Cancel"  # type: ignore[union-attr]
    assert "River receded" in _find(canc, "c:note").text  # type: ignore[union-attr, operator]


def test_demo_data_is_marked_as_exercise_never_actual() -> None:
    root = _parse(alert_to_cap(_alert(), sender="s", sender_name="n", exercise=True))
    assert _find(root, "c:status").text == "Exercise"  # type: ignore[union-attr]


@pytest.mark.parametrize("bad", [{"status": "draft"}, {"status": "approved"}, {"status": "in_review"},
                                 {"audience": "internal"}, {"status": "cancelled", "published_at": None},
                                 {"level": "normal"}])  # fmt: skip
def test_only_published_public_alerts_can_be_exported(bad: dict[str, Any]) -> None:
    with pytest.raises(ValueError):  # noqa: PT011
        alert_to_cap(_alert(**bad), sender="s", sender_name="n")


def test_text_is_escaped_and_timestamps_need_a_zone() -> None:
    xml = alert_to_cap(_alert(title="A < B & <script>"), sender="s", sender_name="n")
    assert (
        b"<script>" not in xml
        and _find(_parse(xml), "c:info/c:headline").text == "A < B & <script>"
    )  # type: ignore[union-attr]
    with pytest.raises(ValueError, match="time zone"):
        alert_to_cap(_alert(published_at=datetime(2026, 1, 1)), sender="s", sender_name="n")  # noqa: DTZ001
