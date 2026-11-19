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
