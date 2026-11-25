import { describe, expect, it } from "vitest";
import { writeArrayBuffer } from "geotiff";
import { applyEdits } from "@/lib/scenario/edit";
import { demoTerrain } from "@/lib/scenario/demo";
import { loadElevationTiff } from "@/lib/scenario/geotiff-load";
import { runScenario, type Grid } from "@/lib/scenario/solver";

const flat = (nx: number, ny: number): Grid => ({
  nx,
  ny,
  cellSizeM: 10,
  z: new Float32Array(nx * ny).fill(100),
});

describe("terrain edits", () => {
  it("raises cells inside the strip only and leaves the original alone", () => {
    const g = flat(20, 20);
    const out = applyEdits(g, [
      {
        points: [
          { x: 2, y: 10 },
          { x: 17, y: 10 },
        ],
        widthM: 20,
        deltaM: 5,
        label: "barrier",
      },
    ]);
    expect(out.z[10 * 20 + 10]).toBe(105);
    expect(out.z[10 * 20 + 2]).toBe(105);
    expect(out.z[5 * 20 + 10]).toBe(100);
    expect(g.z[10 * 20 + 10]).toBe(100);
  });
  it("lowers terrain and skips no-data cells", () => {
    const g = flat(10, 10);
    g.z[5 * 10 + 5] = Number.NaN;
    const out = applyEdits(g, [
      { points: [{ x: 5, y: 5 }], widthM: 30, deltaM: -3, label: "basin" },
    ]);
    expect(out.z[5 * 10 + 6]).toBe(97);
    expect(Number.isNaN(out.z[5 * 10 + 5]!)).toBe(true);
  });
  it("ignores an edit with no width", () => {
    const out = applyEdits(flat(5, 5), [
      { points: [{ x: 2, y: 2 }], widthM: 0, deltaM: 9, label: "x" },
    ]);
    expect(Math.max(...out.z)).toBe(100);
  });
});

describe("demo terrain", () => {
  it("runs end to end and produces finite, non-trivial results", () => {
    const r = runScenario(demoTerrain(), {
      rainMmPerHour: 60,
      durationHours: 3,
      infiltrationMmPerHour: 10,
      manningN: 0.05,
      channelAreaKm2: 0.5,
      minSlope: 0.001,
      transectHalfWidthCells: 15,
    });
    expect(r.stats.wetCells).toBeGreaterThan(0);
    expect(Number.isFinite(r.stats.maxDepthM)).toBe(true);
  });
});

describe("GeoTIFF loading", () => {
  async function tiff(
    width: number,
    height: number,
    bbox: number[],
  ): Promise<Blob> {
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = 1000 + (i % width);
    const buf = await writeArrayBuffer(data, {
      width,
      height,
      ModelPixelScale: [
        (bbox[2]! - bbox[0]!) / width,
        (bbox[3]! - bbox[1]!) / height,
        0,
      ],
      ModelTiepoint: [0, 0, 0, bbox[0]!, bbox[3]!, 0],
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
    });
    return new Blob([buf]);
  }
  it("reads a geographic file and converts degrees to metres", async () => {
    const blob = await tiff(100, 100, [29.9, -1.3, 30.0, -1.2]);
    const t = await loadElevationTiff(blob, { maxSide: 800 });
    expect(t.geographic).toBe(true);
    expect(t.grid.nx).toBe(100);
    // 0.001 degrees is about 111 m north-south near the equator.
    expect(t.grid.cellSizeM).toBeGreaterThan(105);
    expect(t.grid.cellSizeM).toBeLessThan(115);
    expect(t.grid.z[5]).toBeCloseTo(1005, 3);
  });
  it("resamples a window that is larger than the limit", async () => {
    const blob = await tiff(200, 200, [29.9, -1.3, 30.0, -1.2]);
    const t = await loadElevationTiff(blob, { maxSide: 50 });
    expect(t.grid.nx).toBe(50);
    expect(t.resampled).toBe(true);
    expect(t.notes.join(" ")).toContain("resampled");
  });
  it("reads a window around a point and rejects a point outside the file", async () => {
    const blob = await tiff(200, 200, [29.9, -1.3, 30.0, -1.2]);
    const t = await loadElevationTiff(blob, {
      maxSide: 800,
      centre: { lon: 29.95, lat: -1.25, halfWidthKm: 2 },
    });
    expect(t.grid.nx).toBeLessThan(200);
    expect(t.grid.nx).toBeGreaterThan(5);
    await expect(
      loadElevationTiff(blob, {
        maxSide: 800,
        centre: { lon: 31, lat: -1.25, halfWidthKm: 2 },
      }),
    ).rejects.toThrow(/outside/);
  });
});

describe("demo terrain plausibility", () => {
  it("gives no implausible depths for a 550 m3/s peak", () => {
    const r = runScenario(demoTerrain(), {
      rainMmPerHour: 60,
      durationHours: 3,
      infiltrationMmPerHour: 10,
      manningN: 0.05,
      channelAreaKm2: 0.5,
      minSlope: 0.001,
      transectHalfWidthCells: 15,
    });
    expect(r.stats.maxDepthM).toBeLessThan(6);
    expect(r.stats.maxVelocityMs).toBeLessThan(12);
  });
});
