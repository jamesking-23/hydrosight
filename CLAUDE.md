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

## Current state
See `docs/PROGRESS.md`.
