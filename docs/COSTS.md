# Running costs

Phase 0 has no paid services. Local development only (Docker, Postgres/PostGIS container).

| Service | Purpose | Cost | Verified? |
|---|---|---|---|
| GitHub (repo, Actions) | Source + CI | Free tier assumed | UNVERIFIED |
| Vercel (team `kkingg`): web + API projects | Hosting | Plan/price of this team NOT checked | UNVERIFIED |
| Supabase (org `trial-ERA`) | Database | Free-plan project limit is 2 (confirmed by the error message); price of paid tier NOT checked | UNVERIFIED |

Entries are added, with a verified source for each price, as services are introduced.

## Phase 3
- MET Norway forecasts: free. GitHub Actions scheduled job: free within the included minutes (about 8 short runs a day). No new paid service added.
- Supabase free plan storage: readings grow with fleet size; revisit before the first real device fleet.

## Phase 4
- No new paid service. `alert-ops` GitHub job runs every 15 minutes (about 96 short runs a day); minutes included in the plan are UNVERIFIED.
- SMS/email/push: not enabled. Real sending will add per-message costs once a provider is chosen and its prices verified.

## Phase 3b
- No new paid service. Supabase Realtime usage and limits on the owner's plan are UNVERIFIED. Readings storage grows with fleet size (50 devices at 15 min = about 4,800 rows a day).
- CI gained one short latency step (seconds).

## Phase 5
- No new paid service. Photos add database storage (max 1 MB each, usually under 350 KB). Supabase free plan limits are UNVERIFIED for your project; check before real use.
- Pillow (open source) added to the API.

## Phase 6
- No new paid service and no new runtime dependency (the harness uses the Python standard library). A learned model would add scikit-learn or similar, outside Vercel.
- Storage: one prediction row per model per station per run. At 4 models, hourly, that is about 35,000 small rows a year per station: monitor against the Supabase free plan before scheduling.

## Phase 7
- Two new open-source web dependencies: exceljs (Excel) and pdf-lib (PDF). No paid service. Reports are built on the web server on request.
- Storage: assets, hazard zones and the export log are small. Hazard polygons can be large; simplify before loading and watch the Supabase free-plan size.
