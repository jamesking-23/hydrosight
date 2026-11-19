# Runbook

Stub. Expanded in Phase 10 (backups, restore drill, incident response).

## Local checks
- `curl localhost:3000/health` and `/ready`; `curl localhost:8000/health` and `/ready`.
- `/ready` returns HTTP 503 with an explicit reason when a dependency is down.

## First sign-in (one-off, owner)
1. Supabase dashboard > Authentication > URL Configuration: set Site URL to the web URL (https://hydrosight-kkingg.vercel.app) and add `https://hydrosight-kkingg.vercel.app/auth/callback` to Redirect URLs.
2. Authentication > Sign In / Providers > Email: make sure "Confirm email" is ON. Check Authentication > Multi-Factor that TOTP is enabled.
3. Open the web URL (log in to Vercel first), go to /signup, create an account with your real email, click the confirmation email.
4. Ask Claude to create your organisation: it runs `select public.admin_create_organization(name, slug, your_email)` and gives you a one-time invitation link.
5. Open the link, sign in with the same email, accept; you will be sent to /mfa to enrol an authenticator app, then /org/<id>.

## Importing river or catchment geometry (Phase 2)
Only with a file whose licence you have checked. Needs the geo group: `cd services/api && uv sync --group geo`.
`DATABASE_URL=... uv run --group geo python -m hydrosight_api.geoimport rivers FILE --name-field NAME --source "Where it came from" --licence "Licence name" --source-type measured [--layer L] [--assume-crs EPSG:4326] [--dry-run]`
Use `--dry-run` first. Same command with `catchments`. The map shows `rivers_geo` once rows exist (map layer for river lines is not yet drawn).
The web build copies the MapLibre worker automatically (`apps/web/scripts/copy-maplibre-worker.mjs`).
