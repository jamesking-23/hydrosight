# ADR-011: Public site, plans, entitlements and invoices

Status: accepted (Phase 9). Owner review pending.

## Decision
- **No invented commercial facts.** No plan names, prices or limits ship. The platform owner creates plans in `/platform`; plans start unpublished; a price needs amount, currency, interval and a written basis. The public Plans page shows only published plans and otherwise says plans are being finalised.
- **Entitlements live in the database.** Limits (locations, sensors, users) and features are plan data. A missing limit row means 0; NULL means unlimited, set on purpose. Limits are enforced by triggers on insert, so no screen or API path can skip them. Feature gates: `assets` (trigger) and `assistant` (`assistant_begin`, reason `not_in_plan`); the web app also explains blocks on the analytics, forecasts, assets and assistant screens. An unreadable entitlement never blocks a screen; the database is the authority.
- **Unmanaged organisations are not gated.** An organisation with no plan assignment (pilots, demos, existing organisations) has no limits; this is stated on its Billing page. An assigned plan that is suspended, ended or past its end date blocks creating new stations, sensors, users and assets; it never deletes or hides existing data.
- **Usage is counted live**, not stored as history.
- **Invoices are typed in.** HydroSight calculates no price or tax. Drafts can be voided; an issued invoice cannot change; deletion is refused; `paid` needs a method and a reference; numbers are `HS-YYYY-000001` from a sequence.
- **Payments:** an adapter interface with no live provider (see `docs/PAYMENTS_RESEARCH.md`). The UI says online payment is not available.
- **Platform roles** (`super_admin`, `platform_admin`) gain access only to demo requests, plans, plan assignments, invoices and the organisation name list (`platform_orgs`). They get no access to organisation data.
- **Demo intake** is a public database function with consent required, one row per email per day, an hourly overall cap, a hidden honeypot field, and no IP or device data. Owner email notification is **not** sent (no verified email provider): requests wait in the `/platform` inbox and the form says so.
- Public copy lives in `lib/site-content.ts` with a test that blocks percentages, guarantees, accuracy and lead-time claims, prices, customer or partner names, and the word prototype.

## Alternatives considered
- Seeding example plans and prices: rejected (invented prices).
- Checking limits only in the web app: rejected (bypassable by any other client).
- Calculating tax and totals: rejected (tax rules unverified).
- Choosing a payment provider now: rejected (requirements unverified).

## Consequences
The owner must supply plans, a platform membership row for themselves, legal-entity details and an email provider before the commercial side is usable. The DB tests for 0012 and 0013 run in CI only.
