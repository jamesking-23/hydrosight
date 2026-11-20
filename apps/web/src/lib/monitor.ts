import { classifyFreshness, type Freshness } from "@/lib/stations";

// Pure helpers for the live monitor and Dashboard v1. They mirror the database views so a page left
// open keeps ageing (rule 6: never show a last-known value as live).

export type DeviceState = "online" | "degraded" | "offline";

export interface DeviceRow {
  device_id: string;
  org_id: string;
  station_id: string | null;
  name: string;
  expected_interval_s: number;
  offline_multiple: number;
  last_seen_at: string | null;
  battery_pct: number | null;
  signal_dbm: number | null;
  last_clock_skew_s: number | null;
  status: DeviceState;
  reasons: string[] | null;
}

export interface SensorStatusRow {
  sensor_id: string;
  org_id: string;
  station_id: string;
  kind: string;
  unit: string;
  expected_interval_s: number;
  source_type: "measured" | "estimated" | "forecast" | "community" | "synthetic";
  last_observed_at: string | null;
  last_value: number | null;
  last_raw_value: number | null;
  last_quality: string | null;
  calibrated: boolean;
}

export const DEVICE_LABEL: Record<DeviceState, string> = {
  online: "Online",
  degraded: "Degraded",
  offline: "Offline",
};

export const REASON_LABEL: Record<string, string> = {
  never_reported: "Has never reported",
  low_battery: "Low battery",
  weak_signal: "Weak signal",
  clock_skew: "Device clock is wrong",
  recent_quality_flags: "Recent readings failed quality checks",
};

export function reasonLabel(r: string): string {
  if (r.startsWith("no_contact_within_")) {
    const n = r.replace("no_contact_within_", "").replace("x_interval", "");
    return `No contact for more than ${n} expected intervals`;
  }
  return REASON_LABEL[r] ?? r;
}

/** Offline is recomputed from the clock so an open page cannot keep showing "online". */
export function liveDeviceState(d: DeviceRow, now: number): DeviceState {
  if (!d.last_seen_at) return "offline";
  const ageS = (now - Date.parse(d.last_seen_at)) / 1000;
  if (ageS > d.expected_interval_s * d.offline_multiple) return "offline";
  return d.status === "offline" ? "offline" : d.status;
}

export function summariseDevices(rows: DeviceRow[], now: number): Record<DeviceState, number> {
  const out: Record<DeviceState, number> = { online: 0, degraded: 0, offline: 0 };
  for (const d of rows) out[liveDeviceState(d, now)] += 1;
  return out;
}

export function summariseSensors(rows: SensorStatusRow[], now: number): Record<Freshness, number> {
  const out: Record<Freshness, number> = { live: 0, stale: 0, offline: 0, never_reported: 0 };
  for (const s of rows) out[classifyFreshness(s.last_observed_at, s.expected_interval_s, now)] += 1;
  return out;
}

export const QUALITY_LABEL: Record<string, string> = {
  unchecked: "Not quality-checked",
  good: "Passed checks",
  suspect: "Suspect",
  bad: "Failed checks",
  missing: "Missing",
};

/** Rainfall completeness: how much of the expected record is present. Gaps are never filled here. */
export function completenessPct(readingCount: number, intervalS: number, hours: number): number {
  const expected = (hours * 3600) / intervalS;
  if (expected <= 0) return 0;
  return Math.min(100, Math.round((readingCount / expected) * 100));
}

export function formatValue(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return "no value";
  return `${Math.round(v * 100) / 100} ${unit}`;
}
