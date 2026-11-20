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
