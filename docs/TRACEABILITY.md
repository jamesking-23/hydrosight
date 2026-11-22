# Requirement traceability

Requirement IDs follow the blueprint scheme (`HS-<AREA>-NNN`). IDs not present in the blueprint were created in the same scheme.

| ID | Requirement | Code | Tests |
|---|---|---|---|
| HS-UI-001 | Every displayed value carries a source-type badge (measured/estimated/forecast/community/synthetic) | `apps/web/src/components/source-badge.tsx` | `apps/web/tests/source-badge.test.tsx` |
| HS-UI-002 | Records default to `unvalidated` and say so wherever shown | `apps/web/src/components/maturity-banner.tsx` | `apps/web/tests/source-badge.test.tsx` |
| HS-I18N-001 | en/lg/sw message keys present; untranslated text falls back and is flagged | `apps/web/src/lib/i18n.ts`, `apps/web/src/messages/` | `apps/web/tests/i18n.test.ts` |
| HS-OPS-001 | `/health` and `/ready` on web and API; readiness reports failures explicitly | `apps/web/src/app/{health,ready}`, `services/api/src/hydrosight_api/main.py` | `services/api/tests/test_health.py` |
| HS-DB-001 | Shared enums for source_type, quality_flag, service_status, alert_level, alert_status | `db/migrations/0001_foundations.sql` | (migration applied in Phase 1 RLS tests) |
| HS-TEN-001 | A user in org A cannot read or write org B data; anonymous has no table access (RLS on every table) | `db/migrations/0002_identity_tenancy_rbac_audit.sql` | `services/api/tests/test_tenant_isolation.py` |
| HS-IAM-001 | Roles holding privileged permissions need MFA (JWT `aal2`); invariant trigger-enforced | `0002` (`private.has_permission`, `enforce_mfa_for_privileged`) | `services/api/tests/test_mfa_and_roles.py` |
| HS-IAM-002 | Roles and permissions are data, not code (13 roles, 18 permissions; matrix is DRAFT) | `0002` | `services/api/tests/test_mfa_and_roles.py` |
| HS-IAM-003 | Invitations: hashed, single-use, expiring, email-bound, revocable | `0002` (`create/accept/revoke_invitation`) | `services/api/tests/test_invitations.py` |
| HS-IAM-004 | API keys: hashed, never privileged, never exceed creator, expiring, revocable | `0002` (`create/revoke/verify_api_key`) | `services/api/tests/test_api_keys.py` |
| HS-AUD-001 | Append-only audit log of privileged changes; outlives organisations; last org_admin protected | `0002` (`audit_row_change`, `audit_log_immutable`, `guard_last_org_admin`) | `services/api/tests/test_audit.py` |
| HS-UI-003 | Sign-in, TOTP MFA gate, invitation acceptance, member/invitation/API-key admin screens; secrets shown once; no open redirects | `apps/web/src/{proxy.ts,lib/access.ts,components/,app/}` | `apps/web/tests/access.test.ts` (logic only; live flow UNVERIFIED) |
| HS-GEO-001 | Rivers, catchments, locations, stations, sensors with PostGIS geometry and GiST indexes | `db/migrations/0003_hydrography_stations_sensors.sql` | `services/api/tests/test_stations.py` (EXPLAIN GiST test; runs in CI) |
| HS-GEO-002 | Stations/locations/sensors tenant-isolated; demo org readable by signed-in users, never writable | `0003` | `test_stations.py` |
| HS-GEO-003 | `status` and `source_type` not writable by app roles (no self-promotion) | `0003` column grants | `test_stations.py` |
| HS-GEO-004 | Import pipeline requires CRS, source and licence; records file hash; skips bad features and counts them | `services/api/src/hydrosight_api/geoimport.py` | `services/api/tests/test_geoimport.py` |
| HS-GEO-005 | Map with layer toggles, filters, search, station panel, source badges, attribution, explicit tile failure | `apps/web/src/components/station-map.tsx`, `app/map/page.tsx` | `apps/web/tests/stations.test.ts` (logic only; rendering checked by hand) |
| HS-ING-001 | Readings enter only via API key with `readings.write`; per-item results; idempotent; conflicts never overwrite | `0005` `ingest_readings`, `services/api/src/hydrosight_api/ingest.py` | `tests/test_readings.py`, `tests/test_ingest_api.py` |
| HS-ING-002 | Readings inherit the sensor's source type; quality starts unchecked; no universal thresholds | `0005` | `tests/test_readings.py` |
| HS-ING-003 | Freshness (live/stale/offline/never reported) from expected interval; stale never shown as live | `0005` `sensor_status`, `apps/web/src/lib/stations.ts` | `tests/test_readings.py`, `apps/web/tests/stations.test.ts` |
| HS-ING-004 | Cross-tenant: keys, readings and forecasts isolated; no direct writes by app roles | `0005` RLS and grants | `tests/test_readings.py` |
| HS-ING-005 | Forecasts typed `forecast`, carry model and licence, latest run wins; MET Norway adapter fails loudly | `0005`, `forecast_met.py`, `.github/workflows/forecast.yml` | `tests/test_readings.py`, `tests/test_forecast_met.py` (fixture hand-written; live UNVERIFIED) |
| HS-ALT-001 | Rule cannot be active without rationale, evidence and a different approver; active rules immutable | `0006` constraint `rule_active_needs_documented_basis`, `rules_guard` | `tests/test_alerts.py` |
| HS-ALT-002 | Engine creates internal drafts only; cannot approve or publish; hysteresis, cooldown, dedup, maintenance, stale skip | `0006` `evaluate_thresholds_for` | `tests/test_alerts.py` |
| HS-ALT-003 | No public warning without human approval; drafter differs from approver (constraint, trigger, function) | `0006` | `tests/test_alerts.py` |
| HS-ALT-004 | Required alert content before review; approved content immutable, changes are new versions | `0006` `submit_alert`, `alerts_guard`, `new_alert_version` | `tests/test_alerts.py` |
| HS-ALT-005 | Append-only alert history; acknowledgement, escalation, false-alarm tagging, expiry | `0006` | `tests/test_alerts.py` |
| HS-ALT-006 | Conflicting alerts shown together, official first | `0006` `alerts_active_ranked`, `/alerts` | `tests/test_alerts.py`, `apps/web/tests/alerts.test.ts` |
| HS-ALT-007 | Notifications consented, capped, dry-run by default, never for unpublished/internal alerts | `0006`, `notifications.py` | `tests/test_alerts.py`, `tests/test_notifications.py` |
| HS-ALT-008 | CAP 1.2 only for published public alerts; demo exports as Exercise (XSD validation UNVERIFIED) | `cap.py`, `alerts_public.py` | `tests/test_cap.py` |
| HS-ALT-009 | Alert and rule tables tenant-isolated; no direct writes by app roles | `0006` RLS and grants | `tests/test_alerts.py` |
| HS-ING-006 | Device registry; per-device keys shown once, hashed, rotatable, revoked on retire; device key limited to its sensors | `0007` `provision_device`, `rotate_device_key`, `retire_device` | `tests/test_devices_qc.py` |
| HS-ING-007 | `/v1/ingest/readings` with sequence, battery, signal; org keys refused | `ingest.py`, `0007` `ingest_device_batch` | `tests/test_devices_qc.py`, `tests/test_ingest_api.py` |
| HS-ING-008 | Clock skew corrected over 60 s, original kept, over 30 days refused; delayed uploads flagged | `0007` | `tests/test_devices_qc.py` |
| HS-ING-009 | Raw readings immutable; only quality may change | `0007` `readings_guard` | `tests/test_devices_qc.py` |
| HS-ING-010 | QC checks (range, spike, flatline, duplicate, cross-sensor, stale, sequence); no config means unchecked | `0007` `run_qc` | `tests/test_devices_qc.py` |
| HS-ING-011 | Calibration append-only, applied at read time, raw retained, used by engine | `0007` `calibrations`, `calibrated_value` | `tests/test_devices_qc.py` |
| HS-ING-012 | Missing data stays missing; interpolation explicit, stored as estimated, never rainfall, never drives status or alerts | `0007` `sensor_gaps`, `interpolate_gap` | `tests/test_devices_qc.py` |
| HS-ING-013 | Device health online/degraded/offline with reasons | `0007` `device_status` | `tests/test_devices_qc.py` |
| HS-ING-014 | Engine evaluates suspect, ignores bad and estimated | `0007` `evaluate_thresholds_for` | `tests/test_devices_qc.py`, `tests/test_alerts.py` |
| HS-ING-015 | Device tables tenant-isolated, no direct writes | `0007` RLS and grants | `tests/test_devices_qc.py` |
| HS-ING-016 | 50-device fleet with injected faults detected; latency measured | `simulator.py` | `tests/test_fleet_sim.py` |
| HS-COM-001 | Community reports always `community` + `unvalidated`; submitter cannot set status or source | `0008` | `tests/test_community.py`, `tests/test_community_api.py` |
| HS-COM-002 | Anonymous reports store no user id; consent recorded | `0008` | `tests/test_community.py` |
| HS-COM-003 | Public submit is service-role only; org must open reports; rate cap | `0008`, `community.py` | `tests/test_community.py` |
| HS-COM-004 | Submitted content immutable; moderation fields only via function | `0008` guard | `tests/test_community.py` |
| HS-COM-005 | Idempotent by client id; old offline reports keep observed time | `0008` | `tests/test_community.py`, `tests/community.test.ts` |
| HS-COM-006 | Duplicate grouping by proximity and time, nothing dropped | `0008` | `tests/test_community.py` |
| HS-COM-007 | Photo EXIF stripped (client, API, database refusal); photos moderator-only | `photo.ts`, `community.py`, `0008` | `tests/test_community_api.py`, `tests/test_community.py` |
| HS-COM-008 | Moderation needs evidence, not own report, append-only history | `0008` | `tests/test_community.py` |
| HS-COM-009 | Tenant isolation for reports, photos, queue, map, resources | `0008` RLS | `tests/test_community.py` |
| HS-COM-010 | Alert confirm/dispute: feedback only, public published alerts only | `0008` | `tests/test_community.py` |
| HS-COM-011 | Report form validation | `community.ts` | `tests/community.test.ts` |
| HS-COM-012 | Offline queue: order, retry, failed kept, safe resend | `community.ts` | `tests/community.test.ts` |
| HS-COM-013 | Unverified reports on map with plain trust signals | `station-map.tsx`, `0008` | `tests/community.test.ts`, `tests/test_community.py` |
| HS-COM-014 | Safe places need a second person and evidence to publish | `0008` | `tests/test_community.py` |
| HS-PRD-001 | Verification scores correct (POD, FAR, CSI, Brier, reliability, lead time); undefined is null | `metrics.py` | `tests/test_forecasting.py` |
| HS-PRD-002 | Model never sees data after the issue time; fit stops at train_end | `series.py`, `harness.py` | `tests/test_forecasting.py` |
| HS-PRD-003 | Backtest refuses missing threshold basis, bad split, short hold-out | `harness.py` | `tests/test_forecasting.py` |
| HS-PRD-004 | Four baselines run; synthetic input marks the run synthetic with a fixed note | `baselines.py`, `harness.py` | `tests/test_forecasting.py` |
| HS-PRD-005 | ML training refused on synthetic or unconfirmed data | `ml_gate.py`, `0009` | `tests/test_forecasting.py`, `tests/test_prediction_engine.py` |
| HS-PRD-006 | External adapters need a recorded licence check | `external.py` | `tests/test_forecasting.py` |
| HS-PRD-007 | Predictions are forecast/synthetic, unvalidated, with input snapshot; no extent/depth/impact | `0009` | `tests/test_prediction_engine.py` |
| HS-PRD-008 | Predictions and backtests immutable; only the engine role appends | `0009` | `tests/test_prediction_engine.py` |
| HS-PRD-009 | Promotion: human, not registrant, evidence, real data and real backtest, in order | `0009` | `tests/test_prediction_engine.py` |
| HS-PRD-010 | Status and identity of a model cannot be edited directly | `0009` guard | `tests/test_prediction_engine.py` |
| HS-PRD-011 | Backtest rows internally consistent; synthetic flag follows data origin | `0009` | `tests/test_prediction_engine.py` |
| HS-PRD-012 | Tenant isolation for models, predictions, backtests, flood events | `0009` RLS | `tests/test_prediction_engine.py` |
| HS-PRD-013 | Flood events need evidence and honest origin | `0009` | `tests/test_prediction_engine.py` |
| HS-PRD-014 | Engine needs an approved documented threshold; skips stale input; ignores bad readings | `engine.py` | `tests/test_prediction_engine.py` |
| HS-PRD-015 | Forecast screen: no false precision, undefined shown as not defined, ages out | `forecast.ts`, `forecast-view.tsx` | `tests/forecast.test.ts` |
| HS-ANA-001 | Analytics only summarise stored readings; poor/estimated readings are counted and excluded from statistics; completeness shown | `0010` `analytics_station` | `tests/test_analytics_assets.py` |
| HS-ANA-002 | No return periods are estimated; annual maxima labelled as such | `report.ts` | `tests/report.test.ts` |
| HS-ANA-003 | Forecast verification needs an explicit warning probability; synthetic is flagged | `0010` `prediction_verification` | `tests/test_analytics_assets.py` |
| HS-AST-001 | Asset registry (point/polygon), validated geometry, tenant isolation | `0010` | `tests/test_analytics_assets.py` |
| HS-AST-002 | Elevation, waterway and hazard indicators say "not assessed" when no data exists; outside a loaded zone is never "safe" | `0010` `asset_exposure` | `tests/test_analytics_assets.py`, `tests/report.test.ts` |
| HS-AST-003 | Value only with amount, currency and written basis; exposure reports supplied value, no loss estimate | `0010`, `asset-input.ts` | `tests/test_analytics_assets.py`, `tests/asset-input.test.ts` |
| HS-RPT-001 | CSV, XLSX and PDF are rendered from the same Report object as the screen; each states window, sources, maturity, assumptions | `report.ts`, `report-format.ts` | `tests/report.test.ts` |
| HS-RPT-002 | CSV-injection guard; XLSX cells are text, never formulas | `report-format.ts` | `tests/report.test.ts` |
| HS-RPT-003 | Every export is logged with SHA-256 (append-only); an unlogged export is not delivered | `0010` `report_exports`, `api/reports/[kind]/route.ts` | `tests/test_analytics_assets.py` |
| HS-AI-001 | Assistant is off until an org admin switches it on and sets a daily token cap; no default cap | `0011` `assistant_begin` | `tests/test_assistant.py` |
| HS-AI-002 | Per-organisation daily cap blocks further questions; per-question budget shrinks to what is left | `0011`, `engine.ts` | `tests/test_assistant.py`, `tests/assistant.test.ts` |
| HS-AI-003 | Every prompt, tool call and token count is logged, append-only; users see own turns, admins all, nobody cross-tenant | `0011` `assistant_turns` | `tests/test_assistant.py` |
| HS-AI-004 | Tools are read-only and run as the signed-in person (RLS applies); organisation fixed by the server; ids validated | `tools.ts`, `supabase-data.ts` | `tests/assistant.test.ts` |
| HS-AI-005 | Answers are Observed / Forecast / Assumptions / Not known; every citation must be a record a tool returned this turn; times come from the records | `answer.ts` | `tests/assistant.test.ts` |
| HS-AI-006 | Stale, offline or missing data is stated; empty tool results lead to "not known", not a guess | `answer.ts`, `tools.ts` | `tests/assistant.test.ts` |
| HS-AI-007 | No warnings, evacuation advice or safety claims; no tool can create, approve or publish alerts | `answer.ts`, `tools.ts` | `tests/assistant.test.ts` |
| HS-AI-008 | Community text is sanitised, wrapped, flagged and logged; an obeying model is still stopped by the validator | `untrusted.ts`, `answer.ts` | `tests/assistant.test.ts` |
