import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fillDepressions,
  runScenario,
  validateInput,
  type Grid,
  type ScenarioInput,
} from "@/lib/scenario/solver";

const base: ScenarioInput = {
  rainMmPerHour: 50,
  durationHours: 100, // long enough to reach steady state on small test grids
  infiltrationMmPerHour: 10,
  manningN: 0.05,
  channelAreaKm2: 1e9, // nothing is a channel unless a test says so
  minSlope: 0.001,
  transectHalfWidthCells: 10,
};

function grid(
  nx: number,
  ny: number,
  dx: number,
  f: (x: number, y: number) => number,
): Grid {
  const z = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) z[y * nx + x]! = f(x, y);
  return { nx, ny, cellSizeM: dx, z };
}

describe("input validation", () => {
  it("accepts a complete input", () => {
    expect(validateInput(base)).toEqual([]);
  });
  it("rejects missing or non-positive values", () => {
    expect(validateInput({ ...base, rainMmPerHour: 0 })).not.toEqual([]);
    expect(validateInput({ ...base, durationHours: Number.NaN })).not.toEqual(
      [],
    );
    expect(validateInput({ ...base, manningN: -1 })).not.toEqual([]);
    expect(validateInput({ ...base, infiltrationMmPerHour: -1 })).not.toEqual(
      [],
    );
    expect(validateInput({ ...base, transectHalfWidthCells: 0 })).not.toEqual(
      [],
    );
  });
  it("refuses to run with invalid input", () => {
    expect(() =>
      runScenario(
        grid(5, 5, 10, () => 0),
        { ...base, rainMmPerHour: 0 },
      ),
    ).toThrow();
  });
});

describe("depression filling", () => {
  it("lets every cell drain, including a bowl", () => {
    const pit = grid(15, 15, 10, (x, y) =>
      x === 7 && y === 7 ? 0 : 5 + (x + y) * 0.01,
    );
    const { zf, filledCells } = fillDepressions(pit);
    expect(filledCells).toBeGreaterThan(0);
    expect(zf[7 * 15 + 7]!).toBeGreaterThan(5);
    const res = runScenario(pit, base);
    for (const v of res.depthM) expect(Number.isFinite(v)).toBe(true);
    expect(res.warnings.some((w) => w.includes("depressions"))).toBe(true);
  });
});

describe("water balance", () => {
  it("at steady state all runoff leaves through the outlets", () => {
    // Tilted plane with some noise-free curvature.
    const g = grid(
      40,
      30,
      30,
      (x, y) => 100 - 0.4 * y - 0.1 * x + 0.002 * (x - 20) ** 2,
    );
    const r = runScenario(g, base);
    expect(r.stats.outletSteadyDischargeM3s).toBeCloseTo(
      r.stats.totalRunoffM3s,
      6,
    );
  });
  it("is zero runoff when infiltration meets rainfall, with a warning", () => {
    const g = grid(10, 10, 30, (_x, y) => 10 - y * 0.5);
    const r = runScenario(g, { ...base, infiltrationMmPerHour: 50 });
    expect(r.stats.maxDepthM).toBe(0);
    expect(r.warnings.some((w) => w.includes("no runoff"))).toBe(true);
  });
});

describe("sheet flow on a plane matches the analytic answer", () => {
  it("gives h = (q n / sqrt(S))^(3/5) at the bottom of a long slope", () => {
    const dx = 30;
    const slope = 0.02;
    const ny = 40;
    const g = grid(9, ny, dx, (_x, y) => 100 - slope * dx * y);
    const r = runScenario(g, base);
    // Interior column, a few rows above the lower edge.
    const row = ny - 4;
    const idx = row * 9 + 4;
    const netMs =
      (base.rainMmPerHour - base.infiltrationMmPerHour) / 1000 / 3600;
    const lengthM = (row + 1) * dx; // cells upstream in this column, including this one
    const qUnit = netMs * lengthM;
    const analytic = Math.pow((qUnit * base.manningN) / Math.sqrt(slope), 0.6);
    expect(r.depthM[idx]!).toBeCloseTo(analytic, 3);
    const v = r.velocityMs[idx]!;
    expect(v).toBeCloseTo(qUnit / analytic, 3);
  });
});

describe("partial steady state", () => {
  const g = grid(9, 60, 30, (_x, y) => 100 - 0.01 * 30 * y);
  it("a short storm gives less peak discharge than a long one", () => {
    const long = runScenario(g, base);
    const short = runScenario(g, { ...base, durationHours: 0.05 });
    expect(short.stats.maxPeakDischargeM3s).toBeLessThan(
      long.stats.maxPeakDischargeM3s,
    );
    expect(short.stats.maxDepthM).toBeLessThan(long.stats.maxDepthM);
  });
  it("is monotonic in duration and approaches steady state", () => {
    const a = runScenario(g, { ...base, durationHours: 0.1 }).stats
      .maxPeakDischargeM3s;
    const b = runScenario(g, { ...base, durationHours: 0.5 }).stats
      .maxPeakDischargeM3s;
    const c = runScenario(g, { ...base, durationHours: 1000 }).stats
      .maxPeakDischargeM3s;
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
    expect(c).toBeCloseTo(
      runScenario(g, { ...base, durationHours: 100 }).stats.maxPeakDischargeM3s,
      6,
    );
  });
  it("time to peak grows downstream", () => {
    const r = runScenario(g, base);
    const top = r.timeToPeakH[3 * 9 + 4]!;
    const bottom = r.timeToPeakH[55 * 9 + 4]!;
    expect(bottom).toBeGreaterThan(top);
  });
});

describe("channel cross-section in a V valley", () => {
  const nx = 41;
  const ny = 60;
  const dx = 30;
  // Valley axis at x=20, falling along y; side slopes rise 0.1 m per cell sideways.
  const valley = grid(
    nx,
    ny,
    dx,
    (x, y) => 200 - 0.5 * y + 3 * Math.abs(x - 20),
  );
  const input = { ...base, channelAreaKm2: 0.05, transectHalfWidthCells: 15 };
  const r = runScenario(valley, input);

  it("floods symmetrically about the axis and conveys the discharge it was given", () => {
    const row = 45;
    const centre = row * nx + 20;
    const left = r.depthM[row * nx + 19]!;
    const right = r.depthM[row * nx + 21]!;
    expect(r.depthM[centre]!).toBeGreaterThan(0);
    expect(left).toBeCloseTo(right, 5);
    expect(r.depthM[centre]!).toBeGreaterThan(left);
    // Manning conveyance of the painted section reproduces the peak discharge.
    const q = r.peakDischargeM3s[centre]!;
    let k = 0;
    for (let x = 0; x < nx; x++) {
      const d = r.depthM[row * nx + x]!;
      if (d > 0.0001) k += Math.pow(d, 5 / 3);
    }
    const slope = 0.5 / dx; // axis slope
    const qCheck = (k * dx * Math.sqrt(slope)) / input.manningN;
    // Side cells may carry depth from other cross-sections, so allow a tolerance.
    expect(qCheck).toBeGreaterThan(q * 0.95);
    expect(qCheck).toBeLessThan(q * 1.6);
  });

  it("is never deeper at the axis than the one-cell sheet estimate", () => {
    const row = 45;
    const c = row * nx + 20;
    const q = r.peakDischargeM3s[c]!;
    const sheet = Math.pow(
      (q * input.manningN) / (dx * Math.sqrt(0.5 / dx)),
      0.6,
    );
    expect(r.depthM[c]!).toBeLessThanOrEqual(sheet + 1e-6);
  });

  it("reports channel cells and no NaN", () => {
    expect(r.stats.channelCells).toBeGreaterThan(0);
    for (const v of r.depthM) expect(Number.isFinite(v)).toBe(true);
    for (const v of r.velocityMs) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("terrain changes", () => {
  it("a raised barrier across a valley changes the result and stays finite", () => {
    const nx = 41;
    const ny = 60;
    const dx = 30;
    const f = (x: number, y: number) => 200 - 0.5 * y + 3 * Math.abs(x - 20);
    const before = runScenario(grid(nx, ny, dx, f), {
      ...base,
      channelAreaKm2: 0.05,
    });
    const after = runScenario(
      grid(nx, ny, dx, (x, y) => f(x, y) + (y === 30 ? 6 : 0)),
      { ...base, channelAreaKm2: 0.05 },
    );
    let diff = 0;
    for (let i = 0; i < before.depthM.length; i++) {
      expect(Number.isFinite(after.depthM[i]!)).toBe(true);
      diff += Math.abs(after.depthM[i]! - before.depthM[i]!);
    }
    expect(diff).toBeGreaterThan(0);
  });
  it("treats no-data cells as outlets", () => {
    const g = grid(20, 20, 30, (_x, y) => 50 - y);
    g.z[10 * 20 + 10]! = Number.NaN;
    const r = runScenario(g, base);
    expect(r.stats.validCells).toBe(399);
    expect(r.depthM[10 * 20 + 10]!).toBe(0);
  });
});

describe("isolation from warnings (ADR-013)", () => {
  const root = join(__dirname, "..", "src");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory()
        ? files(p)
        : /\.(ts|tsx)$/.test(n)
          ? [p]
          : [];
    });
  }
  it("no alert, status, prediction or assistant code imports the scenario module", () => {
    const offenders = files(root).filter((f) => {
      if (f.includes(`${join("lib", "scenario")}`) || f.includes("scenario"))
        return false;
      return /lib\/scenario|components\/scenario/.test(readFileSync(f, "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
