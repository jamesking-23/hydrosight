# IoT specification for hardware and firmware partners

Status: **specification for discussion.** The HTTP interface below is built and tested. MQTT and LoRaWAN are **not built** (see ADR-004). Nothing here names or assumes a particular hardware partner, sensor model or network operator; those choices are open (UNVERIFIED) and are the owner's.

## 1. What a device must do
Measure on a fixed interval, keep a monotonic per-sensor sequence number, store readings locally when the link is down, and upload batches. Never edit or drop a reading to "tidy" it; HydroSight keeps raw values immutable and applies calibration and quality checks on its side.

## 2. HTTP interface (built)
`POST {API}/v1/ingest/readings` with headers `Content-Type: application/json` and `X-API-Key: <device key>`.
```json
{
  "sent_at": "2026-11-24T08:00:03Z",
  "battery_pct": 81.5,
  "signal_dbm": -71,
  "firmware": "1.4.2",
  "readings": [
    {"sensor_id": "<uuid>", "observed_at": "2026-11-24T07:55:00Z", "value": 2.314, "sequence": 1042}
  ]
}
```
- `readings`: 1 to 1,000 items per request. Unknown top-level fields are refused. Each item is judged separately: accepted, duplicate, or rejected with a reason; one bad item never blocks the rest.
- `sensor_id` values are issued when the device is provisioned (the key is shown once). A key can write only its own device's sensors.
- Same sensor and time with the same value is a duplicate (safe to resend); with a different value it is rejected and never overwrites.
- Responses: `200` with per-item results; `401` unknown or revoked key; `403` key lacks scope or sensor belongs to another device; `422` malformed; `429` rate limit (retry after the `Retry-After` seconds); `500` unexpected database response (retry with backoff; report if it persists); `503` database unavailable or not configured (retry with backoff).
- Rate limit: currently 120 requests per minute per key and 3,000 overall (untuned operational settings). A device reporting every few minutes is far below this.
- Time: send `sent_at` (the device clock at upload). The server compares it with its own clock; skew over 60 s is corrected and the original kept; a batch more than 30 days out is refused. Devices should still sync their clock (NTP or GNSS) and report in UTC.
- Units: the sensor's unit is fixed at registration; send the value in that unit. Do not apply calibration on the device; record offsets/scales in HydroSight (calibration is applied at read time and is append-only).
- Offline buffering: keep unsent readings (with their original `observed_at` and `sequence`) and send them when the link returns, oldest first. Gaps stay visible as gaps; HydroSight does not fill them silently.
- Health: `battery_pct`, `signal_dbm` and `firmware` feed the device status view (offline when no contact for 3x the expected interval; degraded for low battery, weak signal, clock skew over 300 s). Those health thresholds are defaults and **unvalidated**.

## 3. MQTT (design only, not built)
Needs an always-on broker and a subscriber on a host that allows long-lived processes. Proposed when a fleet requires it: TLS 1.2+, one client identity per device, topic `hydrosight/v1/{device_id}/readings`, the same JSON body as section 2, QoS 1 with at-least-once delivery (duplicates are already idempotent), a bridge process that calls the same database ingest function, and its own ADR before building. Broker choice and hosting cost are open.

## 4. LoRaWAN (design only, not built)
Constrained payloads need a compact binary format and a network-server integration (for example a webhook from the network server to a small adapter that expands the payload into the section 2 body). The operator or network server, regional parameters and payload codec are **not chosen**. Each uplink should carry a sequence number and a time or a counter the adapter can map to time; uplinks without a trustworthy time must be marked as server-received time, never as observed time.

## 5. Device credentials
- One key per device; shown once at provisioning; stored hashed by HydroSight; rotate and revoke from the device screen (`devices.manage`).
- Store the key in protected non-volatile memory (secure element or locked flash if the hardware has it). Never place keys in firmware images shared across devices or in source control.
- Provision keys at manufacture or first commissioning over a trusted channel; a stolen device is dealt with by revoking its key.

## 6. Firmware practices (to agree with the partner)
- Signed firmware images and a verified boot or at least a verified update; refuse unsigned or older versions (rollback protection).
- Over-the-air update with automatic rollback to the last good image if the new one fails its self-test; update only when battery is adequate.
- Report `firmware` on every upload so the fleet's versions are visible.
- No secrets in debug output; debug ports disabled in production units.
- Watchdog and brown-out handling so a fault never produces frozen or garbage values presented as readings.
- TLS certificate validation on (pin or trust a defined CA); never disable verification to "make it work".
- Document sensor installation: datum, mounting height, calibration date, and who is responsible, in HydroSight's device and calibration records.

## 7. Acceptance test for a new device type
Use the simulator (`python -m hydrosight_api.simulator`) as the reference client. A device is ready for a pilot only when, against a demo organisation, it has: delivered readings for a week; recovered from a power cut and a network outage with no lost or duplicated readings; shown a correct clock; been revoked and re-keyed; and appeared in the device status view with truthful health. Record the results; do not state accuracy figures that were not measured.

## 8. Open decisions for the owner
Hardware partner and sensor models; communication path (cellular, LoRaWAN, other); power and enclosure; who installs, who calibrates, who maintains; spare and replacement process; cost per site.
