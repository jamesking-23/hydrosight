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
