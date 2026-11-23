# HydroSight: conventions for AI sessions

Flood risk intelligence and early warning platform (Uganda / East Africa first). HydroSight is a commercial product, not a prototype: build to production standards (security, reliability, tests, docs, support, billing-readiness) and never describe it as a prototype in code, UI or docs.
Owner: James (civil engineer, not a full-time software engineer). Brand: "HydroSight" (one word).

## Source of truth
1. Safety and honesty rules (below, mirrored from the build prompt section 4)
2. The HydroSight blueprint / Master Project Prompt (not committed; owner holds it)
3. Stack and phases in `docs/DECISIONS/ADR-001-stack.md`
4. Your own judgement. Deviations need an ADR in `docs/DECISIONS/`.

## Non-negotiable rules
- Never fabricate accuracy, lead times, validation, partners, APIs, datasets, prices or licences. Mark `UNVERIFIED` and log in `docs/OPEN_QUESTIONS.md`.
- Every value has one `source_type`: measured | estimated | forecast | community | synthetic. Shown as a badge in the UI.
- Everything is `unvalidated` until a human admin promotes it with an evidence link. Never promote anything yourself.
- No public warning without human approval. Drafter and approver must differ.
- Offline/stale/failed things are shown explicitly. Never show a last-known value as live.
- Tenant isolation via row-level security (`org_id`), with cross-tenant tests.
- No secrets in git. No real SMS/email in tests. No universal flood thresholds.
- Modular monolith. No Kubernetes/Kafka/microservices without a measured need and an ADR.

## Layout
- `apps/web` Next.js (App Router, strict TS, Tailwind v4). `services/api` FastAPI (uv). `db/migrations` SQL. `docs/` project docs.

## Commands
- Install: `pnpm install` and `cd services/api && uv sync`
- Web: `pnpm dev:web`, `pnpm check:web` (lint + typecheck + tests)
- API: `cd services/api && uv run uvicorn hydrosight_api.main:app --reload`, `pnpm check:api` (DB tests need Postgres: locally `uv run --python 3.12 pytest` uses pgserver; CI uses `TEST_DATABASE_URL`)
- All checks: `pnpm check`
- Full stack: `cp .env.example .env && docker compose up --build`

## Workflow
Plan (<=15 lines) -> build small -> test -> actually run it -> report -> STOP and wait for the owner's "proceed" before the next phase.
Keep `docs/PROGRESS.md`, `docs/TRACEABILITY.md`, `docs/COSTS.md` and this file current.

Alert governance is enforced in the database (migration 0006); never add a path that lets an engine or app role approve/publish, and never ship default thresholds. Notifications stay dry-run until a provider is verified.
Raw readings are immutable (trigger); calibration is applied at read time; QC limits are customer-supplied, never defaulted; interpolated values are `estimated` and never drive status or alerts.
Community reports are always `community` + `unvalidated` until a moderator validates with evidence; no IP or device data is stored; photos must have no EXIF; safe places need a second person to publish.
Predictions are `forecast`/`synthetic` and `unvalidated`, immutable, with an input snapshot; the event threshold always comes from an approved documented rule; learned models train only on owner-confirmed real data; synthetic backtests never support a skill claim or promotion; no extent/depth/impact outputs.
Assets: elevation, waterway distance and hazard intersection come only from supplied or loaded data with source and licence, else "not assessed" (never "safe"); values need amount, currency and basis, and no loss is estimated; no return periods; every export is logged with a hash and screen and exports share one Report object.

Assistant: read-only tools run as the signed-in person; answers use Observed / Forecast / Assumptions / Not known with citations that must exist; it never issues warnings, evacuation advice or "safe" statements; community text is untrusted; off by default with a token cap per organisation; every turn is logged.

Plans: no price, plan name or limit is ever invented; plans are published by the platform owner and a price needs amount, currency, interval and basis. Limits and feature gates are enforced in the database (missing limit = 0, NULL = unlimited, no plan = unmanaged). Invoices are typed in, never calculated; issued ones are immutable. No payment provider is connected and no payment claim is made until one is verified. Platform roles see only demo requests, plans, assignments, invoices and organisation names.

## Current state
See `docs/PROGRESS.md`.
