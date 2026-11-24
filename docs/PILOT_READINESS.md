# Pilot readiness checklist

Status as of Phase 10 (2026-11-24). A pilot means real people could act on what HydroSight shows. Nothing here has been validated against real events. Every gap below is either closed by a named person or acknowledged in writing by the owner before a pilot starts.

Status key: DONE (built and tested), PARTIAL (built, with a stated limit), OPEN (needs a person or a decision), NOT BUILT.

## 1. Platform readiness

| # | Item | Status | Evidence or what is missing |
|---|------|--------|-----------------------------|
| 1.1 | Tenant isolation with cross-tenant tests | DONE | Row-level security on all tenant tables; tests in `services/api/tests`. Per-table coverage was not re-audited in Phase 10 (`SECURITY_REVIEW.md`). |
| 1.2 | Alert governance in the database (drafter differs from approver, MFA, publish permission) | DONE | Migration 0006; ADR-005. |
| 1.3 | Notifications dry-run until a provider is verified | DONE | No SMS or email provider is verified. Real delivery is OPEN. |
| 1.4 | Security review against the build prompt | PARTIAL | `SECURITY_REVIEW.md`. No independent penetration test. |
| 1.5 | Rate limiting on ingest | DONE | Migration 0014; values untuned (120 per key and 3000 overall per minute). |
| 1.6 | Backup and restore drill, timed | PARTIAL | Drill performed on a scratch server: backup 3.4 s, restore 12.1 s, PASS (`DISASTER_RECOVERY.md`). Not yet run from a real hosted backup. Backups are not scheduled. |
| 1.7 | Recovery point and time targets | OPEN | Owner must choose targets. |
| 1.8 | Load test with measured results | PARTIAL | `PERFORMANCE.md`; sandbox figures only, not from the hosted setup under real network conditions. |
| 1.9 | Accessibility audit (WCAG 2.2 AA) | PARTIAL | axe-core on public pages at 1280 px and 375 px. Signed-in screens not audited. No screen reader or keyboard-only session with a person. |
| 1.10 | Monitoring and alerting on the platform itself | NOT BUILT | Only `/health` and `/ready`. Decide on a free uptime checker. |
| 1.11 | Supabase Auth settings (leaked-password protection, email limits) | OPEN | Leaked-password protection is off; owner to review in the dashboard. |
| 1.12 | Secrets rotated | OPEN | The Gemini key and GitHub token were shared in chat. Rotate both. |
| 1.13 | Live assistant call verified | OPEN | Never run against the real Gemini API. |

## 2. Data and models

| # | Item | Status | Note |
|---|------|--------|------|
| 2.1 | Real station and sensor data supplied by a data owner with a licence | OPEN | None loaded. All data in the demo organisation is synthetic. |
| 2.2 | Customer-supplied QC limits per sensor | OPEN | Not defaulted by design. |
| 2.3 | Approved threshold rules per station | OPEN | See section 4. No universal thresholds exist. |
| 2.4 | Any model skill claim | OPEN | None may be made. Backtests on synthetic data never support a claim. Needs real, owner-confirmed history and a documented evaluation. |
| 2.5 | River, catchment, elevation and hazard layers with source and licence | OPEN | Assets show "not assessed" without them. |

## 3. Sensor calibration plan (template to complete with the data owner)

Fill one per station. Nothing in the platform assumes any value.

1. Station, sensor, sensor type, manufacturer, serial number: ______
2. Installation reference level and how it was surveyed (datum, method, surveyor, date): ______
3. Initial calibration: method, reference instrument, date, result, who signed off: ______
4. How a calibration is entered: `/devices`, per sensor, append-only; raw readings are never changed and calibration is applied when read.
5. Calibration interval and the trigger for an early check (for example after a flood, after maintenance, after drift is suspected): ______ (set by the data owner)
6. QC limits (physical minimum, maximum, maximum rate of change): ______ (set by the data owner; unset limits leave readings `unchecked`)
7. Maintenance visit log: who, when, what changed, whether the sensor was re-levelled.
8. Spot-check routine: a manual staff-gauge reading compared with the sensor, how often, and the tolerance that triggers a review: ______
9. What happens when a sensor is faulty: it is shown as offline or flagged; interpolated values are `estimated` and never drive status or alerts.
10. Spare units, power and communications arrangement: see `IOT_SPEC.md`.

## 4. Threshold-setting workshop with local authorities (agenda and outputs)

Purpose: agree, for each station, the water level or rate-of-rise that should trigger a draft alert, and who decides. HydroSight ships no thresholds.

Participants to invite (owner decides names): the local disaster management office, the water authority or hydrologist, the district engineer, representatives of affected communities, the sensor data owner, and HydroSight staff as facilitators.

Before the workshop: collect the station list, any past flood records with dates and observed levels, channel and bank-full levels from survey, and known impacted places. Mark each item `measured`, `estimated` or `community`.

Agenda:
1. What the platform will and will not do (no automatic public warnings; a person approves every one).
2. Review of each station's data quality and gaps.
3. For each station: proposed level(s) and meaning, rationale, evidence (document, survey, past event), and who is accountable for it.
4. How often a rule is reviewed and what changes it.
5. False alarm and missed event tolerance in the group's own words, noted as a judgement, not a measured number.
6. Recording: each rule is entered in `/rules` as a draft with rationale and evidence link; a different person with `thresholds.approve` activates it.

Outputs: signed meeting record; rule drafts entered; list of stations where no rule could be agreed (those get no alerts).

## 5. Warning-approval procedure (derived from what the platform enforces)

Enforced by the database, not by policy alone:
- A person drafts or adopts an alert. A different person approves it. The same person cannot do both.
- Approval and publishing require the matching permission and a multi-factor sign-in.
- An alert from the engine is only a draft; the engine and the app role cannot approve or publish.
- Every step is recorded in the audit trail.

To be agreed in writing by the pilot partner (owner and partner complete):
1. Named drafters, approvers and publishers, with at least two approvers so one is always reachable: ______
2. Maximum time from draft to decision during an event, and who is called if nobody responds: ______
3. Channels used to reach people and who is responsible for each (HydroSight sends nothing live until a provider is verified): ______
4. How a warning is withdrawn or updated, and who may do so: ______
5. Language and wording templates approved by the authority, including Luganda and Kiswahili text, which is currently empty: ______
6. After-event review: who, when, what is recorded.

HydroSight does not issue warnings, evacuation advice or "safe" statements on its own, and the assistant is barred from doing so.

## 6. Data-protection review

See `DATA_PROTECTION.md` for the inventory and gaps. Needed before a pilot:
- Legal review against the Uganda Data Protection and Privacy Act, 2019 and registration requirements: OPEN (not assessed by Claude).
- Approved consent text and privacy notice for the demo form and community reports: OPEN (drafts exist).
- Retention periods for demo requests, reports, assistant turns, audit logs: OPEN.
- Process for access and deletion requests: NOT BUILT as tooling; manual steps in the runbook.
- Data processing terms with Supabase, Vercel and Google (Gemini): OPEN. Free-tier terms may allow provider use of content, so demo data only until reviewed.

## 7. IoT specification

`IOT_SPEC.md` defines the HTTP ingest contract as built, credential and firmware practice, and an acceptance test using the simulator. Hardware, network and partner choices are OPEN and listed in its section 8.

## 8. Owner acknowledgement

The pilot may start only when each OPEN, PARTIAL or NOT BUILT row above is either closed or listed below with the owner's initials and date.

| Item | Acknowledged gap | Owner initials | Date |
|------|------------------|----------------|------|
|      |                  |                |      |
