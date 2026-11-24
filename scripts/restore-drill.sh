#!/usr/bin/env bash
# Timed backup-and-restore drill on a scratch PostgreSQL server (Phase 10).
# Builds a database from db/migrations with synthetic volume, backs it up, DESTROYS it, restores
# into a new database, and checks the restored copy against what existed before.
# Usage: ADMIN_URL=postgresql://postgres:pw@localhost:5432/postgres ./scripts/restore-drill.sh [readings]
# Needs a PostgreSQL 15+ server with postgis and pgcrypto available, and psql/pg_dump/pg_restore.
set -euo pipefail
: "${ADMIN_URL:?set ADMIN_URL to a superuser connection to a scratch server}"
READINGS="${1:-1000000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
base="${ADMIN_URL%/*}"
SRC="hs_drill_src"; DST="hs_drill_restored"
work="$(mktemp -d)"
now() { date +%s.%N; }
sec() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.1f", b-a}'; }
psqlq() { psql -v ON_ERROR_STOP=1 -X -q -At "$@"; }

for d in "$SRC" "$DST"; do psqlq "$ADMIN_URL" -c "drop database if exists $d with (force)"; done
psqlq "$ADMIN_URL" -c "create database $SRC"

prereq() {  # what a Supabase project already provides
  psqlq "$1" -f "$ROOT/services/api/tests/sql/supabase_stub.sql" >/dev/null
  psqlq "$1" -c "create extension if not exists postgis with schema extensions; create extension if not exists pgcrypto with schema extensions;"
}

t0=$(now)
prereq "$base/$SRC"
for f in "$ROOT"/db/migrations/*.sql; do psqlq "$base/$SRC" -f "$f" >/dev/null; done
t1=$(now)
psqlq "$base/$SRC" <<SQL
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a','a@drill.test'),('00000000-0000-0000-0000-00000000000b','b@drill.test');
insert into public.organizations (id, name, slug) values ('10000000-0000-0000-0000-00000000000a','Drill A','drill-a'),('10000000-0000-0000-0000-00000000000b','Drill B','drill-b');
insert into public.memberships (org_id, user_id, role_key, status) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','org_admin','active'),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','org_admin','active');
insert into public.stations (org_id, code, name, geom, source_type)
select o, 'DRILL-'||n, 'Drill station '||n, extensions.st_setsrid(extensions.st_makepoint(30+n*0.01, 0.1), 4326), 'synthetic'
  from (values ('10000000-0000-0000-0000-00000000000a'::uuid),('10000000-0000-0000-0000-00000000000b'::uuid)) v(o), generate_series(1,10) n;
insert into public.sensors (org_id, station_id, kind, unit, expected_interval_s, source_type)
select org_id, id, 'water_level', 'm', 900, 'synthetic' from public.stations;
insert into public.readings (org_id, sensor_id, observed_at, value, source_type)
select s.org_id, s.id, timestamptz '2026-01-01' + (g * interval '1 minute'), 1 + (g % 100) / 50.0, 'synthetic'
  from public.sensors s, generate_series(1, $READINGS / 20) g;
SQL
t2=$(now)

snapshot() {
  psqlq "$1" -c "select table_schema||'.'||table_name||' '||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
    from information_schema.tables where table_schema in ('public','private') and table_type='BASE TABLE' order by 1" > "$2"
  psqlq "$1" -c "select 'rls_tables '||count(*) from pg_class where relrowsecurity and relnamespace='public'::regnamespace
    union all select 'policies '||count(*) from pg_policies where schemaname='public'
    union all select 'triggers '||count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')
    union all select 'functions '||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
    union all select 'anon_table_grants '||count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public'
    union all select 'authenticated_table_grants '||count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public'
    order by 1" >> "$2"
}
snapshot "$base/$SRC" "$work/before.txt"
db_size="$(psqlq "$base/$SRC" -c "select pg_size_pretty(pg_database_size('$SRC'))")"

t3=$(now)
DATABASE_URL="$base/$SRC" "$ROOT/scripts/db-backup.sh" "$work" > "$work/files.txt"
t4=$(now)
main="$(sed -n 1p "$work/files.txt")"; auth="$(sed -n 2p "$work/files.txt")"
dump_size="$(du -h "$main" | cut -f1)"

psqlq "$ADMIN_URL" -c "drop database $SRC with (force)"   # the disaster
psqlq "$ADMIN_URL" -c "create database $DST"
t5=$(now)
prereq "$base/$DST"
TARGET_URL="$base/$DST" "$ROOT/scripts/db-restore.sh" "$main" "$auth" > /dev/null
t6=$(now)

snapshot "$base/$DST" "$work/after.txt"
verdict=PASS
diff -u "$work/before.txt" "$work/after.txt" > "$work/diff.txt" || { verdict=FAIL; cat "$work/diff.txt"; }

# Behaviour checks on the restored copy (not just counts).
chk() { if [ "$2" != "$3" ]; then echo "CHECK FAILED: $1 (got '$2', want '$3')"; verdict=FAIL; else echo "check ok: $1"; fi; }
as_user() {  # run a query as the authenticated role with a given user id
  psqlq "$base/$DST" -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\",\"aal\":\"aal2\"}', true); $2; rollback;" | tail -1
}
a="00000000-0000-0000-0000-00000000000a"
chk "org A member sees only org A readings" "$(as_user $a "select count(distinct org_id) from public.readings")" "1"
chk "org A member sees no org B stations" "$(as_user $a "select count(*) from public.stations where code like 'DRILL-%' and org_id='10000000-0000-0000-0000-00000000000b'")" "0"
chk "org A member sees org A stations" "$(as_user $a "select count(*) from public.stations where org_id='10000000-0000-0000-0000-00000000000a'")" "10"
chk "anonymous role is refused the readings table" "$(psql -X -q -At "$base/$DST" -c "set role anon; select count(*) from public.readings" 2>&1 | grep -c 'permission denied')" "1"
chk "raw readings stay immutable" "$(psql -X -q -At "$base/$DST" -c "update public.readings set value = 0 where id = 1" 2>&1 | grep -c -i 'immutable\|cannot\|not allowed\|read-only')" "1"
chk "new reading inserts after restore (identity sequence restored)" "$(psqlq "$base/$DST" -c "insert into public.readings (org_id, sensor_id, observed_at, value, source_type) select org_id, id, now(), 1, 'synthetic' from public.sensors limit 1 returning id > (select max(id) - 1 from public.readings)" | head -1)" "t"
t7=$(now)

echo "---- restore drill ----"
echo "database size before backup : $db_size  (readings: $READINGS)"
echo "dump size (main)            : $dump_size"
echo "build source (migrations)   : $(sec "$t0" "$t1") s"
echo "load synthetic volume       : $(sec "$t1" "$t2") s"
echo "BACKUP  (pg_dump x2)        : $(sec "$t3" "$t4") s"
echo "RESTORE (pg_restore x2)     : $(sec "$t5" "$t6") s   <- recovery time for this size, excluding provisioning the server"
echo "verification                : $(sec "$t6" "$t7") s"
echo "RESULT: $verdict"
rm -rf "$work"
[ "$verdict" = PASS ]
