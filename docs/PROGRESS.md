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

## Progress preview (GitHub Pages)
A static build of the web app is published by `.github/workflows/pages.yml` on every push to `main`, at https://jamesking-23.github.io/hydrosight/ once Pages is enabled (Settings > Pages > Source: GitHub Actions, if the workflow cannot enable it itself).
It is a **static preview only**: no API, database, `/health` or `/ready`. It is not a production deployment. The normal Docker/standalone build is unchanged.

## Hosting (Vercel + Supabase)
- **Web:** Vercel project `hydrosight` (team `kkingg`, root `apps/web`), https://hydrosight-kkingg.vercel.app. Protected by Vercel Authentication (visible only when logged into Vercel). Redeploys on every push to `main`.
- **API:** Vercel project `hydrosight-api` (root `services/api`, FastAPI via `index.py`), https://hydrosight-api.vercel.app. Vercel Authentication is OFF for this project only, because devices and the web server must reach it; it currently exposes only `/health`, `/ready`, `/docs`.
- Web reaches the API through the `API_INTERNAL_URL` environment variable (a public URL, no secret).
- **Database:** Supabase project `hydrosight` (ref `jscpwdolgneqwyxnuzno`, org "2ND ORG", region `eu-central-1` Frankfurt, URL https://jscpwdolgneqwyxnuzno.supabase.co). The first Supabase account hit its 2-free-project limit, so a second account is used. Migration `0001_foundations` is applied (PostGIS 3.3 + pgcrypto in the `extensions` schema, five shared enums); Supabase security advisor reported no issues afterwards. Region closer to East Africa has NOT been checked (UNVERIFIED).
- Web has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public by design; not used by any code yet).
- **API is NOT yet connected to the database:** `DATABASE_URL` (contains the DB password, so it must be entered by the owner directly in Vercel, never in chat or git) is not set. Use the **Transaction pooler** connection string from Supabase's Connect dialog (Vercel functions need IPv4; the direct host is IPv6-only). Until then API `/ready` reports `database: DATABASE_URL is not set` (HTTP 503).
- Serverless caveats: Vercel Functions are stateless and time-limited. Long-running workers, scheduled scientific jobs and an MQTT broker will need a different host later (ADR needed when Phase 3/6 arrive).

## Next: Phase 1 (identity, tenancy, RBAC, audit). Waiting for owner's "proceed".
