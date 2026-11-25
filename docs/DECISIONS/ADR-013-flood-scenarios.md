# ADR-013: Flood Scenarios module (modelled extent, depth, velocity, arrival)

Status: accepted by the owner on 2026-11-25 (James approved lifting the "no extent/depth/impact outputs" rule for a separate module, with the limits below). Supersedes the "no extent/depth" clause in ADR-009 and HS-PRD-007 for this module only.

## Context
HydroSight monitors, forecasts levels and manages warnings, but cannot show where water could go. The owner wants a rapid scenario tool in the style of FastFlood: simulate flood hazard for an area, test rainfall what-ifs, and sketch mitigation. FastFlood's own commercial terms, pricing and limits are UNVERIFIED (API docs state none; copyright FastHazard B.V.; the 2023 paper's abstract calls the platform open-source but gives no licence or code repository). The method is published (van den Bout et al. 2023, Environ. Model. Softw. 168:105787; CC BY).

## Decision
1. Build our own solver from the published method, running in the browser (web worker). No FastFlood code, service or branding is used. Optional API adapter only after terms are verified (new ADR).
2. The module is separate ("Flood Scenarios"). Its outputs **never** feed alerts, station status, predictions, exports of warnings, the assistant's "forecast" section, or any public message. Existing governance is unchanged.
3. Every layer and export carries: "Modelled scenario. Unvalidated. Not a forecast or warning." Source type is `synthetic` (hypothetical inputs). No accuracy, lead-time or skill claim is made. Limits are shown on the page: no dam breaks or surges (no momentum), weak on backwater, no storm drains or culverts unless supplied, coarse terrain.
4. Rainfall intensity and duration are always typed in by the person. No defaults, no return periods, no loss or impact estimates.
5. Terrain, land cover and soil come only from datasets loaded with source, licence and date. Areas without loaded data show "not assessed", never "safe".
6. Validation: results may be compared with flood events recorded by the owner (`record_flood_event`, with evidence). Until at least one owner-confirmed event is compared, the page says "not validated". Synthetic comparisons never support a claim.
7. Datasets for the Kabale pilot (see `docs/DATA_SOURCES.md`): Copernicus DEM GLO-30 (free; attribution and no-liability notice required); ESA WorldCover (licence to verify at download); SoilGrids (licence to verify at download). FABDEM is excluded: its commercial use needs a paid licence.

## Consequences
- New CLAUDE.md rule block for the module. Tests must prove the solver on cases with known answers and that scenario output cannot reach alerts.
- Browser compute limits area size; large areas need a server worker (future ADR, may cost money).
- The solver is simplified; it will be wrong in places. The labels and limits are part of the product, not optional.
