"""Periodic alert housekeeping (run every ~15 minutes by a scheduled job): catch-up threshold
evaluation, expiry of old alerts, escalation of unacknowledged ones, then notification dispatch
(dry-run unless explicitly live).

    DATABASE_URL=... python -m hydrosight_api.alert_ops
"""

import json
import os
import sys

import psycopg

from hydrosight_api.notifications import default_providers, dispatch_queue


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL is not set; nothing was done.")
        return 2
    with psycopg.connect(url, prepare_threshold=None) as conn:
        evaluated = conn.execute("select public.evaluate_thresholds_for(null)").fetchone()
        expired = conn.execute("select public.expire_alerts()").fetchone()
        escalated = conn.execute("select public.escalate_alerts()").fetchone()
        sent = dispatch_queue(
            conn,
            global_mode=os.environ.get("NOTIFY_MODE", "dry_run"),
            providers=default_providers(),
        )
    print(
        json.dumps(
            {
                "evaluate": evaluated[0] if evaluated else None,
                "expired": expired[0] if expired else None,
                "escalated": escalated[0] if escalated else None,
                "notifications": sent,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
