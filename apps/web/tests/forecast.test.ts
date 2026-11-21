import { describe, expect, it } from "vitest";
import {
  bandPosition,
  formatLead,
  formatProbability,
  formatScore,
  latestPerModel,
  predictionCurrency,
  type PredictionRow,
} from "@/lib/forecast";

const row = (o: Partial<PredictionRow>): PredictionRow => ({
  id: "1",
  org_id: "o",
  station_id: "s",
  model_version_id: "m",
  target: "flood_occurrence",
  issued_at: "2026-11-21T10:00:00Z",
  valid_from: "2026-11-21T10:00:00Z",
  valid_to: "2026-11-21T16:00:00Z",
  horizon_hours: 6,
  probability: 0.4,
  p10: 1,
  p50: 2,
  p90: 3,
  unit: "m",
  source_type: "synthetic",
  status: "unvalidated",
  input_snapshot: {},
  ...o,
});

describe("formatProbability", () => {
  it("never rounds a real chance to 0% or 100%", () => {
    expect(formatProbability(0.004)).toBe("<1%");
    expect(formatProbability(0.996)).toBe(">99%");
    expect(formatProbability(0)).toBe("0%");
    expect(formatProbability(1)).toBe("100%");
    expect(formatProbability(0.42)).toBe("42%");
  });
  it("says so when there is no value", () => {
    expect(formatProbability(null)).toBe("not available");
    expect(formatProbability(Number.NaN)).toBe("not available");
  });
});

describe("scores", () => {
  it("shows an undefined score as not defined, never zero", () => {
    expect(formatScore(null)).toBe("not defined");
    expect(formatScore(0)).toBe("0.00");
    expect(formatScore(0.8333)).toBe("0.83");
  });
  it("formats lead time and its absence", () => {
    expect(formatLead(null)).toContain("not defined");
    expect(formatLead(5400)).toBe("1.5 h");
    expect(formatLead(1200)).toBe("20 min");
  });
});

describe("predictionCurrency", () => {
  const issued = "2026-11-21T10:00:00Z";
  const at = (h: number) => new Date(issued).getTime() + h * 3_600_000;
  it("is current while the input is recent", () => {
    const c = predictionCurrency(issued, at(1));
    expect(c.stale).toBe(false);
    expect(c.label).toBe("Issued 1.0 h ago");
  });
  it("goes out of date and says so, so an open page cannot keep showing it as live", () => {
    const c = predictionCurrency(issued, at(3.5));
    expect(c.stale).toBe(true);
    expect(c.label).toMatch(/^Out of date/);
  });
  it("handles clock skew without negative ages", () => {
    expect(predictionCurrency(issued, at(-2)).ageHours).toBe(0);
  });
});

describe("latestPerModel", () => {
  it("keeps only the newest run per station and model", () => {
    const rows = [
      row({ id: "old", issued_at: "2026-11-21T08:00:00Z" }),
      row({ id: "new", issued_at: "2026-11-21T10:00:00Z" }),
      row({ id: "other", model_version_id: "m2" }),
    ];
    expect(
      latestPerModel(rows)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["new", "other"]);
  });
});

describe("bandPosition", () => {
  it("maps p10..p90 onto the axis", () => {
    const b = bandPosition(row({ p10: 1, p50: 2, p90: 3 }), 0, 4);
    expect(b).toEqual({ left: 25, width: 50, mid: 50 });
  });
  it("refuses to draw a band that is missing values", () => {
    expect(bandPosition(row({ p50: null }), 0, 4)).toBeNull();
    expect(bandPosition(row({}), 2, 2)).toBeNull();
  });
});
