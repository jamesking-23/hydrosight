import { describe, expect, it } from "vitest";
import {
  boundsOf,
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
