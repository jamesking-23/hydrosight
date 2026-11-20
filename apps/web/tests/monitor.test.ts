import { describe, expect, it } from "vitest";
import {
  completenessPct, formatValue, liveDeviceState, reasonLabel, summariseDevices, summariseSensors,
  type DeviceRow, type SensorStatusRow,
} from "@/lib/monitor";

const NOW = Date.parse("2026-01-01T12:00:00Z");
const dev = (over: Partial<DeviceRow>): DeviceRow => ({
  device_id: "d", org_id: "o", station_id: null, name: "D", expected_interval_s: 300, offline_multiple: 3,
  last_seen_at: "2026-01-01T11:59:00Z", battery_pct: 80, signal_dbm: -70, last_clock_skew_s: 0,
  status: "online", reasons: [], ...over,
});

describe("liveDeviceState", () => {
  it("keeps a recently seen device online", () => {
    expect(liveDeviceState(dev({}), NOW)).toBe("online");
  });
  it("turns an open page's stale 'online' into offline once the window passes", () => {
    expect(liveDeviceState(dev({ last_seen_at: "2026-01-01T11:40:00Z" }), NOW)).toBe("offline");
  });
  it("never reported is offline and degraded stays degraded", () => {
    expect(liveDeviceState(dev({ last_seen_at: null }), NOW)).toBe("offline");
    expect(liveDeviceState(dev({ status: "degraded" }), NOW)).toBe("degraded");
  });
  it("honours a configured offline multiple", () => {
    expect(liveDeviceState(dev({ offline_multiple: 10, last_seen_at: "2026-01-01T11:40:00Z" }), NOW)).toBe("online");
  });
});

describe("summaries", () => {
  it("counts devices by live state", () => {
    const rows = [dev({}), dev({ status: "degraded" }), dev({ last_seen_at: null })];
    expect(summariseDevices(rows, NOW)).toEqual({ online: 1, degraded: 1, offline: 1 });
  });
  it("counts sensors by freshness", () => {
    const s = (t: string | null): SensorStatusRow => ({
      sensor_id: "s", org_id: "o", station_id: "st", kind: "water_level", unit: "m", expected_interval_s: 300,
      source_type: "synthetic", last_observed_at: t, last_value: 1, last_raw_value: 1, last_quality: "good", calibrated: false,
    });
    const out = summariseSensors([s("2026-01-01T11:58:00Z"), s("2026-01-01T11:30:00Z"), s(null)], NOW);
    expect(out).toEqual({ live: 1, stale: 1, offline: 0, never_reported: 1 });
  });
});

describe("labels and numbers", () => {
  it("explains reasons in plain words", () => {
    expect(reasonLabel("low_battery")).toBe("Low battery");
    expect(reasonLabel("no_contact_within_3x_interval")).toBe("No contact for more than 3 expected intervals");
    expect(reasonLabel("something_new")).toBe("something_new");
  });
  it("computes completeness without exceeding 100 and formats missing values explicitly", () => {
    expect(completenessPct(144, 300, 24)).toBe(50);
    expect(completenessPct(900, 300, 24)).toBe(100);
    expect(formatValue(null, "m")).toBe("no value");
    expect(formatValue(1.23456, "m")).toBe("1.23 m");
  });
});
