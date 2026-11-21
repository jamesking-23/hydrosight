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

## Phase 3: ingestion and real-time monitoring - BUILT 2026-11-20
Migration `0005_readings_ingestion.sql` is applied to Supabase. Design: `docs/DECISIONS/ADR-004-ingestion-and-freshness.md`.
- Built: `readings` and `forecasts` tables (RLS, tenant isolation, demo-org read policy); `public.ingest_readings()` (API key + `readings.write` scope, per-item results, idempotent, physical plausibility only); `POST /v1/readings` on the API; `sensor_status` view (live / stale / offline / never reported, from each sensor's expected interval); MET Norway hourly-rain forecast job (`python -m hydrosight_api.forecast_met`) with a 3-hourly GitHub Actions schedule that says so explicitly and does nothing until the owner configures it; map station panel shows per-sensor status, latest value (labelled "last reading, not current" once not live), and the 24 h rain forecast with FORECAST badge and MET Norway attribution.
- Verified: 145 database tests pass on real PostGIS in CI (readings, duplicates, conflicts, rejections, scope/revoked/expired keys, cross-tenant isolation, no direct writes, freshness thresholds, forecasts); API HTTP-layer tests; 23 web tests; production build. The ingest function was also run on the hosted database inside a rolled-back transaction (accepted, duplicate, future and malformed items handled; demo sensor reported live and stayed `synthetic`).
- **NOT verified:** a real sensor posting to the deployed API (needs the API's `DATABASE_URL` and a created key); live calls to api.met.no (sandbox has no network; parser tested on a hand-written fixture); the map's live data fetch from the deployed site.
- **Not built (deliberately):** MQTT (needs an always-on broker host, see ADR-004), satellite rainfall (CHIRPS/IMERG), quality-control beyond plausibility flags, rate limiting, readings partitioning/retention, an admin screen to register stations/sensors (use SQL or the API/import for now), synthetic demo readings.

## Phase 4: alerts and warning governance - BUILT 2026-11-20
Migration `0006_alerts_governance.sql` is applied to Supabase. Design: `docs/DECISIONS/ADR-005-alerts-governance.md`.
- Built: threshold rules (draft, approve by a different person, retire; documented basis required); alert engine with hysteresis, cooldown, de-duplication, maintenance windows, stale-sensor skip; alert lifecycle draft, in review, approved, published, updated, cancelled, expired with append-only event history; four-eyes rule for public alerts; required content (timing, duration, action, authority, evidence, expiry); new versions instead of edits; acknowledgement and escalation; false-alarm tagging; conflicting-information view (official first); notification queue with consent, caps and dry-run default; CAP 1.2 feed (`/v1/cap/alerts`); 15-minute ops workflow; web screens `/alerts`, `/alerts/new`, `/alerts/[id]`, `/rules`.
- Verified: about 40 new database tests plus CAP, notification and ingest-hook tests pass on real PostGIS in CI (run 44652502398); 31 web tests; lint, typecheck and production build; on the hosted database the engine runs, the four governance constraints exist and a direct insert of a published alert is refused; anon cannot execute alert functions and authenticated cannot run the engine.
- **NOT verified:** the new web screens against live sign-in (needs the owner's first run); CAP against the official XSD; any real SMS/email/push provider (none chosen or verified; sending stays dry-run); the GitHub 15-minute job (needs secret `DATABASE_URL`); the engine with a real sensor stream.
- **Not built:** escalation recipients and cancellation notices to subscribers; automatic model-risk and community-origin alerts; alert area polygons in CAP; Luganda/Swahili message text (falls back to English, needs human translation); subscription and maintenance-window screens; rate limiting of the public CAP feed; a platform-admin switch to put an organisation into live sending.
- **Phase 3 gap, stated plainly:** Phase 3 as specified in the build prompt was only partly built (see below). Recommend a "Phase 3b" before field deployment.

## Phase 3b: devices, QC, calibration, health, realtime - BUILT 2026-11-21 (completes Phase 3)
Migration `0007_devices_qc_calibration_health.sql` is applied to Supabase. Design: `docs/DECISIONS/ADR-006-devices-qc-calibration-health.md`.
- Built: device registry and provisioning with per-device keys; `/v1/ingest/readings`; sequence, battery, signal, clock-skew and delayed-upload handling; immutable raw readings; QC pipeline with flags; calibration (read-time, append-only); gap detection and explicit interpolation (estimated); device health; realtime publication; synthetic device simulator with injected faults; screens `/monitor`, `/devices`, Dashboard v1.
- Verified: 247 tests pass on real PostGIS in CI (run 44803362267), 39 web tests, production build, Vercel deployment READY. On the hosted database: migration applied, security advisor shows only the intended SECURITY DEFINER warnings (each function checks permission inside), and a rolled-back 50-device run accepted 1,200 of 1,200 readings.
- Latency (database only, no HTTP/network, not an SLA): CI runner, per-batch ingest p50 3.6 ms, p95 4.08 ms, p99 4.5 ms, max 15.9 ms over 1,186 batches (274 batches/s). Hosted Supabase, one 50-device round (50 batches): ingest p50 45.9 ms, p95 51.7 ms, max 63.6 ms; QC pass p50 34.3 ms, p95 36.5 ms; engine p50 0.1 ms (no active rules exist, so this is not representative).
- **NOT verified:** live sign-in with the new screens; Realtime in a browser; real devices; HTTP-path latency; drift detection (not built); offline-device alerting (not built).

## Phase 5: community intelligence - BUILT 2026-11-21
Migration `0008_community_reports.sql` applied to Supabase. Design: `docs/DECISIONS/ADR-007-community-intelligence.md`.
- Built: installable community app (`/community`: report form with geolocation, depth, photo; offline queue with safe retry; warnings with confirm/dispute; safe places; language switcher; settings), public report API with server-side photo re-encoding, moderation screen (`/moderation`), duplicate grouping, unverified reports on the map with plain trust signals, safe places published only by a second person.
- Verified: CI green (296 API tests on real PostGIS including tenant isolation, 54 web tests), production build; on the hosted database a rolled-back run showed demo area open, report stored as unvalidated/community, nearby report grouped, EXIF photo refused.
- **NOT verified:** a real phone (install, camera, geolocation, background sync), live sign-in on the new screens, Luganda and Kiswahili text (empty, falls back to English), anonymous endpoint abuse resistance, consent wording legally.

## Phase 6: prediction engine and validation harness - BUILT 2026-11-21
Migration `0009_prediction_engine.sql` applied to Supabase. Design: `docs/DECISIONS/ADR-008-prediction-engine.md`.
- Built: scoring harness (POD, FAR, CSI, Brier, reliability, lead time, extreme events) with temporal hold-out and no-lookahead; four baselines; gate refusing learned models on non-real data; external-model interface (nothing integrated); model registry, immutable predictions and backtests, promotion governance in the database; engine that predicts only from approved thresholds and fresh data; `/forecasts` screen with uncertainty band, model version, input provenance, ageing.
- Verified: CI green (database tests on real PostGIS incl. tenant isolation); hosted database rolled-back check refused a measured-source prediction, prediction edits, direct status change, learned model on synthetic data, and extent target.
- **NOT verified:** any skill on real data (none supplied; every score so far is on labelled synthetic fixtures), the engine run against the hosted database, the forecast screen with a live sign-in, scheduling. No learned model trained.

## Next: waiting for owner's "proceed" (Phase 7).
