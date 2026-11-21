# ADR-007: Community intelligence (reports, photos, moderation, PWA)

Status: accepted (2026-11-21). Migration `0008_community_reports.sql`.

## Decisions
1. **Community data is never authoritative.** Reports are always `source_type = community` (table check) and start `unvalidated`. Only `moderate_community_report` can validate, needs an evidence reference and a note, and never for the moderator's own report. History is append-only. A validated report is still labelled community on the map.
2. **Privacy by construction.** No IP address or device string is stored by the database or the API code. Anonymous reports store no user id (check constraint). Consent version and time are stored on every report. Signed-in reporters can withdraw their own report until a moderator validates it; anonymous reports cannot be removed later and the consent text says so.
3. **Photos.** The phone shrinks and re-encodes the photo (drops EXIF); the API re-encodes again with Pillow (orientation applied, fresh image, size capped, decompression-bomb guard); the database refuses any file that still contains an EXIF block. Stored as bytea in `report_photos` (max 1 MB), visible only to moderators. Object storage is the later option if volume grows (see OPEN_QUESTIONS).
4. **Offline-first.** The report is always written to IndexedDB first with a client-generated id; `(org_id, client_id)` is unique so a retry never duplicates. `observed_at` keeps when the person saw it (up to 14 days back). The queue retries on network or server trouble and keeps refused reports visible as failed.
5. **Duplicates are grouped, never dropped.** Same kind within 200 m and 60 minutes joins the earliest report (`duplicate_of`); the map shows one point with a corroboration count.
6. **Trust signals, not a score.** The map shows plain facts (signed in or anonymous, photo, location accuracy, nearby reports, reporter's earlier confirmed reports). No number or "reliable" label is invented.
7. **Public intake** goes through the API (`POST /v1/community/reports`) with the service role only; the database function has a per-hour cap (120 anonymous, 30 per signed-in user per organisation). An organisation must switch on `community_reports_open` (the demo organisation is open). CORS is limited to listed web origins; no credentials.
8. **Alert confirm/dispute** is feedback only, one answer per signed-in user, only on published public alerts, and never changes the alert.
9. **Safe places and emergency information** have no defaults. An organisation adds them; a different person must publish each one with an evidence note.
10. **PWA.** Manifest plus a service worker that caches only the app shell, never API, warning or sign-in responses, so stale warnings cannot look current.
11. **Languages.** English complete; Luganda and Kiswahili keys exist but are empty until a human translator supplies them; the UI falls back to English and says so.
