# ADR-012: Phase 10 hardening decisions

Status: accepted (2026-11-24). Owner may overrule.

## Context
Phase 10 asks for a security review, measured performance, a timed restore drill, accessibility checks and pilot-readiness documents, without adding paid services or new infrastructure.

## Decisions
1. **Rate limiting in the database.** Fixed-window counters in an unlogged table, called by the API before work (`public.rate_hit`, migration 0014). One bucket per hashed API key and one overall. Reason: the modular monolith has no cache or gateway and the owner wants no new services. Alternatives (in-memory per process, Redis, an edge gateway) were rejected: they fail across instances or add a service. Trade-offs: one extra small write per request; fixed windows allow a short burst at a window edge. Fails open if the counter is unreadable, so a fault cannot silence real sensors.
2. **Security headers without a script CSP.** Next.js inline scripts would need nonces; a half-working script CSP is worse than none. Frame, base, object and form restrictions are set. A nonce-based script CSP is an open item.
3. **Restore neutralises default privileges.** A naive restore re-granted broad rights to anon (434 grants vs 3). The restore script revokes defaults, restores, then re-applies them, and the drill compares grant counts.
4. **Dependency override.** `uuid >= 11.1.1` forced through pnpm to clear an advisory via exceljs; xlsx output and tests re-verified.
5. **Contrast tokens darkened** for the measured and estimated source badges to pass WCAG AA.
6. **No new paid service.** Drills and tests run on a local Postgres; free uptime checks and hosted backup drills are left to the owner.

## Consequences
Rate-limit values are untuned and need real traffic. The restore drill proves the procedure on a scratch server only. See `docs/PILOT_READINESS.md` for acknowledged gaps.
