# ADR-002: Identity, tenancy, RBAC and audit (Phase 1)

Status: accepted. Date: 2026-11-19.

## Decision
- **Authentication** is Supabase Auth. The database only reads `auth.uid()` / `auth.jwt()`.
- **Tenancy**: every tenant table carries `org_id`; row-level security is enabled on all 10 tables. Permission checks live in the database (`private.has_permission`), so isolation does not depend on application code.
- **RBAC as data**: `roles`, `permissions`, `role_permissions`. A user may hold several roles in one organisation.
- **MFA**: roles flagged `requires_mfa` grant nothing unless the session JWT has `aal = 'aal2'`. A trigger guarantees any role holding a privileged permission requires MFA.
- **Secrets** (invitation tokens, API keys) are stored only as SHA-256 hashes; plaintext is returned once. Hash columns are not selectable by app roles. Built-in `sha256()` is used, so no pgcrypto dependency.
- **API keys** cannot carry privileged scopes (approve/publish/manage/audit) and cannot exceed the creator's permissions.
- **Audit**: append-only `audit_log` written only by triggers (UPDATE/DELETE/TRUNCATE raise, even for superusers); no FK on `org_id` so records outlive an organisation; secret hashes are stripped; `last_used_at` is excluded so key verification does not flood it.
- **Last org_admin guard**: an organisation can never lose its last active org_admin.
- **Platform roles** (super_admin, platform_admin) have no RLS access in Phase 1; they act only via the service role.
- **Tests** run against real PostgreSQL (CI service container; locally `pgserver`), switching identity with `SET ROLE` + `request.jwt.claims`, with a stub of Supabase's `auth` schema and its broad default grants (so the tests prove the migration revokes them).

## Consequences / caveats
- **The FastAPI API currently connects as a bypass-RLS database role.** Before any tenant-data endpoint exists, the API must use a non-bypass role and set the per-request identity, or RLS protects nothing on that path. Tracked in OPEN_QUESTIONS.
- Deleting a user who is the last org_admin is blocked by the guard; offboarding needs a defined procedure.
- Local pgserver lacks PostGIS/pgcrypto; the test bootstrap strips only those CREATE EXTENSION lines. CI uses the PostGIS image and applies them unmodified.
- The advisor flags the five `authenticated`-callable SECURITY DEFINER functions. They are intended entry points; each checks permission internally.
