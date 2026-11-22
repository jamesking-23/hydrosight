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

## Phase 5
- Duplicate distance (200 m), time window (60 min), rate caps (120 anonymous / 30 signed-in per hour), 14-day offline window and photo limits are UNVERIFIED defaults; tune with real usage.
- Anonymous endpoint has only a database-side hourly cap per organisation; there is no per-IP rate limit or bot protection. Add before a public launch (provider choice is yours).
- Photos are stored in the database (1 MB max each). Supabase free storage is small; move to object storage if volume grows. Retention and deletion policy for reports and photos is not decided.
- Consent wording (`community-report-2026-11`) is my draft and needs legal review for Uganda's data protection law before launch.
- Luganda and Kiswahili need a human translator; the app currently falls back to English and says so.
- Alert preferences: SMS and push are off (notifications are dry-run), so the settings screen only says that. Nothing is subscribed.
- The web project has Vercel Authentication on, so ordinary community members cannot open `/community` until you turn it off or add a custom domain.
- The PWA install, service worker, camera capture, geolocation and offline sync have been tested only in code and unit tests, not on a real phone.
- `reports.read` and `community.moderate` role mapping is still the DRAFT matrix; who moderates in each organisation is your decision.

## Phase 6: real datasets needed (no model skill can be claimed without them)
Everything measured so far is synthetic. To produce a real backtest the owner must supply, and confirm as real:
1. **Historical water levels** for each station: hourly or finer, at least several flood seasons, with gauge datum and any rating or calibration notes. Sources to approach: Directorate of Water Resources Management (Ministry of Water and Environment), district water offices, university or NGO gauges. Access NOT assumed.
2. **Rainfall records** matching the same period: station gauges (Uganda National Meteorological Authority) or satellite estimates (CHIRPS, IMERG; licences UNVERIFIED).
3. **Flood-event records**: dates, locations, peak levels, with an evidence reference (district disaster reports, Uganda Red Cross, news with date). Enter them with `record_flood_event`.
4. **Impact reports**: needed only before any impact target is attempted.
- Which water level counts as an event at each station must be set by the owner with local hydrologists; the backtest requires it to be stated with a written basis.
- Baseline settings (rate-of-rise lookback, antecedent decay and window, bins, warning probability) are untuned placeholders chosen for fixtures.
- What score thresholds distinguish unvalidated, validated and operational is for the owner and local experts to set. None is invented.
- Prediction jobs are not scheduled. Decide the schedule once a real, approved threshold rule exists for a station.
- No learned model exists; gradient boosting waits for confirmed real data and the extra dependency (not on Vercel).
- Backtests currently score one station at a time with a single temporal hold-out; spatial hold-out needs several stations with real data.
- The forecast screen has not been viewed with live sign-in. The engine has been tested against the CI database, not run against the hosted database (no connection string available to this session).

## Phase 7
- No river geometry has been imported, so distance to waterways reads "not assessed". Needs a licensed river network (source and licence recorded on import).
- No hazard layers are loaded. Each needs its source, licence and scenario label. There is no screen for loading zones yet; use `add_hazard_zone` (permission `hazard.manage`) until one is built.
- No elevation dataset (DEM) is integrated; elevation is user-supplied with a measured/estimated label. Choose a DEM and check its licence before integrating.
- Asset values are only what customers supply, with a written basis. No damage curves exist or are proposed.
- Return-period estimation is deliberately absent. Decide with local hydrologists whether and how (record length, method) before adding it.
- Report wording, templates and branding for customers are drafts.
- The analytics and assets screens and the three download formats have not been seen with a live sign-in; database functions are tested in CI only.
- Reference material supplied by the owner (FastFlood, OpenLISEM papers): see DATA_SOURCES. Their speed and accuracy figures are the authors' claims on their own tests; none is a HydroSight claim. FastFlood commercial-use terms are UNVERIFIED (the site lists free, educational and paid tiers; no licence text was found).

## Phase 8
- The assistant has NOT been run against the live Claude API: no API key was available. The adapter follows the public Messages API shape and is tested only with a fake. It needs `ANTHROPIC_API_KEY` and `ASSISTANT_MODEL` (no default model is assumed; choose one you have access to) set as Vercel environment variables. UNVERIFIED.
- The Claude API is a paid service; there is no free equivalent that meets the brief. Limits are in tokens so no price is assumed. Decide a monthly budget before switching it on for any organisation.
- Numbers and names inside an answer's sentences are not mechanically checked against the cited records; only the citations are. Until that is added, treat answers as a reading aid and check the cited records. Candidate: require structured values per item and render them from the records.
- The advice filter is deliberately blunt and may refuse harmless sentences that mention evacuation. Tune with real questions.
- Free text of community reports reaches the assistant only for roles that may moderate. Whether other roles should see it is a policy decision.
- The daily cap is checked before a question, so one question can overshoot it. Prompt-injection defences have been tested with scripted models only, not with a real model.
- The assistant does not answer questions that need spatial reasoning beyond the stored exposure indicators (for example "communities downstream of River X"); no such data layer exists.
- Questions are logged in full. Confirm the notice to users and a retention period with a data-protection review.
