/**
 * Comparison of a modelled scenario with points observed in a real flood event.
 * Pure functions, nothing is stored. The result is a table of differences, never a skill or
 * accuracy claim: one event and a few points cannot support one (ADR-013).
 */

export type ObservedPoint = {
  /** Cell coordinates on the terrain grid (x to the right, y down). */
  x: number;
  y: number;
  label: string;
  /** Was this place under water in the real event? */
  wet: boolean;
  /** Observed depth in metres, if someone measured or marked it. */
  depthM?: number;
};

export type EventRecord = {
  name: string;
  /** ISO date (yyyy-mm-dd) of the event. */
  date: string;
  /** Link or reference to the evidence (report, survey, photo log). */
  evidence: string;
  /** The owner has confirmed this record is a real event. Required before comparing. */
  confirmed: boolean;
  points: ObservedPoint[];
};

export type PointComparison = {
  point: ObservedPoint;
  /** undefined: the cell has no terrain data or is outside the grid. */
  modelledDepthM: number | undefined;
  modelledWet: boolean | undefined;
  agrees: boolean | undefined;
  /** modelled minus observed depth, only when both exist. */
  depthErrorM: number | undefined;
};

export type Comparison = {
  rows: PointComparison[];
  counts: {
    points: number;
    compared: number;
    agree: number;
    observedWetModelledDry: number;
    observedDryModelledWet: number;
    noData: number;
  };
  depth: {
    pairs: number;
    meanAbsErrorM: number | null;
    meanErrorM: number | null;
  };
};

export function validateEvent(e: EventRecord, wetThresholdM: number): string[] {
  const errs: string[] = [];
  if (e.name.trim() === "") errs.push("Give the event a name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date)))
    errs.push("Give the event date as yyyy-mm-dd");
  if (e.evidence.trim().length < 4)
    errs.push("Add a link or reference to the evidence for this event");
  if (!e.confirmed)
    errs.push("Confirm that this is a real event you can show evidence for");
  if (!(wetThresholdM > 0))
    errs.push("Type the depth (m, above 0) at which a cell counts as wet");
  if (e.points.length === 0) errs.push("Add at least one observed point");
  for (const p of e.points) {
    if (p.depthM !== undefined && !(p.depthM >= 0))
      errs.push(`Observed depth at "${p.label}" must be 0 or more`);
  }
  return errs;
}

export function comparePoints(
  depthM: Float32Array,
  nx: number,
  ny: number,
  terrainValid: (i: number) => boolean,
  points: readonly ObservedPoint[],
  wetThresholdM: number,
): Comparison {
  const rows: PointComparison[] = points.map((point) => {
    const inside =
      Number.isInteger(point.x) &&
      Number.isInteger(point.y) &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < nx &&
      point.y < ny;
    const i = inside ? point.y * nx + point.x : -1;
    if (!inside || !terrainValid(i)) {
      return {
        point,
        modelledDepthM: undefined,
        modelledWet: undefined,
        agrees: undefined,
        depthErrorM: undefined,
      };
    }
    const d = depthM[i]!;
    const modelledWet = d >= wetThresholdM;
    return {
      point,
      modelledDepthM: d,
      modelledWet,
      agrees: modelledWet === point.wet,
      depthErrorM: point.depthM !== undefined ? d - point.depthM : undefined,
    };
  });

  const compared = rows.filter((r) => r.agrees !== undefined);
  const errs = rows
    .map((r) => r.depthErrorM)
    .filter((v): v is number => v !== undefined);
  return {
    rows,
    counts: {
      points: rows.length,
      compared: compared.length,
      agree: compared.filter((r) => r.agrees).length,
      observedWetModelledDry: compared.filter(
        (r) => r.point.wet && !r.modelledWet,
      ).length,
      observedDryModelledWet: compared.filter(
        (r) => !r.point.wet && r.modelledWet,
      ).length,
      noData: rows.length - compared.length,
    },
    depth: {
      pairs: errs.length,
      meanAbsErrorM: errs.length
        ? errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length
        : null,
      meanErrorM: errs.length
        ? errs.reduce((a, b) => a + b, 0) / errs.length
        : null,
    },
  };
}
