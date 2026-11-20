"""Notification rendering, dry-run default, failover, retry and explicit failure."""

from datetime import UTC, datetime
from typing import Any

import pytest

from hydrosight_api import notifications as n

ALERT = {
    "level": "severe_warning", "title": "Flood at Test Bridge", "hazard": "flood",
    "location_text": "Test Bridge, Kabale", "expected_timing": "Next 6 hours", "duration_text": "12 hours",
    "recommended_action": "Move to higher ground and avoid the river bank until the all-clear is given",
    "issuing_authority": "District Disaster Office", "expires_at": datetime(2026, 11, 20, 15, 0, tzinfo=UTC),
}  # fmt: skip


def test_sms_variant_fits_one_segment_and_is_plain_ascii() -> None:
    text = n.sms_text(ALERT)
    assert len(text) <= 160 and text.isascii()
    assert text.startswith("HydroSight SEVERE WARNING: flood - Test Bridge, Kabale.")
    assert "Until 15:00Z" in text and "District Disaster Office" in text
    long = {**ALERT, "recommended_action": "x" * 500, "location_text": "ñ" * 80}
    assert len(n.sms_text(long)) <= 160 and n.sms_text(long).isascii()


def test_unreviewed_locales_fall_back_to_english_and_say_so() -> None:
    assert n.render(ALERT, "email", "lg")[1] == "en"
    assert n.render(ALERT, "sms", "sw")[1] == "en"
    assert n.render(ALERT, "email", "en")[1] == "en"


def test_email_and_push_bodies_carry_all_required_content() -> None:
    body, _ = n.render(ALERT, "email", "en")
    for needle in (
        "SEVERE WARNING",
        "Test Bridge",
        "Next 6 hours",
        "12 hours",
        "Move to higher ground",
        "District Disaster Office",
        "Valid until",
    ):
        assert needle in body
    assert n.render(ALERT, "web_push", "en")[0].startswith("{")


def test_dry_run_never_calls_a_provider() -> None:
    class Boom:
        name = "boom"

        def send(self, *_: Any) -> str:
            raise AssertionError("must not send in dry run")

    out = n.deliver("sms", "+256700000000", "hi", live=False, providers={"sms": [Boom()]})
    assert out.status == "dry_run" and out.receipt and out.receipt.startswith("dry_run:")


def test_live_mode_with_unverified_providers_fails_explicitly_not_silently() -> None:
    out = n.deliver("sms", "+256700000000", "hi", live=True, providers=n.default_providers())
    assert out.status == "failed" and out.error and "not verified" in out.error


def test_live_mode_fails_over_to_the_next_provider() -> None:
    class Down:
        name = "down"

        def send(self, *_: Any) -> str:
            raise TimeoutError("timeout")

    class Up:
        name = "up"

        def send(self, *_: Any) -> str:
            return "receipt-1"

    out = n.deliver("sms", "x", "b", live=True, providers={"sms": [Down(), Up()]})
    assert (out.status, out.provider, out.receipt) == ("sent", "up", "receipt-1")


def test_transient_failures_retry_then_fail() -> None:
    class Down:
        name = "down"

        def send(self, *_: Any) -> str:
            raise TimeoutError("timeout")

    first = n.deliver("sms", "x", "b", live=True, providers={"sms": [Down()]}, attempts_so_far=0)
    assert first.status == "queued" and first.attempts == 1
    last = n.deliver("sms", "x", "b", live=True, providers={"sms": [Down()]}, attempts_so_far=2)
    assert last.status == "failed" and "timeout" in (last.error or "")


def test_cli_refuses_without_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert n.main() == 2
