# ADR-006: Devices, quality control, calibration, gaps, health and realtime

Status: accepted (2026-11-21). Migration `0007_devices_qc_calibration_health.sql`.

## Context
Phase 3 shipped ingestion and freshness. The build prompt also requires a device registry with per-device credentials, sequence/battery/signal/clock-skew handling, a QC pipeline that never overwrites raw data, calibration, gap handling, device health, realtime updates and a fleet test.

## Decisions
1. **Raw readings are immutable.** A trigger (`private.readings_guard`) allows only `quality` and `qc_at` to change. Corrections happen elsewhere.
2. **Calibration is applied at read time.** `calibrations` is append-only (scale, offset, effective_from, mandatory note). `public.calibrated_value()` is used by views and the alert engine; the raw value is always kept and shown (`last_raw_value`).
3. **QC never invents limits.** Limits (min/max, max rate per hour, flatline run length, cross-sensor difference) live in `sensor_qc_config` and are supplied by the customer. No config means readings stay `unchecked` (but are marked processed). `good` means "passed the checks that were configured", nothing more.
4. **Flags, not edits.** Each failed check writes a `reading_flags` row (range=bad; spike, flatline, duplicate_sequence, cross_sensor=suspect; stale, sequence_gap, sequence_reset, interpolated=info).
5. **The engine evaluates `suspect` readings.** Only `bad` and `estimated` readings are ignored. A QC flag must never silently suppress a possible real flash flood; the alert evidence carries raw value and quality so the human reviewer sees the doubt.
6. **Missing stays missing.** `sensor_gaps` reports gaps. Interpolation is an explicit action by a user with `devices.manage`, never offered for rainfall, at most 12 intervals, stored as `estimated` with an `interpolated` flag, and estimates never count for freshness, status or alerts.
7. **Device identity.** Devices have their own keys (`api_keys.device_id`); the key is shown once, stored hashed, rotatable, revoked on retirement. A device key can only write its own sensors. `provision_device`, rotation and retirement need `devices.manage` (not grantable to API keys).
8. **Clock skew.** `/v1/ingest/readings` computes skew = server now minus `sent_at`. Over 60 s timestamps are corrected and the original is kept in `device_observed_at`; over 30 days the batch is refused. Delayed uploads are flagged `delayed`, never presented as live.
9. **Device health** (`device_status` view): offline = no contact within expected interval x 3; degraded for low battery, weak signal, clock skew over 300 s, recent quality flags. The numbers are defaults per device row and are UNVERIFIED heuristics.
10. **Realtime.** `readings`, `device_health`, `alerts` are added to the `supabase_realtime` publication (guarded). The web app refreshes on events and shows when the live link is down. Live behaviour is UNVERIFIED.
11. **Simulator.** Synthetic only; it refuses organisations not flagged `is_demo`.

## Consequences
Sequence numbers are defined per sensor. Offline devices do not raise alerts yet. Load figures are database-side only (see PROGRESS).
