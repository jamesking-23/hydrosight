#!/usr/bin/env bash
# Logical backup of the HydroSight database (Phase 10; see docs/DISASTER_RECOVERY.md).
# Usage: DATABASE_URL=postgresql://... ./scripts/db-backup.sh [output-dir]
# Writes two custom-format dumps and a SHA-256 file for each:
#   hydrosight-<utc-time>.dump        schemas public + private (structure, data, RLS policies, grants)
#   hydrosight-<utc-time>-auth.dump   auth.users rows only (memberships reference them)
# The dump holds personal data (emails, report text): store it encrypted and access-controlled.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the database connection string}"
out="${1:-backups}"
mkdir -p "$out"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
main="$out/hydrosight-$stamp.dump"
auth="$out/hydrosight-$stamp-auth.dump"
pg_dump --format=custom --no-owner --schema=public --schema=private --file="$main" "$DATABASE_URL"
pg_dump --format=custom --no-owner --data-only --table=auth.users --file="$auth" "$DATABASE_URL"
sha256sum "$main" "$auth" > "$out/hydrosight-$stamp.sha256"
echo "$main"
echo "$auth"
