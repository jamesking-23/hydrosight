#!/usr/bin/env bash
# Restore a dump made by db-backup.sh into an EMPTY database that already has the Supabase roles
# (anon, authenticated, service_role), the auth schema and the postgis + pgcrypto extensions.
# Usage: TARGET_URL=postgresql://... ./scripts/db-restore.sh <main.dump> <auth.dump>
# It refuses a dump whose SHA-256 does not match the .sha256 file next to it.
set -euo pipefail
: "${TARGET_URL:?set TARGET_URL to the EMPTY target database}"
main="${1:?main dump}"; auth="${2:?auth dump}"
sums="${main%.dump}.sha256"
if [ -f "$sums" ]; then (cd "$(dirname "$main")" && sha256sum --check --quiet "$(basename "$sums")"); else echo "no checksum file: refusing" >&2; exit 2; fi
# Supabase grants every new object in public to anon/authenticated/service_role by default, and
# pg_dump only records the grants that differ from the owner's own. Without this step a restore
# would leave every table over-granted (found in the Phase 10 drill: 434 anon grants instead of 3).
# Default privileges are switched off for the restore and put back afterwards.
psql -v ON_ERROR_STOP=1 -X -q "$TARGET_URL" -c "
  alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
  alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
  alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;"
pg_restore --no-owner --exit-on-error --dbname="$TARGET_URL" "$auth"
# The public schema already exists on a Supabase target, so drop only its CREATE entry from the list.
list="$(mktemp)"
pg_restore -l "$main" | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > "$list"
pg_restore --no-owner --exit-on-error --use-list="$list" --dbname="$TARGET_URL" "$main"
rm -f "$list"
psql -v ON_ERROR_STOP=1 -X -q "$TARGET_URL" -c "
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;"
echo restored
