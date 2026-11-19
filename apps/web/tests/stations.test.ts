import { describe, expect, it } from "vitest";
import {
  boundsOf,
  classifyFreshness,
  describeAge,
  forecastTotalMm,
  filterStations,
  geojsonCollection,
  riverNames,
  stationsToGeoJSON,
  type StationRow,
} from "@/lib/stations";

const base = {
  org_id: "o", elevation_m: null, elevation_source_type: null, status: "unvalidated" as const, notes: null,
};
const S: StationRow[] = [
  { ...base, id: "1", code: "DEMO-NILE-01", name: "Nile, Jinja area (demo)", lat: 0.42, lon: 33.2, river_name: "Nile", source_type: "synthetic" },
  { ...base, id: "2", code: "RW-01", name: "Rwizi gauge", lat: -0.61, lon: 30.65, river_name: "Rwizi", source_type: "measured" },
  { ...base, id: "3", code: "X-9", name: "Unnamed site", lat: 1, lon: 32, river_name: null, source_type: "community" },
];
const none = { query: "", sources: new Set<never>(), river: "" };

describe("filterStations", () => {
  it("returns everything with no filters", () => expect(filterStations(S, none)).toHaveLength(3));
  it("searches name, code and river case-insensitively", () => {
    expect(filterStations(S, { ...none, query: "jinja" }).map((s) => s.id)).toEqual(["1"]);
    expect(filterStations(S, { ...none, query: "rw-01" }).map((s) => s.id)).toEqual(["2"]);
    expect(filterStations(S, { ...none, query: "RWIZI" }).map((s) => s.id)).toEqual(["2"]);
    expect(filterStations(S, { ...none, query: "  " })).toHaveLength(3);
  });
  it("filters by source type and river", () => {
    expect(filterStations(S, { ...none, sources: new Set(["synthetic" as const]) }).map((s) => s.id)).toEqual(["1"]);
    expect(filterStations(S, { ...none, river: "Rwizi" }).map((s) => s.id)).toEqual(["2"]);
  });
  it("combines filters", () => {
    expect(filterStations(S, { query: "nile", sources: new Set(["measured" as const]), river: "" })).toEqual([]);
  });
});

describe("geo helpers", () => {
  it("builds lon/lat ordered GeoJSON and drops invalid coordinates", () => {
    const bad: StationRow = { ...base, id: "bad", code: "b", name: "b", lat: Number.NaN, lon: 1, river_name: null, source_type: "measured" };
    const fc = stationsToGeoJSON([...S, bad]);
    expect(fc.features).toHaveLength(3);
    expect(fc.features[0]?.geometry.coordinates).toEqual([33.2, 0.42]);
    expect(fc.features[0]?.properties?.source_type).toBe("synthetic");
  });
  it("lists distinct river names and computes bounds", () => {
    expect(riverNames(S)).toEqual(["Nile", "Rwizi"]);
    expect(boundsOf(S)).toEqual([30.65, -0.61, 33.2, 1]);
    expect(boundsOf([])).toBeNull();
  });
  it("wraps imported geometry as features", () => {
    const fc = geojsonCollection([{ id: "r", name: "Test", geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }]);
    expect(fc.features[0]?.properties).toEqual({ name: "Test" });
  });
});

describe("freshness (rule 6: never show a last-known value as live)", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  it("classifies by the sensor's expected interval", () => {
    expect(classifyFreshness(null, 900, now)).toBe("never_reported");
    expect(classifyFreshness("garbage", 900, now)).toBe("never_reported");
    expect(classifyFreshness(ago(60), 900, now)).toBe("live");
    expect(classifyFreshness(ago(1800), 900, now)).toBe("live");
    expect(classifyFreshness(ago(1801), 900, now)).toBe("stale");
    expect(classifyFreshness(ago(9000), 900, now)).toBe("stale");
    expect(classifyFreshness(ago(9001), 900, now)).toBe("offline");
  });
  it("describes age in plain words", () => {
    expect(describeAge(ago(30), now)).toBe("just now");
    expect(describeAge(ago(600), now)).toBe("10 min ago");
    expect(describeAge(ago(3 * 3600), now)).toBe("3 h ago");
    expect(describeAge(ago(5 * 86400), now)).toBe("5 days ago");
  });
});

describe("forecastTotalMm", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const row = (h: number, value: number) => ({
    valid_at: new Date(now + h * 3600e3).toISOString(), value, issued_at: "x", model: "m", provider_licence: "l",
  });
  it("sums the next hours only and returns null when none", () => {
    expect(forecastTotalMm([], now, 24)).toBeNull();
    expect(forecastTotalMm([row(1, 0.4), row(2, 1.1), row(30, 9)], now, 24)).toBe(1.5);
    expect(forecastTotalMm([row(-5, 3)], now, 24)).toBeNull();
  });
});
