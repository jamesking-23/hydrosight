# Runbook

Operations guide. Phase 10 sections (incidents, backups, rate limits, load test, accessibility, requests about personal data, key rotation) are at the end.

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

## Devices, QC and simulator (Phase 3b)
- Provision a device: `/devices` (needs `devices.manage` and MFA). The device key is shown once; copy it into the device. Rotate or retire from the same screen.
- Devices post to `POST /v1/ingest/readings` with `Authorization` set to the device key (org keys are refused there).
- Set QC limits and calibrations per sensor (`devices.manage`); with no limits readings stay `unchecked`.
- Simulator (demo organisation only): `cd services/api && uv run python -m hydrosight_api.simulator --help`. Fleet files hold keys and are gitignored (`fleet*.json`).

## Community reports (Phase 5)
- Open an organisation to public reports: an `org_admin` runs `select public.set_community_reports_open('<org id>', true)` (a screen for this is not built yet). Demo organisation is already open.
- Community app: `/community` (installable; Add to Home screen). Moderators use `/moderation` (needs `community.moderate`).
- Web env: `NEXT_PUBLIC_API_URL` (API base). API env: `CORS_ALLOW_ORIGINS` (comma-separated web origins).
- To remove a report on request: signed-in reporters use withdraw; otherwise an admin deletes it in the database and the action is recorded by the database audit trail.

## Forecasts and backtests (Phase 6)
- Register a model: `select public.register_model_version(org, name, version, kind, target)` by a person with `models.manage`. Demo baselines: `db/seed/demo_models.sql`.
- Issue predictions: `DATABASE_URL=... uv run python -m hydrosight_api.forecasting.engine predict 6` (needs an approved threshold rule per station and fresh readings; says why it skipped otherwise). Not scheduled.
- Backtest: `engine.backtest_station(conn, org, station, model_id, horizon_hours=..., warn_probability=..., holdout_fraction=..., run_by=...)`.
- Promotion: `select public.promote_model_version(id, 'validated', '<evidence link>')` by a different person holding `models.promote`; refused for synthetic data.
- Screen: `/forecasts` (needs readings.read or models.read).

## Analytics, assets and reports (Phase 7)
- Screens: `/analytics` (station, window, optional warning probability) and `/assets`. Downloads: `/api/reports/analytics?station=..&from=..&to=..&format=csv|xlsx|pdf` and `/api/reports/assets?org=..&format=..`.
- Register assets on `/assets` (needs `assets.manage`). Load a hazard zone: `select public.add_hazard_zone(org, name, scenario, source, licence, 'estimated', '<GeoJSON polygon>')` (needs `hazard.manage`).
- Every download is logged in `report_exports` (who, what, window, SHA-256). If logging fails the download is refused.
- Rule of thumb for support: an indicator reading "not assessed" means the data layer is missing, not that the asset is safe.

## Data assistant (Phase 8)
- Screen: `/assistant`. Org admins set the on/off switch and daily token cap there (or `select public.set_assistant_limit(org, true, 200000, 4000)`).
- Deployment settings (Vercel, web project): `ASSISTANT_PROVIDER` (`gemini` or `anthropic`), `ASSISTANT_MODEL`, and `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (Sensitive). Without them questions are logged as `not_configured`. Env changes apply to the next deployment.
- Review what was asked and answered: `select created_at, user_id, question, status, refusal_reason, tool_calls, flags from public.assistant_turns order by created_at desc;` (org admins see all turns). `flags.instruction_like_reports > 0` means a community report tried to instruct the assistant.
- A refusal reason `advice_not_permitted` means the draft answer contained a warning, evacuation advice or a safety statement and was withheld.
- Cap resets at 00:00 UTC. To stop the assistant at once, set the switch off.

## Plans, billing and demo requests (Phase 9)
- Public pages: `/about`, `/capabilities`, `/solutions`, `/industries`, `/technology`, `/plans`, `/contact`, `/demo`.
- Make yourself platform staff once (SQL editor, replace the email): `insert into public.platform_memberships (user_id, role_key) select id, 'platform_admin' from auth.users where email = 'you@example.org';`. Then sign in and open `/platform` (it requires sign-in; it is not linked in the header).
- Demo requests: read and mark them in `/platform`. No email is sent when one arrives; check the inbox page. Duplicate emails within a day count once; more than 30 requests in an hour are refused.
- Plans: create in `/platform`. Leave a limit blank to allow none; type `unlimited` to allow any number. Tick Published to show it on `/plans`. Assign to an organisation with a status (trial, active, suspended, ended) and an optional end date.
- To stop an organisation adding records: set its status to `suspended`. Existing data stays. To remove limits entirely, delete its `org_plans` row (it becomes unmanaged).
- Invoices: create a draft (amounts typed in), Issue (assigns `HS-YYYY-NNNNNN`), then Mark paid with a method and reference after you receive money, or Void with a reason. Issued invoices cannot be edited. Customers see issued invoices at `/billing` (org admins only) and can print them.
- Online payment is not available. `PAYMENT_PROVIDER=manual` only changes the wording; no other value does anything.

## Incident response (Phase 10)
1. Confirm: `/ready` on web and API (503 names the failing dependency); Vercel deployments (`list_deployments` or dashboard); Supabase project status.
2. Contain: to stop one organisation adding records, suspend its plan in `/platform`; to stop the assistant, switch it off on `/assistant`; to stop a device, retire its key on `/devices`; to stop all ingest, revoke org keys or pause the API host.
3. Data stale: the UI already shows stale or offline explicitly. Do not tell users data is live. If ingest is down, say so on the status channel agreed with the pilot partner.
4. Wrong or suspect warning: a person with the permission withdraws it in `/alerts`; record why. Warnings are never edited silently.
5. Record: time, what was seen, what was done, who. Review within a week; add a test or a runbook line for each cause.
6. Suspected data exposure: stop the path, preserve logs, tell the owner immediately; notification duties under the data-protection law need legal advice (`DATA_PROTECTION.md`).

## Backup and restore (Phase 10)
Details and measured times: `docs/DISASTER_RECOVERY.md`.
- Backup: `scripts/db-backup.sh` (needs `DATABASE_URL`; writes a custom-format dump of schemas public and private, auth users data, and a sha256 file under `backups/`, which is gitignored). Store dumps encrypted, off the machine.
- Restore: `scripts/db-restore.sh <dump> <target-url>`; it checks the checksum, neutralises default privileges during restore and re-applies them after.
- Drill (scratch server only, never production): `scripts/restore-drill.sh`. It builds a source database, snapshots counts, policies, triggers, functions and grants, backs up, drops, restores, compares and runs behaviour checks. Run it after any migration that changes grants or policies.
- Not yet done: a restore from a real hosted backup, and a schedule.

## Rate limits (Phase 10)
- Ingest only. Settings: `RATE_LIMIT_PER_KEY_PER_MIN` (default 120) and `RATE_LIMIT_GLOBAL_PER_MIN` (default 3000). Over the limit the API answers 429 with `Retry-After: 60` before any work.
- A device sending every minute needs 1 request per minute per batch; size batches accordingly (max 1000 readings per request).
- Counters live in `public.rate_counters` (not readable by app roles); if the counter cannot be read, requests are allowed (fail open) so a fault there cannot silence real sensors.

## Load test and accessibility script (Phase 10)
- Load: `python scripts/load-test.py --help` (needs a fleet file from the simulator; run against a non-production API). Results and limits are in `docs/PERFORMANCE.md`.
- Accessibility: `node scripts/a11y-audit.mjs <base-url>` (axe-core through Playwright, 1280 px and 375 px). Fix any violation before release; signed-in screens still need a manual check.

## Requests about personal data (Phase 10)
No self-service tooling exists yet. For access, correction or deletion requests: confirm identity by the registered email, locate rows using the inventory in `docs/DATA_PROTECTION.md`, tell the owner, act only on the owner's instruction, and record what was done. Community reports are anonymous by design (no IP or device data), so they cannot be matched to a person.

## Key rotation (Phase 10)
- Gemini key: create a new one, update `GEMINI_API_KEY` in Vercel (Sensitive), redeploy, delete the old key.
- GitHub token: revoke in GitHub settings; use SSH or a fine-grained token with minimum scope.
- Device or API keys: rotate or retire in the app; the old key stops working at once.
- Supabase keys: rotate in the dashboard, update Vercel and GitHub secrets, redeploy.
