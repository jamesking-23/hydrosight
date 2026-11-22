# ADR-009: Analytics, asset exposure and reports

Status: accepted (Phase 7). Owner review pending.

## Decision
- Analytics are SQL functions run as the caller (SECURITY INVOKER), so row-level security decides what is visible. Only stored readings are summarised; quality counts, completeness and excluded estimated readings are always shown. No gaps are filled.
- No return periods or frequency curves are estimated. Annual maxima are shown as recorded.
- Assets (point or polygon) keep elevation only if supplied, with a measured/estimated label. Waterway distance and hazard intersection use only imported river geometry and loaded hazard zones that carry source and licence. A missing layer reads "not assessed"; outside a loaded zone never reads "safe".
- Financial value exists only with amount, currency and a written basis. The portfolio figure is the supplied value inside loaded zones, labelled an assumption. No damage curve, no loss estimate.
- One Report object feeds the screen and the CSV, XLSX and PDF exports, so they cannot drift. Each states data window, sources, maturity label and assumptions.
- Exports are logged (SHA-256, who, window) in an append-only table. If the log write fails the file is not delivered.
- CSV cells that could run as formulas are prefixed; XLSX cells are text.

## Alternatives considered
- Integrating a DEM and river network now: rejected; no verified licensed source yet.
- A fast hazard model such as FastFlood (owner reference): not adopted in this phase. Its published speed and accuracy are the authors' own results; it would need licence confirmation, local validation, and the rule against extent/depth outputs revisited by the owner (ADR needed).

## Consequences
Indicators will mostly read "not assessed" until data is loaded. That is intended.
