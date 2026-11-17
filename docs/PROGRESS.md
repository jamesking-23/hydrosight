# Progress

## Phase 0: Foundations (complete, pending owner review)

Built: repo layout; Next.js web app (strict TS, Tailwind v4, design tokens from the logo); FastAPI service; `/health` and `/ready` on both; source-type badge and PROTOTYPE maturity banner components; en/lg/sw i18n scaffold (lg/sw values intentionally empty, awaiting a human translator); migration `0001` with shared enums; Docker Compose; GitHub Actions CI; ADR-001; docs.

Verified by running (2026-11-17):
- Web: ESLint clean, `tsc --noEmit` clean, 6 Vitest tests pass, production build succeeds.
- API: ruff clean, ruff format clean, mypy strict clean, 4 pytest tests pass.
- Both servers started and probed over HTTP: `/health` 200 on both; `/ready` returns HTTP 503 with an explicit reason when the database or API is unavailable; home page shows the PROTOTYPE banner and all five source badges; logo served as 200 `image/png`.

NOT verified:
- `docker compose up --build` was not run (no Docker daemon in the build environment). Compose file, Dockerfiles and migration mounting are untested.
- `/ready` returning 200 against a real Postgres was not exercised (only via a mocked check). Untested until Docker/Postgres is available.
- Migration `0001` was not applied to a real PostGIS instance.
- CI workflow has not run yet (first run happens on push).

Not in Phase 0 by design: shadcn/ui init (ADR-001), seed script (db/seed/README.md), authentication, any real data.

## Next: Phase 1 (identity, tenancy, RBAC, audit). Waiting for owner's "proceed".
