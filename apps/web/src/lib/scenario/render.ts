import type { Grid, ScenarioResult } from "./solver";

export type Layer = "depth" | "velocity" | "timeToPeak" | "discharge";

export const LAYER_LABEL: Record<Layer, string> = {
  depth: "Water depth (m)",
  velocity: "Flow speed (m/s)",
  timeToPeak: "Time to peak flow (h)",
  discharge: "Peak discharge (m³/s)",
};

/** Greyscale relief shading (light from the north-west). NaN cells get -1 (no data). */
export function hillshade(grid: Grid): Int16Array {
  const { nx, ny, z, cellSizeM } = grid;
  const out = new Int16Array(nx * ny).fill(-1);
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const at = (x: number, y: number, fallback: number) => {
    const v =
      z[
        Math.min(ny - 1, Math.max(0, y)) * nx + Math.min(nx - 1, Math.max(0, x))
      ]!;
    return Number.isNaN(v) ? fallback : v;
  };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const c = z[y * nx + x]!;
      if (Number.isNaN(c)) continue;
      const dzdx = (at(x + 1, y, c) - at(x - 1, y, c)) / (2 * cellSizeM);
      const dzdy = (at(x, y + 1, c) - at(x, y - 1, c)) / (2 * cellSizeM);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade =
        Math.cos(alt) * Math.cos(slope) +
        Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect);
      out[y * nx + x] = Math.round(120 + 110 * Math.max(0, Math.min(1, shade)));
    }
  }
  return out;
}

type RGB = [number, number, number];
const RAMPS: Record<Layer, RGB[]> = {
  depth: [
    [190, 225, 245],
    [90, 160, 215],
    [30, 90, 170],
    [15, 40, 110],
  ],
  velocity: [
    [255, 240, 150],
    [250, 170, 60],
    [215, 70, 40],
    [120, 20, 40],
  ],
  timeToPeak: [
    [200, 235, 190],
    [90, 190, 150],
    [60, 120, 175],
    [90, 50, 140],
  ],
  discharge: [
    [225, 215, 245],
    [170, 140, 215],
    [110, 70, 175],
    [55, 20, 110],
  ],
};

export function rampColour(layer: Layer, t: number): RGB {
  const stops = RAMPS[layer];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function layerData(result: ScenarioResult, layer: Layer): Float32Array {
  switch (layer) {
    case "depth":
      return result.depthM;
    case "velocity":
      return result.velocityMs;
    case "timeToPeak":
      return result.timeToPeakH;
    case "discharge":
      return result.peakDischargeM3s;
  }
}

export type LayerScale = { min: number; max: number; log: boolean };

/** Colour scale from the data itself, for cells that pass the display threshold. */
export function layerScale(
  result: ScenarioResult,
  layer: Layer,
  minDepthM: number,
): LayerScale {
  const data = layerData(result, layer);
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    if (result.depthM[i]! >= minDepthM && data[i]! > max) max = data[i]!;
  }
  return { min: 0, max: max > 0 ? max : 1, log: layer === "discharge" };
}

/** Fills RGBA pixels: relief shading, with the chosen layer drawn over cells at or above the threshold. */
export function paintPixels(
  shade: Int16Array,
  result: ScenarioResult | null,
  layer: Layer,
  minDepthM: number,
  scale: LayerScale | null,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(shade.length * 4);
  const data = result ? layerData(result, layer) : null;
  for (let i = 0; i < shade.length; i++) {
    const s = shade[i]!;
    const o = i * 4;
    if (s < 0) {
      px[o + 3] = 0;
      continue;
    }
    let r = s;
    let g = s;
    let b = s;
    if (
      result &&
      data &&
      scale &&
      result.depthM[i]! >= minDepthM &&
      data[i]! > 0
    ) {
      const v = data[i]!;
      const t = scale.log
        ? Math.log10(1 + v) / Math.log10(1 + scale.max)
        : v / scale.max;
      const [cr, cg, cb] = rampColour(layer, t);
      r = Math.round(0.25 * s + 0.75 * cr);
      g = Math.round(0.25 * s + 0.75 * cg);
      b = Math.round(0.25 * s + 0.75 * cb);
    }
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = 255;
  }
  return px;
}
