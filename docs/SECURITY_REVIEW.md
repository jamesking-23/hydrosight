# Security review (Phase 10)

Reviewed against build prompt section 10 on 2026-11-24. This is an engineering self-review, **not** an independent penetration test or a certification. Status values: DONE (built and tested), PARTIAL (built, with a stated gap), OPEN (not built).

| Requirement | Status | Evidence and gaps |
|---|---|---|
| Managed authentication, MFA for privileged roles, secure cookies | PARTIAL | Supabase Auth; roles that approve or publish need an `aal2` session (database-enforced, tested). Session lifetime and cookie flags are Supabase and Next.js defaults: **not reviewed in the Supabase dashboard**. Leaked-password protection is OFF (advisor warning); owner can enable it in Auth settings. |
| CSRF | PARTIAL | State-changing calls use bearer tokens or Supabase sessions through RPC, not cookie-authenticated form posts to our own routes, except `/api/demo` (public by design, no session effect), `/api/assistant` and the export routes (signed-in cookie session). Same-site cookies and `form-action 'self'` limit cross-site posts; no explicit CSRF token on those routes. |
| TLS everywhere, encryption at rest | DONE (platform) | Vercel and Supabase provide TLS and managed encryption at rest. HSTS header added. Not independently verified by us. |
| Signed upload URLs, file type and size validation | PARTIAL | Community photos pass through the API (re-encoded, EXIF refused by the database, 1 MB cap). There are no signed-URL uploads; photos are stored in the database (bytea). |
| API keys and device credentials hashed, scoped, rotatable, revocable | DONE | Keys are hashed at rest, scoped, rotatable and revocable (Phase 1 and 3b tests). |
| Rate limiting on public and ingestion endpoints | PARTIAL | NEW: ingestion is limited per key and overall by a database counter (migration 0014; verified over HTTP: 429 + `Retry-After`). Demo intake is capped in the database (30 per hour, one per email per day). Community report submission has database dedup and caps (Phase 5). Read-only public endpoints (public alerts feed, plans) and the login pages have **no application-level limit**; rely on Vercel's platform protection (not configured by us) and Supabase Auth's own limits. The ingestion limits (120 per key per minute, 3000 overall) are untuned operational settings. |
| Input validation, parameterised queries, output encoding | DONE | Pydantic models at the API, check constraints in the database, parameterised SQL only (no string-built queries in application code), React escapes output; assistant text is wrapped and filtered. |
| Append-only audit log | DONE | Audit trigger on privileged tables; the log refuses update and delete (tested). |
| Secure firmware and device-credential practices documented | DONE (document) | `docs/IOT_SPEC.md`. No firmware exists to review. |
| Personal data minimised, access-controlled, with retention rules | PARTIAL | Inventory and gaps in `docs/DATA_PROTECTION.md`. Retention periods are **not decided**; no automated deletion job exists. |
| Data Protection and Privacy Act 2019: consent, access and deletion handling | PARTIAL | Consent records exist for community reports and demo requests. Access and deletion are manual procedures (`docs/DATA_PROTECTION.md`). **Legal review is required before any pilot; HydroSight does not claim legal compliance.** |
| Backups with a tested restore; incident response | PARTIAL | Restore drill performed and timed on a scratch server (`docs/DISASTER_RECOVERY.md`). Not yet run against the hosted Supabase database or its provider backups. Incident steps are in `docs/RUNBOOK.md`. |

## Automated checks run
- **Hosted database audit (2026-11-24):** all 52 public tables have row-level security; every SECURITY DEFINER function pins `search_path`; the anonymous role can read only the three published-plan tables and execute only `submit_demo_request`. Supabase advisors report no errors; warnings are the expected signed-in SECURITY DEFINER functions (each checks permissions inside) and leaked-password protection.
- **Dependencies:** `pnpm audit --prod` found one moderate advisory (`uuid` via `exceljs`); fixed with a workspace override to `uuid >= 11.1.1` and the report tests re-run. `pip-audit` on the API found no known vulnerabilities.
- **Security headers added:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS, and a Content-Security-Policy limited to `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`. Verified on a local production build. **A script-src policy is not set** (needs nonces and a browser test of the map and community app); that is open work.
- **Cross-tenant tests:** the full database suite (375 tests) passes against PostgreSQL 16 with PostGIS, including the cross-organisation leakage tests written in Phases 1 to 9 (coverage per table was not audited in this phase).

## Not done
Independent penetration test; dependency monitoring in CI; secret scanning in CI; script-src CSP; login attempt throttling beyond Supabase defaults; review of Supabase Auth settings (session length, MFA enforcement for all roles, email templates); WAF or Vercel firewall rules; authenticated-screen end-to-end tests (Playwright journeys from the build prompt are not built).
