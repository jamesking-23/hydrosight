# Open questions and unverified items

Anything unknown is listed here rather than assumed.

## Needs the owner's input
- Pilot location(s) and which river(s)/catchment(s).
- Do any real datasets exist today? (historical water levels, rainfall records, flood-event records, impact reports). Until confirmed, **only synthetic data** is used, and it is never used to claim model skill.
- Who would approve public warnings during a pilot (organisation / role)?
- Hosting and monthly budget (default assumption: Vercel + Supabase free/low tiers + one small container host).
- Existing accounts: domain, Supabase project, SMS provider.
- Language priority after English (default: Luganda, then Swahili). Translations need a human translator; keys exist but values are empty.

## UNVERIFIED (must be checked before use)
- Data licences and commercial-use terms for: Open-Meteo, Copernicus DEM / NASADEM, CHIRPS, NASA GPM IMERG, OpenStreetMap-derived layers. See `DATA_SOURCES.md`.
- SMS provider pricing, sender-ID rules and Uganda Communications Commission (UCC) requirements.
- Database hosting region closest to East Africa for the chosen provider.
- Next.js tooling support for TypeScript 7.x.

## Legal
- Uganda Data Protection and Privacy Act, 2019: **legal review required before any pilot.** This project does not claim legal compliance.

## Real datasets needed for any model work
Historical river stage/discharge, rain-gauge records, flood-event records with dates/extents, impact reports. How to obtain: via the owner's contacts at the relevant authorities. Access is **not assumed**.

## Identity, tenancy and RBAC (Phase 1a)
- **The role -> permission matrix in `0002` is a DRAFT.** It needs review by the owner / a domain expert (who may approve and publish warnings, what emergency officers and enterprise customers may see). UNVERIFIED.
- Confirm Supabase Auth "Confirm email" is ON; invitation acceptance relies on a verified email matching the invitation.
- Custom per-organisation roles are not supported yet (roles are global).
- How platform admins should access tenant data (support access) is undecided; today it is service role only.
- An API key keeps working if its creator later loses permissions; decide whether keys should be revoked or re-validated on role change.
- Offboarding: the last-org_admin guard blocks deleting such a user; a procedure is needed.
- The FastAPI service connects as a bypass-RLS role; a non-bypass role plus per-request identity is required before tenant endpoints (see ADR-002).
- Transaction pooler (Vercel) limits session features; re-test per-request `set_config`/`SET LOCAL` patterns against it.
- Web project is behind Vercel Authentication: invitees outside the owner's Vercel team cannot reach it. Decide when to open it (and whether to use a custom domain).
- Invitation email delivery is not implemented (needs an email provider choice; tests must never send real email).
- Password policy / sign-up abuse protection (captcha, rate limits) not reviewed; Supabase defaults apply.

## Geography and map (Phase 2)
- **Demo stations are visible to every signed-in user** (demo org policy). Owner to confirm that is acceptable.
- OSM roads, health facilities and schools layers NOT built: need a licensed extract (ODbL, attribution) and a place to host tiles/data. UNVERIFIED.
- DEM elevation sampling NOT built: Copernicus DEM / NASADEM access and licence NOT verified. Station `elevation_m` stays empty until sampled with a stated source.
- No real river or catchment geometry yet. Source and licence must be chosen (e.g. national or HydroSHEDS-type datasets; none verified). The import tool refuses files without a stated licence.
- OSM public tile servers have a usage policy that may not allow production traffic; choose a tile provider before public launch. UNVERIFIED.
- Promotion of `status` (unvalidated to higher) needs a database function with an evidence link and a different approver; not built, so nothing can be promoted.
- Demo station coordinates are hand-placed approximations, not surveyed.
- Supabase hosted PostGIS is 3.3.7; CI image may differ. Re-check spatial tests if behaviour diverges.

## Ingestion and forecasts (Phase 3)
- **To switch on forecasts the owner must set** GitHub secret `DATABASE_URL` (Supabase connection string) and variable `FORECAST_USER_AGENT` (for example `HydroSight/1.0 (contact: your-real-email)`). MET Norway requires real contact details; I did not invent any.
- The API service needs `DATABASE_URL` in its Vercel environment before `/v1/readings` can store anything (`/ready` shows 503 until then). Use the connection pooler string.
- No rate limiting on `/v1/readings` yet (serverless is stateless). Options: Vercel firewall rules or a database-side per-key counter. Decide before onboarding customers.
- Readings are one plain table. Partitioning and retention (for example monthly partitions, rollups) are needed before large fleets.
- 30-day cutoff for late data and 2x/10x freshness multipliers are my defaults, not validated against real telemetry. Review per device type.
- No admin UI to register stations or sensors, or to create the first API key for a device. Currently SQL/API only.
- MET Norway: confirm their Locationforecast FAQ on request caching/If-Modified-Since and add conditional requests if call volume grows. Live response shape UNVERIFIED from the build environment.
- Satellite rainfall (CHIRPS, NASA GPM IMERG) not integrated; licences and access not yet verified.
- Quality control beyond plausibility flags (spike, flatline, cross-station checks) is not built, so every reading stays `unchecked`.
- Demo stations have no readings (shown honestly as "No data received"). A clearly labelled synthetic data generator for sales demos is possible if wanted.

## Phase 4
- CAP output is not validated against the official CAP 1.2 XSD. Validate before any partner consumes the feed.
- CAP sender identifier uses placeholder domain `hydrosight.example` (setting `cap_sender_domain`). Needs a real domain and, for official use, the authority's registered identifier.
- Severity and certainty mapping (advisory to Minor, watch to Moderate, warning to Severe, severe warning to Extreme; confidence to certainty; urgency Unknown) is my proposal. Needs review by the issuing authority.
- SMS provider not chosen. Africa's Talking pricing, sender-ID registration and Uganda Communications Commission rules are UNVERIFIED. Email and Web Push providers also unchosen. Adapters fail explicitly until verified.
- Luganda and Swahili alert text needs human translation and review; English is used as the fallback.
- Escalation has no recipients yet (it raises the level and records an event). Cancellation notices to subscribers are not sent.
- Area polygons or circles are not exported to CAP (no verified geometry for alert areas).
- Public CAP feed has no rate limiting yet.
- No platform-admin tool to put an organisation into live notification mode.
- GitHub Actions minutes for the 15-minute `alert-ops` job are UNVERIFIED against the owner's plan.
- Thresholds: none are shipped. Each customer must supply and document their own.

## Phase 3b
- QC limits are customer-supplied per sensor; none are shipped. Until set, readings stay `unchecked`.
- Device health defaults (20 % battery, -100 dBm, offline after 3x interval, clock skew 300 s) are UNVERIFIED heuristics; confirm against real hardware.
- Sequence numbers are per sensor by my definition. Confirm what real loggers send before first deployment.
- Drift detection is not built (the simulator injects drift; no check flags it yet). Cross-sensor limits need real co-located sensors.
- Offline devices do not raise alerts yet (a device going silent during a storm is visible on the monitor only).
- Supabase Realtime behaviour with real sessions is UNVERIFIED.
- Latency figures are database-side only: no HTTP, network or pooler. Not an SLA.
- Simulator works only in demo organisations by design.
