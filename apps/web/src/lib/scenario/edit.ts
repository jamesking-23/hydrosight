import type { Grid } from "./solver";

export type TerrainEdit = {
  /** Polyline vertices in cell coordinates (x to the right, y down). */
  points: { x: number; y: number }[];
  /** Full width of the edit strip in metres. */
  widthM: number;
  /** Elevation change in metres. Positive raises (barrier), negative lowers (channel, basin). */
  deltaM: number;
  label: string;
};

function distToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Returns a new grid with the edits applied. The original grid is never changed. */
export function applyEdits(grid: Grid, edits: readonly TerrainEdit[]): Grid {
  const z = new Float32Array(grid.z);
  const { nx, ny, cellSizeM } = grid;
  for (const e of edits) {
    if (e.points.length === 0 || !(e.widthM > 0) || !Number.isFinite(e.deltaM))
      continue;
    const halfCells = e.widthM / 2 / cellSizeM;
    const xs = e.points.map((p) => p.x);
    const ys = e.points.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - halfCells - 1));
    const x1 = Math.min(nx - 1, Math.ceil(Math.max(...xs) + halfCells + 1));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - halfCells - 1));
    const y1 = Math.min(ny - 1, Math.ceil(Math.max(...ys) + halfCells + 1));
    const r2 = halfCells * halfCells;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * nx + x;
        if (Number.isNaN(z[i]!)) continue;
        let best = Infinity;
        if (e.points.length === 1) {
          best = (x - e.points[0]!.x) ** 2 + (y - e.points[0]!.y) ** 2;
        } else {
          for (let k = 0; k + 1 < e.points.length; k++) {
            const a = e.points[k]!;
            const b = e.points[k + 1]!;
            best = Math.min(best, distToSegmentSq(x, y, a.x, a.y, b.x, b.y));
          }
        }
        if (best <= r2) z[i] = z[i]! + e.deltaM;
      }
    }
  }
  return { nx, ny, cellSizeM, z };
}
