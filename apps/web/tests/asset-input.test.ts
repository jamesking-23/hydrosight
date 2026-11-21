import { describe, expect, it } from "vitest";
import { assetArgs, type AssetForm } from "@/lib/asset-input";
import { validateAnalyticsQuery } from "@/lib/report-data";

const base: AssetForm = {
  name: "Kasese clinic",
  kind: "health_facility",
  mode: "point",
  lat: "0.18",
  lon: "30.08",
  geojson: "",
  elevation: "",
  elevationSource: "",
  valueAmount: "",
  valueCurrency: "UGX",
  valueBasis: "",
  notes: "",
};
const ORG = "1c6a2024-6267-4f15-ba14-aab45d9d57e0";

describe("assetArgs", () => {
  it("builds a point as lon,lat and sends no value or elevation when none is given", () => {
    const r = assetArgs(ORG, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.args.p_geojson as string)).toEqual({
        type: "Point",
        coordinates: [30.08, 0.18],
      });
      expect(r.args.p_value_amount).toBeNull();
      expect(r.args.p_elevation_m).toBeNull();
    }
  });
  it("rejects out-of-range coordinates and empty names", () => {
    expect(assetArgs(ORG, { ...base, lat: "95" }).ok).toBe(false);
    expect(assetArgs(ORG, { ...base, lat: "" }).ok).toBe(false);
    expect(assetArgs(ORG, { ...base, name: " " }).ok).toBe(false);
  });
  it("requires a basis for a value and a source for an elevation", () => {
    expect(assetArgs(ORG, { ...base, valueAmount: "1000" }).ok).toBe(false);
    expect(
      assetArgs(ORG, {
        ...base,
        valueAmount: "1000",
        valueBasis: "insurance valuation 2026",
      }).ok,
    ).toBe(true);
    expect(assetArgs(ORG, { ...base, elevation: "1200" }).ok).toBe(false);
    expect(
      assetArgs(ORG, {
        ...base,
        elevation: "1200",
        elevationSource: "measured",
      }).ok,
    ).toBe(true);
  });
  it("rejects invalid GeoJSON text", () => {
    expect(
      assetArgs(ORG, { ...base, mode: "polygon", geojson: "{nope" }).ok,
    ).toBe(false);
  });
});

describe("validateAnalyticsQuery", () => {
  const ok = { station: ORG, from: "2026-01-01", to: "2026-02-01", warn: null };
  it("accepts a valid window", () =>
    expect(validateAnalyticsQuery(ok).ok).toBe(true));
  it("rejects bad stations, reversed or >5y windows and bad probabilities", () => {
    expect(validateAnalyticsQuery({ ...ok, station: "x" }).ok).toBe(false);
    expect(validateAnalyticsQuery({ ...ok, to: "2025-01-01" }).ok).toBe(false);
    expect(validateAnalyticsQuery({ ...ok, to: "2032-01-01" }).ok).toBe(false);
    expect(validateAnalyticsQuery({ ...ok, warn: "0" }).ok).toBe(false);
    expect(validateAnalyticsQuery({ ...ok, warn: "1.5" }).ok).toBe(false);
    expect(validateAnalyticsQuery({ ...ok, warn: "0.5" }).ok).toBe(true);
  });
});
