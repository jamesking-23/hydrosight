"""Notification service behind a provider interface.

Default mode is DRY RUN: messages are rendered and recorded but nothing is sent. Live sending
needs BOTH the environment variable NOTIFY_MODE=live AND the organisation's own mode set to
'live' (a platform-admin action), AND a configured provider. No real provider is verified yet
(pricing, sender-ID and UCC rules are open questions), so the adapters below refuse to send
and the job is marked failed explicitly instead of being silently dropped.

    DATABASE_URL=... python -m hydrosight_api.notifications
"""

import hashlib
import json
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import psycopg

LEVEL_LABEL = {
    "advisory": "ADVISORY",
    "watch": "WATCH",
    "warning": "WARNING",
    "severe_warning": "SEVERE WARNING",
}
# Only English text exists. Luganda (lg) and Swahili (sw) templates need a human translator and
# review before use, so those subscribers currently receive English (and the job records that).
REVIEWED_LOCALES = frozenset({"en"})
SMS_MAX = 160


class NotConfiguredError(Exception):
    """Raised by a provider that has no verified credentials/terms yet."""


class Provider(Protocol):
    name: str

    def send(self, channel: str, recipient: str, body: str) -> str:
        """Send and return the provider's receipt id. Raise on failure."""


class DryRunProvider:
    name = "dry_run"

    def send(self, channel: str, recipient: str, body: str) -> str:
        return (
            "dry_run:" + hashlib.sha256(f"{channel}|{recipient}|{body}".encode()).hexdigest()[:16]
        )


class UnverifiedProvider:
    """Placeholder for Africa's Talking (SMS), Resend/Postmark/SES (email) and VAPID Web Push.
    It never sends. Replace with a real adapter only after its terms, pricing and any regulator
    requirements are verified and recorded in docs/DATA_SOURCES.md."""

    def __init__(self, name: str) -> None:
        self.name = name

    def send(self, channel: str, recipient: str, body: str) -> str:
        raise NotConfiguredError(f"provider {self.name!r} is not verified or configured")


def _ascii(text: str) -> str:
    return text.encode("ascii", "replace").decode().replace("?", "")


def sms_text(alert: Mapping[str, Any]) -> str:
    """SMS-length variant (<= 160 chars, plain ASCII so it stays a single GSM segment)."""
    head = f"HydroSight {LEVEL_LABEL.get(alert['level'], alert['level'].upper())}: {alert['hazard']} - {alert['location_text']}."
    tail = ""
    if alert.get("expires_at"):
        tail += f" Until {alert['expires_at']:%H:%M}Z."
    if alert.get("issuing_authority"):
        tail += f" {alert['issuing_authority']}"
    room = SMS_MAX - len(_ascii(head)) - len(_ascii(tail)) - 1
    action = _ascii(alert.get("recommended_action") or "")
    middle = f" {action[: max(room, 0)].rstrip()}" if room > 3 and action else ""
    text = _ascii(head + middle + tail)
    return text if len(text) <= SMS_MAX else text[: SMS_MAX - 3].rstrip() + "..."


def render(alert: Mapping[str, Any], channel: str, locale: str) -> tuple[str, str]:
    """Return (body, locale_used). Unreviewed locales fall back to English."""
    used = locale if locale in REVIEWED_LOCALES else "en"
    if channel == "sms":
        return sms_text(alert), used
    lines = [
        f"{LEVEL_LABEL.get(alert['level'], alert['level'])}: {alert['title']}",
        f"Where: {alert['location_text']}",
        f"Expected timing: {alert.get('expected_timing') or 'not stated'}",
        f"Duration: {alert.get('duration_text') or 'not stated'}",
        f"What to do: {alert.get('recommended_action') or 'not stated'}",
        f"Issued by: {alert.get('issuing_authority') or 'not stated'}",
    ]
    if alert.get("expires_at"):
        lines.append(f"Valid until: {alert['expires_at']:%Y-%m-%d %H:%M} UTC")
    if channel == "web_push":
        return json.dumps({"title": lines[0], "body": " | ".join(lines[1:3])}), used
    return "\n".join(lines), used  # email: first line doubles as the subject


@dataclass
class Outcome:
    status: str
    provider: str | None
    receipt: str | None
    error: str | None
    attempts: int


def deliver(
    channel: str,
    recipient: str,
    body: str,
    *,
    live: bool,
    providers: Mapping[str, Sequence[Provider]],
    attempts_so_far: int = 0,
    max_attempts: int = 3,
) -> Outcome:
    """Dry run records without sending. Live tries each provider in order (failover); if all
    fail the job stays queued for a retry until max_attempts, then is marked failed."""
    if not live:
        p = DryRunProvider()
        return Outcome(
            "dry_run", p.name, p.send(channel, recipient, body), None, attempts_so_far + 1
        )
    errors: list[str] = []
    for provider in providers.get(channel, ()):
        try:
            return Outcome(
                "sent",
                provider.name,
                provider.send(channel, recipient, body),
                None,
                attempts_so_far + 1,
            )
        except Exception as exc:  # noqa: BLE001 - any provider failure triggers failover
            errors.append(f"{provider.name}: {type(exc).__name__}: {exc}")
    if not errors:
        errors.append(f"no provider configured for channel {channel!r}")
    attempts = attempts_so_far + 1
    status = (
        "failed"
        if attempts >= max_attempts
        or all("not verified" in e or "no provider" in e for e in errors)
        else "queued"
    )
    return Outcome(status, None, None, "; ".join(errors), attempts)


def dispatch_queue(
    conn: psycopg.Connection[Any],
    *,
    global_mode: str,
    providers: Mapping[str, Sequence[Provider]],
    batch: int = 50,
) -> dict[str, int]:
    summary = {"dry_run": 0, "sent": 0, "failed": 0, "retry": 0, "suppressed": 0}
    rows = conn.execute(
        """select j.id, j.channel, j.locale, j.attempts, s.address, coalesce(ns.mode, 'dry_run') as org_mode,
                  a.status::text as alert_status, a.level::text as level, a.title, a.hazard, a.location_text,
                  a.expected_timing, a.duration_text, a.recommended_action, a.issuing_authority, a.expires_at
             from public.notification_jobs j
             join public.subscriptions s on s.id = j.subscription_id
             join public.alerts a on a.id = j.alert_id
             left join public.notification_settings ns on ns.org_id = j.org_id
            where j.status = 'queued' order by j.id limit %s for update of j skip locked""",
        (batch,),
    ).fetchall()
    for r in rows:
        job = dict(zip(JOB_COLUMNS, r, strict=True))
        if job["alert_status"] != "published":
            conn.execute(
                "update public.notification_jobs set status='suppressed_cancelled', updated_at=now() where id=%s",
                (job["id"],),
            )
            summary["suppressed"] += 1
            continue
        body, used = render(job, job["channel"], job["locale"])
        live = global_mode == "live" and job["org_mode"] == "live"
        out = deliver(
            job["channel"],
            job["address"],
            body,
            live=live,
            providers=providers,
            attempts_so_far=job["attempts"],
        )
        conn.execute(
            "update public.notification_jobs set status=%s, provider=%s, provider_receipt=%s, last_error=%s,"
            " attempts=%s, body=%s, locale=%s, updated_at=now() where id=%s",
            (out.status, out.provider, out.receipt, out.error, out.attempts, body, used, job["id"]),
        )
        summary["retry" if out.status == "queued" else out.status] += 1
    return summary


JOB_COLUMNS = (
    "id", "channel", "locale", "attempts", "address", "org_mode", "alert_status", "level", "title",
    "hazard", "location_text", "expected_timing", "duration_text", "recommended_action",
    "issuing_authority", "expires_at",
)  # fmt: skip


def default_providers() -> dict[str, list[Provider]]:
    return {
        "sms": [UnverifiedProvider("africas_talking")],
        "email": [UnverifiedProvider("email_provider")],
        "web_push": [UnverifiedProvider("vapid_web_push")],
    }


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL is not set; nothing was dispatched.")
        return 2
    mode = os.environ.get("NOTIFY_MODE", "dry_run")
    with psycopg.connect(url, prepare_threshold=None, row_factory=None) as conn:
        print(
            json.dumps(
                {
                    "mode": mode,
                    **dispatch_queue(conn, global_mode=mode, providers=default_providers()),
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
