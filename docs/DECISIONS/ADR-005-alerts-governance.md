# ADR-005: Alerts, warning governance, CAP export and notifications

Status: accepted (2026-11-20). Owner review of the open points below is requested.

## Decisions
1. **Governance lives in the database.** Constraints, guard triggers and SECURITY DEFINER functions enforce: no active rule without rationale, evidence and a different approver; alerts start as drafts; approved/published need a human approver; a public alert's approver differs from its drafter; approved content is immutable (change = new version). App roles have no direct write on alerts, rules, events or jobs.
2. **The engine only drafts.** `evaluate_thresholds_for()` creates internal drafts with no author. A person "adopts" a draft by editing it; the adopter cannot approve a public alert they adopted. Rules need arming/hysteresis, cooldown, de-duplication, maintenance-window suppression, and skip stale/offline sensors (a last-known value never triggers).
3. **No default thresholds.** Rules are data entered by users with a documented basis.
4. **Notifications default to dry-run.** Live sending needs `NOTIFY_MODE=live`, the organisation set to live, and a verified provider. Provider adapters are placeholders that fail explicitly, because no SMS/email provider has been verified for price, sender-ID rules or licensing. Per-alert and daily caps are visible as suppressed jobs.
5. **CAP 1.2 export** is generated with the standard library and has not been validated against the official XSD (UNVERIFIED). Severity/certainty mappings are my proposal; urgency is always Unknown; no responseType is emitted. Demo organisations export as status Exercise.
6. **Scheduling** uses a GitHub Actions job every 15 minutes (`alert-ops.yml`): expiry, escalation, engine sweep, dry-run dispatch. Ingestion also triggers the engine per accepted sensor, and an engine failure never loses readings.

## Consequences
Hosted Supabase functions are executable by `authenticated` by design (each checks permission, state and approver itself); the security advisor lists them as warnings. The engine, expiry and escalation functions are service-role only.
