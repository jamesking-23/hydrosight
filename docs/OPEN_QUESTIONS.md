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
