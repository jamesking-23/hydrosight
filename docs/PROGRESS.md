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
- **API is connected to the database** (verified 2026-11-18): `DATABASE_URL` was entered by the owner directly in Vercel as a Sensitive variable (Transaction pooler string; never in chat or git). API `/ready` returns 200 with `database: ok`, and web `/ready` returns 200 with `api: ready`. This only proves a connection and `select 1`; no application tables exist yet (Phase 1).
- Note for Phase 1+: the transaction pooler does not support session features such as prepared statements held across queries, so long-lived code should be tested against it.
- Serverless caveats: Vercel Functions are stateless and time-limited. Long-running workers, scheduled scientific jobs and an MQTT broker will need a different host later (ADR needed when Phase 3/6 arrive).

## Phase 1a: identity, tenancy, RBAC, audit (database layer) - DONE 2026-11-19
Migration `0002_identity_tenancy_rbac_audit.sql` is applied to Supabase and covered by 75 passing tests against real PostgreSQL (`services/api/tests`). Design: `docs/DECISIONS/ADR-002-identity-tenancy-rbac.md`.
- Supabase security advisor after applying: 1 INFO (`platform_memberships` has RLS and no policy: intentional, service role only) and 5 WARN (the five `authenticated`-callable SECURITY DEFINER functions: intentional entry points that check permission inside and are covered by tests). No ERROR.
- NOT done yet (Phase 1b): login screens, MFA enrolment UI, invitation-acceptance UI, admin screens, API-key UI, FastAPI API-key endpoint. Nothing in the web app uses this layer yet.

## Phase 1b: auth UI and admin screens (built 2026-11-19; live sign-in NOT yet exercised)
Web app now has: `/login`, `/signup`, `/auth/callback`, `/mfa` (TOTP enrol + verify), `/invite` (token read from the URL fragment, never sent to a server), `/dashboard`, `/org/[orgId]` (members, invitations, API keys). `src/proxy.ts` refreshes the session and sends signed-out visitors to `/login`; it is a convenience only, all authorisation is the database's (RLS + MFA gate).
- Verified: lint, typecheck, 13 unit tests (access logic, safe redirects, token parsing), production build, local run (signed-out redirects, explicit "could not reach sign-in service" error, safe callback fallback).
- **NOT verified:** a real sign-in, email confirmation, TOTP enrolment/verification and the admin actions against live Supabase Auth. The build environment cannot reach supabase.co. The owner must do the first run (see RUNBOOK "First sign-in").
- Removed the GitHub Pages workflow: a static export cannot host sign-in (it was already failing because Pages was not enabled).
- UI text is English only for these screens (en/lg/sw message files not yet extended).
- No email is sent yet: the invitation link is shown once for the admin to share manually.
- The web project is behind Vercel Authentication, so only people logged in to the owner's Vercel team can open it. Invitees cannot use it until that is changed (owner decision).

## Phase 2: locations, hydrography and map - BUILT 2026-11-19 (partly deferred, see below)
(Earlier notes called Phase 2 "data model for stations/sensors/readings"; that was a mislabel. Readings and ingestion are Phase 3.)
Migration `0003_hydrography_stations_sensors.sql` is applied to Supabase (PostGIS 3.3.7) and the demo seed `db/seed/demo_stations.sql` is loaded. Design: `docs/DECISIONS/ADR-003-geography.md`.
- Built: rivers, catchments (global reference geography), locations, stations, sensors (tenant tables, RLS, audit triggers), GiST indexes, geo views, `/map` page (MapLibre: layer panel, filter by river/source/status, search, station detail panel, time-slider scaffold, OSM attribution, explicit tile-failure alert), GeoPandas import CLI (`python -m hydrosight_api.geoimport`) that refuses imports without a stated source and licence.
- Verified: 19 spatial DB tests and 3 import DB tests pass on real PostGIS in CI (run 029f40d); GiST used for nearest-station query on the hosted database (seq scan disabled, tiny table); anon has no grants; security advisor shows nothing new.
- Synthetic: 6 demo stations (hand-placed, approximate) and 12 sensors in org `hydrosight-demo`, all `synthetic` + `unvalidated`. Rivers are names only: NO river geometry exists yet.
- **Deferred (not faked):** OSM roads/health facilities/schools layers and DEM elevation sampling. Both need data downloads the build environment cannot make and a licence review. Logged in OPEN_QUESTIONS and DATA_SOURCES. The import pipeline is ready for licensed river/catchment files.
- **NOT verified:** the live `/map` data fetch from the deployed site (sandbox cannot reach supabase.co), and OSM public tile use in production.

## Product posture change (2026-11-19, owner instruction)
HydroSight is built as a commercial product, not a prototype. Removed the site-wide PROTOTYPE banner and all "prototype" wording from UI, README, CLAUDE.md and new docs. Migration `0004` renames the lifecycle state `prototype` to `unvalidated` (applied to Supabase). Earlier entries above keep their original wording as history.
What did NOT change, because a commercial flood-warning product needs it: nothing is labelled validated or operational without a human admin's evidence record, source badges stay, offline/stale states stay explicit, and no public warning goes out without a second person's approval. Records and forecasts show "Not yet validated" until promoted.

## Next: Phase 3 (ingestion and real-time monitoring). Waiting for owner's "proceed".
