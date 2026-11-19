# ADR-004: Ingestion, freshness and forecast sources

Status: accepted, 2026-11-20

## Decisions
1. **HTTP ingestion first, through one database function.** Devices and partner systems `POST /v1/readings` with `X-API-Key`. The API only transports; `public.ingest_readings()` authenticates the key, enforces the `readings.write` scope (non-privileged, never exceeds the key creator's own rights), tenancy and validation. App roles have no write access to `readings`.
2. **Per-item results, idempotent.** Each item is accepted / duplicate / rejected with a reason. Same (sensor, time) with the same value is a duplicate; with a different value it is rejected and never overwrites.
3. **Provenance cannot be upgraded.** A reading takes its sensor's `source_type`; quality starts `unchecked`. A synthetic sensor can never produce "measured" data.
4. **Plausibility is physical, not hydrological.** Rejected: malformed, unknown sensor (same answer for another tenant's sensor), timestamp more than 5 min ahead, older than 30 days, negative rainfall. Flagged `suspect` but stored: rainfall above 500 mm, temperature outside -60..70. There are no universal flood thresholds; water level is never judged.
5. **Freshness is computed, not stored.** live <= 2x the sensor's expected interval, stale <= 10x, otherwise offline; no readings means "No data received". The UI recomputes it so an open panel keeps ageing, and shows a non-live value only as "last reading, not current".
6. **Forecast source: MET Norway Locationforecast 2.0.** Free, CC BY 4.0, commercial use allowed (per MET Norway's FAQ), needs an identifying User-Agent with contact details, at most 4 coordinate decimals, under 20 requests/s. **Open-Meteo was rejected**: its free API is non-commercial only. Each forecast row stores model and licence; the UI shows attribution.
7. **Scheduling on GitHub Actions** (free) every 3 hours, not Vercel Functions: serverless functions are stateless and time-limited, and Vercel's free plan limits cron frequency. The job refuses to run without its configuration and says so.
8. **MQTT deferred.** It needs an always-on broker and subscriber on a host that allows long-lived processes; no free serverless host provides that reliably. Add it with its own ADR when a device fleet requires it. Until then HTTP covers GSM/Wi-Fi loggers.

## Consequences
Forecast history is kept (unique per issue time) so later validation can compare forecasts with observations. Rate limiting and partitioning are not built; see OPEN_QUESTIONS.
