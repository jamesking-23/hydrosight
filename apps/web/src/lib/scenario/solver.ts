/**
 * Flood Scenarios solver (ADR-013).
 *
 * A simplified, steady-state hazard model written from the published idea of replacing
 * time-stepped shallow-water simulation with a direct estimate of peak flow (van den Bout
 * et al. 2023, Environ. Model. Softw. 168:105787). This is our own implementation. It is
 * NOT FastFlood, uses none of its code, and has not been validated against real floods.
 *
 * Steps:
 *  1. Fill depressions (priority flood with a tiny epsilon) so every cell drains.
 *  2. D8 steepest-descent flow directions.
 *  3. Steady-state discharge: sum of net runoff from all upstream cells.
 *  4. Partial steady state: a travel-time estimate along the flow path reduces discharge
 *     when the storm is shorter than the time the water needs to arrive.
 *  5. Depth and velocity from Manning's equation. Cells below the channel threshold use
 *     wide-sheet flow over one cell width. Channel cells solve the stage on a cross-section
 *     so water can spread sideways into the valley floor.
 *
 * Known limits (shown to users): no momentum, so no dam breaks or surges; weak on backwater;
 * no storm drains or culverts; filled depressions are not shown as ponds; cells at the edge
 * of the area are unreliable; terrain resolution limits everything.
 */

export type Grid = {
  nx: number;
  ny: number;
  /** Cell size in metres (square cells). */
  cellSizeM: number;
  /** Elevation in metres, row-major. NaN means no data (treated as an outlet). */
  z: Float32Array;
};

export type ScenarioInput = {
  rainMmPerHour: number;
  durationHours: number;
  infiltrationMmPerHour: number;
  manningN: number;
  /** Upstream area above which flow is treated as a channel, in km². */
  channelAreaKm2: number;
  /** Numerical guard for flat ground (m/m). Results on flats are unreliable. */
  minSlope: number;
  /** Cells on each side of a channel cell used for the cross-section. */
  transectHalfWidthCells: number;
};

export type ScenarioStats = {
  validCells: number;
  filledCells: number;
  wetCells: number;
  wetAreaKm2: number;
  maxDepthM: number;
  maxVelocityMs: number;
  maxPeakDischargeM3s: number;
  totalRunoffM3s: number;
  outletSteadyDischargeM3s: number;
  channelCells: number;
  truncatedTransects: number;
};

export type ScenarioResult = {
  nx: number;
  ny: number;
  cellSizeM: number;
  /** Depth in metres (0 where dry). */
  depthM: Float32Array;
  /** Flow speed in m/s. */
  velocityMs: Float32Array;
  /** Hours for the full upstream contribution to arrive (time of concentration). */
  timeToPeakH: Float32Array;
  /** Peak discharge in m3/s at each cell. */
  peakDischargeM3s: Float32Array;
  stats: ScenarioStats;
  settings: ScenarioInput;
  warnings: string[];
};

const EPS_FILL = 1e-5;
const DX8 = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY8 = [-1, -1, -1, 0, 0, 1, 1, 1];

export function validateInput(i: ScenarioInput): string[] {
  const errs: string[] = [];
  const pos = (v: number, name: string) => {
    if (!Number.isFinite(v) || v <= 0)
      errs.push(`${name} must be a number above 0`);
  };
  pos(i.rainMmPerHour, "Rainfall intensity");
  pos(i.durationHours, "Rainfall duration");
  pos(i.manningN, "Manning roughness");
  pos(i.channelAreaKm2, "Channel threshold");
  pos(i.minSlope, "Minimum slope");
  if (
    !Number.isFinite(i.infiltrationMmPerHour) ||
    i.infiltrationMmPerHour < 0
  ) {
    errs.push("Infiltration must be a number of 0 or more");
  }
  if (
    !Number.isInteger(i.transectHalfWidthCells) ||
    i.transectHalfWidthCells < 1
  ) {
    errs.push(
      "Cross-section half width must be a whole number of cells, 1 or more",
    );
  }
  return errs;
}

/** Minimal binary min-heap keyed by a Float64 array (indexes into the grid). */
class CellHeap {
  private items: Int32Array;
  private size = 0;
  constructor(
    capacity: number,
    private key: Float64Array,
  ) {
    this.items = new Int32Array(capacity);
  }
  get length() {
    return this.size;
  }
  push(cell: number) {
    let i = this.size++;
    const items = this.items;
    const key = this.key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[items[p]!]! <= key[cell]!) break;
      items[i]! = items[p]!;
      i = p;
    }
    items[i]! = cell;
  }
  pop(): number {
    const items = this.items;
    const key = this.key;
    const top = items[0]!;
    const last = items[--this.size]!;
    let i = 0;
    const n = this.size;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && key[items[c + 1]!]! < key[items[c]!]!) c++;
      if (key[items[c]!]! >= key[last]!) break;
      items[i]! = items[c]!;
      i = c;
    }
    if (n > 0) items[i]! = last;
    return top;
  }
}

/** Priority-flood depression filling. Returns filled elevations and the order cells were settled. */
export function fillDepressions(grid: Grid): {
  zf: Float64Array;
  order: Int32Array;
  filledCells: number;
} {
  const { nx, ny, z } = grid;
  const n = nx * ny;
  const zf = new Float64Array(n);
  const closed = new Uint8Array(n);
  const order = new Int32Array(n);
  let count = 0;
  const heap = new CellHeap(n, zf);

  for (let i = 0; i < n; i++) {
    if (Number.isNaN(z[i]!)) closed[i]! = 1;
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (Number.isNaN(z[i]!)) continue;
      let seed = x === 0 || y === 0 || x === nx - 1 || y === ny - 1;
      if (!seed) {
        for (let k = 0; k < 8; k++) {
          if (Number.isNaN(z[(y + DY8[k]!) * nx + (x + DX8[k]!)]!)) {
            seed = true;
            break;
          }
        }
      }
      if (seed) {
        zf[i]! = z[i]!;
        closed[i]! = 1;
        heap.push(i);
      }
    }
  }
  let filled = 0;
  while (heap.length > 0) {
    const c = heap.pop();
    order[count++]! = c;
    const cx = c % nx;
    const cy = (c - cx) / nx;
    for (let k = 0; k < 8; k++) {
      const x = cx + DX8[k]!;
      const y = cy + DY8[k]!;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      const j = y * nx + x;
      if (closed[j]!) continue;
      closed[j]! = 1;
      if (z[j]! <= zf[c]!) {
        zf[j]! = zf[c]! + EPS_FILL;
        if (zf[j]! - z[j]! > 1e-3) filled++;
      } else {
        zf[j]! = z[j]!;
      }
      heap.push(j);
    }
  }
  return { zf, order: order.subarray(0, count), filledCells: filled };
}

export function runScenario(grid: Grid, input: ScenarioInput): ScenarioResult {
  const errs = validateInput(input);
  if (errs.length > 0) throw new Error(errs.join("; "));
  const { nx, ny, cellSizeM: dx } = grid;
  if (grid.z.length !== nx * ny)
    throw new Error("Grid size does not match its data");
  const n = nx * ny;
  const warnings: string[] = [];

  const { zf, order, filledCells } = fillDepressions(grid);
  const validCells = order.length;

  // Receivers (D8 steepest descent) and slopes.
  const recv = new Int32Array(n).fill(-1);
  const slope = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let m = 0; m < validCells; m++) {
    const c = order[m]!;
    const cx = c % nx;
    const cy = (c - cx) / nx;
    let best = -1;
    let bestS = 0;
    let bestD = dx;
    for (let k = 0; k < 8; k++) {
      const x = cx + DX8[k]!;
      const y = cy + DY8[k]!;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      const j = y * nx + x;
      if (Number.isNaN(grid.z[j]!)) continue;
      if (zf[j]! >= zf[c]!) continue;
      const d = DX8[k]! !== 0 && DY8[k]! !== 0 ? dx * Math.SQRT2 : dx;
      const s = (zf[c]! - zf[j]!) / d;
      if (s > bestS) {
        bestS = s;
        best = j;
        bestD = d;
      }
    }
    recv[c]! = best;
    slope[c]! = bestS;
    dist[c]! = bestD;
  }
  // Slope averaged over up to 5 cells downstream, so filled flats and one-cell noise do not
  // produce extreme depths. Never below the numerical minimum.
  const localSlope = Float64Array.from(slope);
  for (let m = 0; m < validCells; m++) {
    const c = order[m]!;
    let cur = c;
    let path = 0;
    for (let k = 0; k < 5; k++) {
      const nxt = recv[cur]!;
      if (nxt < 0) break;
      path += dist[cur]!;
      cur = nxt;
    }
    const avg = path > 0 ? (zf[c]! - zf[cur]!) / path : localSlope[c]!;
    slope[c]! = Math.max(avg, input.minSlope);
  }

  // Net runoff per cell (m3/s). Constant infiltration capacity.
  const netMmH = Math.max(0, input.rainMmPerHour - input.infiltrationMmPerHour);
  const runoffPerCell = (netMmH / 1000 / 3600) * dx * dx;
  if (netMmH === 0) {
    warnings.push(
      "Infiltration is at or above rainfall, so there is no runoff in this scenario.",
    );
  }

  const qSteady = new Float64Array(n);
  const area = new Float64Array(n); // upstream cell count
  for (let m = 0; m < validCells; m++) {
    qSteady[order[m]!]! = runoffPerCell;
    area[order[m]!]! = 1;
  }
  const tc = new Float64Array(n); // seconds
  const donorQ = new Float64Array(n);
  const donorSlope = new Float64Array(n);
  const sqrtN = input.manningN;

  // Upstream to downstream: descending filled elevation = reverse settle order.
  for (let m = validCells - 1; m >= 0; m--) {
    const c = order[m]!;
    const r = recv[c]!;
    const q = qSteady[c]!;
    if (r >= 0) {
      qSteady[r]! += q;
      area[r]! += area[c]!;
      if (q > donorQ[r]!) {
        donorQ[r]! = q;
        donorSlope[r]! = slope[c]!;
      }
      if (q > 0) {
        const hw = Math.pow((q * sqrtN) / (dx * Math.sqrt(slope[c]!)), 0.6);
        const v = q / (dx * hw);
        const t = tc[c]! + dist[c]! / v;
        if (t > tc[r]!) tc[r]! = t;
      } else if (tc[c]! > tc[r]!) {
        tc[r]! = tc[c]!;
      }
    }
  }

  // Cells where water leaves the area take the slope of their main inflow (normal-depth outflow).
  // Done after the accumulation pass, so the time of concentration above used the floor slope there.
  for (let m = 0; m < validCells; m++) {
    const c = order[m]!;
    if (recv[c]! < 0 && donorQ[c]! > 0)
      slope[c]! = Math.max(donorSlope[c]!, input.minSlope);
  }

  const eventS = input.durationHours * 3600;
  const qPeak = new Float32Array(n);
  let outletSteady = 0;
  let maxQ = 0;
  for (let m = 0; m < validCells; m++) {
    const c = order[m]!;
    const f = tc[c]! > eventS ? eventS / tc[c]! : 1;
    qPeak[c]! = qSteady[c]! * f;
    if (qPeak[c]! > maxQ) maxQ = qPeak[c]!;
    if (recv[c]! < 0) outletSteady += qSteady[c]!;
  }

  const depth = new Float32Array(n);
  const vel = new Float32Array(n);
  const ttp = new Float32Array(n);
  const channelCellCount = input.channelAreaKm2 * 1e6;
  const half = input.transectHalfWidthCells;
  let channelCells = 0;
  let truncated = 0;

  const markWet = (j: number, d: number, v: number, t: number) => {
    if (d > depth[j]!) depth[j]! = d;
    if (v > vel[j]!) vel[j]! = v;
    if (t > ttp[j]!) ttp[j]! = t;
  };

  for (let m = 0; m < validCells; m++) {
    const c = order[m]!;
    const q = qPeak[c]!;
    if (!(q > 0)) continue;
    const s = slope[c]!;
    const hs = Math.pow((q * input.manningN) / (dx * Math.sqrt(s)), 0.6);
    const tHours = tc[c]! / 3600;
    if (hs > 1e-4) markWet(c, hs, q / (dx * hs), tHours);

    const isChannel = area[c]! * dx * dx >= channelCellCount;
    const r = recv[c]!;
    if (!isChannel || r < 0 || !(hs > 1e-4)) continue;
    channelCells++;

    // Cross-section perpendicular to the flow direction.
    const cx = c % nx;
    const cy = (c - cx) / nx;
    const rx = r % nx;
    const ry = (r - rx) / nx;
    const fx = rx - cx;
    const fy = ry - cy;
    const px = -fy;
    const py = fx;
    const w = dx * (px !== 0 && py !== 0 ? Math.SQRT2 : 1);
    const base = zf[c]!;

    // Conveyance for a trial depth at the centre cell; contiguous wet cells outward.
    const conveyance = (stage: number): number => {
      let k = 0;
      const d0 = stage - base;
      if (d0 > 0) k += Math.pow(d0, 5 / 3);
      for (const sign of [1, -1]) {
        for (let j = 1; j <= half; j++) {
          const x = cx + sign * j * px;
          const y = cy + sign * j * py;
          if (x < 0 || y < 0 || x >= nx || y >= ny) break;
          const i = y * nx + x;
          if (Number.isNaN(grid.z[i]!)) break;
          if (zf[i]! < base) break;
          const d = stage - zf[i]!;
          if (d <= 0) break;
          k += Math.pow(d, 5 / 3);
        }
      }
      return (k * w) / input.manningN;
    };

    const target = q / Math.sqrt(s);
    let lo = 0;
    let hi = hs;
    for (let it = 0; it < 28; it++) {
      const mid = 0.5 * (lo + hi);
      if (conveyance(base + mid) < target) lo = mid;
      else hi = mid;
    }
    const stage = base + hi;

    // Area of the wetted section for velocity, then paint it into the result.
    let areaX = 0;
    const wet: number[] = [c];
    areaX += (stage - base) * w;
    let hitEnd = false;
    for (const sign of [1, -1]) {
      for (let j = 1; j <= half; j++) {
        const x = cx + sign * j * px;
        const y = cy + sign * j * py;
        if (x < 0 || y < 0 || x >= nx || y >= ny) break;
        const i = y * nx + x;
        if (Number.isNaN(grid.z[i]!)) break;
        if (zf[i]! < base) break;
        const d = stage - zf[i]!;
        if (d <= 0) break;
        areaX += d * w;
        wet.push(i);
        if (j === half) hitEnd = true;
      }
    }
    if (hitEnd) truncated++;
    const v = areaX > 0 ? q / areaX : 0;
    for (const i of wet) {
      const d = stage - zf[i]!;
      if (d > 1e-4) markWet(i, d, v, tHours);
    }
  }

  let wet = 0;
  let maxD = 0;
  let maxV = 0;
  for (let i = 0; i < n; i++) {
    if (depth[i]! > 0.01) wet++;
    if (depth[i]! > maxD) maxD = depth[i]!;
    if (vel[i]! > maxV) maxV = vel[i]!;
  }
  if (truncated > 0) {
    warnings.push(
      `Water reached the edge of the cross-section at ${truncated} channel cells. Widen the cross-section; spreading is cut off there.`,
    );
  }
  if (filledCells > 0) {
    warnings.push(
      `${filledCells} cells sit in terrain depressions that were filled so water can drain. Ponding in them is not shown.`,
    );
  }

  return {
    nx,
    ny,
    cellSizeM: dx,
    depthM: depth,
    velocityMs: vel,
    timeToPeakH: ttp,
    peakDischargeM3s: qPeak,
    stats: {
      validCells,
      filledCells,
      wetCells: wet,
      wetAreaKm2: (wet * dx * dx) / 1e6,
      maxDepthM: maxD,
      maxVelocityMs: maxV,
      maxPeakDischargeM3s: maxQ,
      totalRunoffM3s: runoffPerCell * validCells,
      outletSteadyDischargeM3s: outletSteady,
      channelCells,
      truncatedTransects: truncated,
    },
    settings: { ...input },
    warnings,
  };
}
