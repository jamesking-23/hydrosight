# Disaster recovery (Phase 10)

## Scope and honesty
- What exists: logical backup and restore scripts (`scripts/db-backup.sh`, `scripts/db-restore.sh`) and a timed drill (`scripts/restore-drill.sh`).
- What was run: the drill on a scratch PostgreSQL 16 + PostGIS server in the build sandbox, not on the hosted Supabase project.
- What is UNVERIFIED: whether Supabase's free plan keeps provider backups or point-in-time recovery (check the project's Database > Backups page and the current plan terms; do not rely on it until confirmed). Recovery time on the hosted database, over its network, with real data volume.

## Drill result (2026-11-24, scratch server, synthetic data)
| Item | Value |
|---|---|
| Database size | 573 MB (2,000,000 synthetic readings, 2 organisations, 20 stations) |
| Dump size (public + private) | 8.0 MB |
| Backup (two `pg_dump` runs) | 3.4 s |
| Restore into a new empty database (two `pg_restore` runs) | 12.1 s |
| Verification | table row counts, RLS table count, policy count, trigger count, function count and role grants identical before and after; org A member sees only org A data; anonymous role refused; raw readings still immutable; identity sequence restored (new reading inserts) |
| Result | PASS |
These times are for a local server with no network. They are **not** a recovery-time promise. Provisioning a new Supabase project, re-creating the auth users, re-pointing Vercel and re-verifying are additional steps measured in minutes to hours, not measured here.

## Finding from the drill (fixed)
The first restore passed the row counts but left `anon` with 434 table grants instead of 3, because the target's default privileges re-granted every new table and `pg_dump` records only grants that differ from the owner's. Row-level security still applied, but the grant layer was gone. `db-restore.sh` now switches default privileges off during the restore and puts them back after; the drill compares grant counts so this cannot regress silently.

## Procedure: restore into a new Supabase project
1. Create a new Supabase project. Enable `postgis` and `pgcrypto` (schema `extensions`).
2. Get the new project's database connection string (Settings > Database) into `TARGET_URL`. Never paste it into git or chat.
3. `TARGET_URL=... ./scripts/db-restore.sh backups/hydrosight-<time>.dump backups/hydrosight-<time>-auth.dump` (checks the SHA-256 first; refuses if it does not match).
4. The dump restores `auth.users` rows (ids and emails) so memberships keep working, but **not passwords or MFA factors**: every user must reset their password and re-enrol MFA. Plan for this.
5. Update the Vercel environment variables (`NEXT_PUBLIC_SUPABASE_URL`, anon key, `DATABASE_URL`) and redeploy. Keys exposed or rotated since the backup must stay rotated.
6. Verify: sign in, open `/monitor`, check `/platform`, check an organisation member cannot see another organisation's data. Run `scripts/restore-drill.sh`-style checks if a scratch copy is available.

## Taking backups
`DATABASE_URL=... ./scripts/db-backup.sh backups/` (a read-only database role is better than the owner). Schedule it somewhere you control (a scheduled GitHub Actions job writing to encrypted storage, or a cron on your own machine). **No scheduled backup is set up yet.** Dumps contain personal data: encrypt and restrict them. Test a restore from a real dump at least every quarter.

## Targets
Recovery point and recovery time targets are **not set**: the owner and each customer must decide them. Until then no figure may be promised.

## What is not covered
Realtime channels and Edge/Storage objects (none are used), Vercel project settings (recreate from `docs/RUNBOOK.md`), secrets (kept in Vercel and the owner's password manager; none are in git), and loss of the GitHub repository (the repo is the source of truth for code and migrations; keep a second copy).
