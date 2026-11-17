# Requirement traceability

Requirement IDs follow the blueprint scheme (`HS-<AREA>-NNN`). IDs not present in the blueprint were created in the same scheme.

| ID | Requirement | Code | Tests |
|---|---|---|---|
| HS-UI-001 | Every displayed value carries a source-type badge (measured/estimated/forecast/community/synthetic) | `apps/web/src/components/source-badge.tsx` | `apps/web/tests/source-badge.test.tsx` |
| HS-UI-002 | Maturity banner shows PROTOTYPE by default | `apps/web/src/components/maturity-banner.tsx` | `apps/web/tests/source-badge.test.tsx` |
| HS-I18N-001 | en/lg/sw message keys present; untranslated text falls back and is flagged | `apps/web/src/lib/i18n.ts`, `apps/web/src/messages/` | `apps/web/tests/i18n.test.ts` |
| HS-OPS-001 | `/health` and `/ready` on web and API; readiness reports failures explicitly | `apps/web/src/app/{health,ready}`, `services/api/src/hydrosight_api/main.py` | `services/api/tests/test_health.py` |
| HS-DB-001 | Shared enums for source_type, quality_flag, service_status, alert_level, alert_status | `db/migrations/0001_foundations.sql` | (migration applied in Phase 1 RLS tests) |
