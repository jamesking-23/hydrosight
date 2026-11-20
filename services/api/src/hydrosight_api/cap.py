"""CAP 1.2 (Common Alerting Protocol) export for published public warnings.

Built with the standard library from the documented CAP 1.2 element order. NOT validated
against the official OASIS XSD from this environment (UNVERIFIED); mappings from HydroSight
levels/confidence to CAP severity/certainty are proposals that an issuing authority must
review before any real use. No evacuation response type is ever set automatically.
"""

import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from typing import Any

NS = "urn:oasis:names:tc:emergency:cap:1.2"

SEVERITY = {
    "advisory": "Minor",
    "watch": "Moderate",
    "warning": "Severe",
    "severe_warning": "Extreme",
}
CERTAINTY = {"not_assessed": "Unknown", "low": "Possible", "medium": "Likely", "high": "Likely"}


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("CAP timestamps must carry a time zone")
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _text(parent: ET.Element, tag: str, value: str) -> ET.Element:
    el = ET.SubElement(parent, f"{{{NS}}}{tag}")
    el.text = value
    return el


def alert_to_cap(
    alert: dict[str, Any],
    *,
    sender: str,
    sender_name: str,
    previous: dict[str, Any] | None = None,
    exercise: bool = False,
    language: str = "en",
) -> bytes:
    """Return a CAP 1.2 XML document for one public alert row.

    alert: needs id, level, status, title, hazard, location_text, expected_timing, duration_text,
    recommended_action, issuing_authority, confidence, published_at, expires_at (or None),
    cancelled_at, version. previous: the superseded alert (id, published_at) for Update messages.
    Only published alerts and cancelled alerts that had been published can be exported."""
    status = alert["status"]
    if alert.get("audience", "public") != "public":
        raise ValueError("only public alerts can be exported as CAP")
    if status == "cancelled" and alert.get("published_at") is not None:
        msg_type = "Cancel"
    elif status == "published":
        msg_type = "Update" if alert.get("version", 1) > 1 and previous else "Alert"
    else:
        raise ValueError(f"alert in status {status!r} cannot be exported")
    if alert["level"] not in SEVERITY:
        raise ValueError("unknown alert level")

    ET.register_namespace("", NS)
    root = ET.Element(f"{{{NS}}}alert")
    _text(root, "identifier", str(alert["id"]))
    _text(root, "sender", sender)
    sent = alert["cancelled_at"] if msg_type == "Cancel" else alert["published_at"]
    _text(root, "sent", _iso(sent))
    _text(root, "status", "Exercise" if exercise else "Actual")
    _text(root, "msgType", msg_type)
    _text(root, "scope", "Public")
    if msg_type == "Update" and previous:
        _text(root, "references", f"{sender},{previous['id']},{_iso(previous['published_at'])}")
    elif msg_type == "Cancel":
        _text(root, "references", f"{sender},{alert['id']},{_iso(alert['published_at'])}")
        _text(root, "note", f"Cancelled: {alert.get('cancel_reason') or 'no reason recorded'}")

    info = ET.SubElement(root, f"{{{NS}}}info")
    _text(info, "language", language)
    _text(info, "category", "Met")
    _text(info, "event", str(alert["hazard"]).strip().title())
    _text(info, "urgency", "Unknown")  # timing is free text; never guessed into a CAP enum
    _text(info, "severity", SEVERITY[alert["level"]])
    _text(info, "certainty", CERTAINTY.get(alert.get("confidence", "not_assessed"), "Unknown"))
    _text(info, "effective", _iso(alert["published_at"]))
    if alert.get("expires_at"):
        _text(info, "expires", _iso(alert["expires_at"]))
    _text(info, "senderName", alert.get("issuing_authority") or sender_name)
    _text(info, "headline", alert["title"])
    description = "; ".join(
        p for p in (
            f"Expected timing: {alert['expected_timing']}" if alert.get("expected_timing") else "",
            f"Duration: {alert['duration_text']}" if alert.get("duration_text") else "",
        ) if p
    )  # fmt: skip
    if description:
        _text(info, "description", description)
    if alert.get("recommended_action"):
        _text(info, "instruction", alert["recommended_action"])
    area = ET.SubElement(info, f"{{{NS}}}area")
    _text(area, "areaDesc", alert["location_text"])
    body: bytes = ET.tostring(root, encoding="utf-8")
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + body
