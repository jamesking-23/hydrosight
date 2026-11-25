import { describe, expect, it } from "vitest";
import {
  comparePoints,
  validateEvent,
  type EventRecord,
  type ObservedPoint,
} from "@/lib/scenario/validate";

const good: EventRecord = {
  name: "Event A",
  date: "2024-05-02",
  evidence: "https://example.org/report",
  confirmed: true,
  points: [{ x: 0, y: 0, label: "p", wet: true }],
};

describe("validateEvent", () => {
  it("accepts a complete record", () => {
    expect(validateEvent(good, 0.1)).toEqual([]);
  });
  it("requires evidence, confirmation, a real date and a typed threshold", () => {
    const bad = {
      ...good,
      evidence: " ",
      confirmed: false,
      date: "2024-13-40",
    };
    const errs = validateEvent(bad, Number.NaN);
    expect(errs.length).toBe(4);
  });
  it("requires at least one point and non-negative depths", () => {
    expect(validateEvent({ ...good, points: [] }, 0.1)).toHaveLength(1);
    const neg: ObservedPoint = {
      x: 0,
      y: 0,
      label: "n",
      wet: true,
      depthM: -1,
    };
    expect(validateEvent({ ...good, points: [neg] }, 0.1)).toHaveLength(1);
  });
});

describe("comparePoints", () => {
  const nx = 3;
  const ny = 2;
  const depth = new Float32Array([0, 0.5, 2, 0, 0, 0]);
  const valid = (i: number) => i !== 5;
  const pts: ObservedPoint[] = [
    { x: 1, y: 0, label: "a", wet: true, depthM: 0.4 },
    { x: 0, y: 0, label: "b", wet: true },
    { x: 2, y: 0, label: "c", wet: false },
    { x: 1, y: 1, label: "d", wet: false },
    { x: 2, y: 1, label: "nodata", wet: true },
    { x: 9, y: 9, label: "outside", wet: true },
  ];
  const c = comparePoints(depth, nx, ny, valid, pts, 0.1);

  it("counts agreement and both kinds of disagreement", () => {
    expect(c.counts).toEqual({
      points: 6,
      compared: 4,
      agree: 2,
      observedWetModelledDry: 1,
      observedDryModelledWet: 1,
      noData: 2,
    });
  });
  it("reports depth differences only where both depths exist", () => {
    expect(c.depth.pairs).toBe(1);
    expect(c.depth.meanErrorM).toBeCloseTo(0.1, 6);
    expect(c.depth.meanAbsErrorM).toBeCloseTo(0.1, 6);
  });
  it("never invents a value for cells without data", () => {
    const r = c.rows[4]!;
    expect(r.modelledDepthM).toBeUndefined();
    expect(r.agrees).toBeUndefined();
  });
  it("has no summary score field", () => {
    expect(Object.keys(c)).toEqual(["rows", "counts", "depth"]);
  });
});
