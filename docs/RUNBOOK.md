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

## Sending readings (Phase 3)
1. As an org admin (with MFA), create an API key with scope `readings.write` on the organisation page. Copy it once; it is never shown again.
2. `curl -X POST $API/v1/readings -H "X-API-Key: hsk_..." -H "Content-Type: application/json" -d '{"readings":[{"sensor_id":"<uuid>","observed_at":"2026-11-20T09:00:00Z","value":1.42}]}'`
3. The answer lists each item as accepted, duplicate or rejected with a reason. HTTP 401 = bad/expired/revoked key, 403 = missing scope, 422 = bad batch size, 503 = database unreachable (nothing stored).
4. The station panel on `/map` shows the sensor as Live until two expected intervals pass without a new reading.

## Forecast job
Set GitHub secret `DATABASE_URL` and variable `FORECAST_USER_AGENT` (real contact email). Run manually from Actions > Forecast ingestion > Run workflow. Locally: `cd services/api && FORECAST_USER_AGENT=... DATABASE_URL=... uv run python -m hydrosight_api.forecast_met --dry-run`.

## Alerts, rules and notifications (Phase 4)
- Rules: sign in as a user with `thresholds.draft`, open `/rules`, draft with rationale and evidence; a different user with `thresholds.approve` activates it.
- Alerts: automatic drafts appear in `/alerts`. A person edits (adopts), submits, a different approver approves, someone with `warnings.publish` publishes.
- Scheduled job: add GitHub secret `DATABASE_URL` (the same database URL the API uses); `alert-ops.yml` then runs every 15 minutes. Without it the job skips and says so.
- Manual run: `cd services/api && uv run python -m hydrosight_api.alert_ops`.
- Notifications stay in dry-run unless `NOTIFY_MODE=live` AND the organisation row in `notification_settings` is `live` AND a provider is verified. Do not enable live until providers are verified.
- Public CAP feed: `/v1/cap/alerts` (list) and `/v1/cap/alerts/{id}.xml`.
