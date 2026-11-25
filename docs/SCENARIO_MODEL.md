# Flood Scenarios: model description

Module: `/scenarios`. Code: `apps/web/src/lib/scenario/`, `apps/web/src/components/scenario-app.tsx`. Decision: ADR-013.
Every output carries the label "Modelled scenario. Unvalidated. Not a forecast or warning." and source type `synthetic`. Nothing here feeds alerts, status, predictions or public messages.

## What it does
Runs in the browser on a terrain grid (a loaded GeoTIFF or the built-in synthetic demo terrain) with rainfall, duration, infiltration and Manning n typed in by the user (no defaults). Outputs water depth, flow speed, time to peak flow and peak discharge per cell. The user can sketch a raised barrier or a lowered channel or basin and compare against the unedited terrain.

## Method (our own implementation; FastFlood's code and service were not used)
1. Fill terrain depressions (priority flood, epsilon 1e-5) so every cell drains.
2. D8 steepest-descent receivers. Slope per cell is averaged over up to 5 cells downstream and floored at the user-set minimum slope. Cells where water leaves the grid take the slope of their main inflow.
3. Steady-state discharge: net runoff (rain minus infiltration) accumulated downstream.
4. Travel time (time of concentration) from wide-sheet Manning velocity; partial steady state: Q_peak = Q_steady x min(1, duration / Tc).
5. Sheet depth h = (Q n / (dx sqrt(S)))^0.6. Cells with upstream area at or above the user-set channel threshold solve a stage on a perpendicular cross-section by bisection, so water spreads sideways; the section stops at cells lower than the channel bed and at the set half-width.

## Tests
`apps/web/tests/scenario.test.ts`, `scenario-data.test.ts`: analytic plane and V-valley checks, water balance, partial steady state, mutation-checked Manning exponent, GeoTIFF loading, edits, a plausibility bound on the demo terrain, and an isolation test (no other module imports the scenario code).

## Limits (also shown on the page)
No momentum, backwater, drains or culverts. Filled pits are not shown as ponds. Edge cells are unreliable. Results depend on terrain resolution. Uniform Manning n and infiltration (land cover and soil rasters not built). No accuracy claim: no owner-confirmed event has been compared yet. A validation screen is not built.

## Data
See `docs/DATA_SOURCES.md` (Copernicus GLO-30 allowed; FABDEM excluded). The owner must upload terrain files; this sandbox cannot download them.
