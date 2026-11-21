// Pure helpers for the forecast screen. Nothing here invents a number: every value shown comes
// from a stored prediction or backtest, and missing values are said to be missing.

export const MAX_PREDICTION_AGE_HOURS = 3; // mirrors the engine: older input is not forecast from

export interface PredictionRow {
  id: string;
  org_id: string;
  station_id: string;
  model_version_id: string;
  target: "flood_occurrence" | "stage";
  issued_at: string;
  valid_from: string;
  valid_to: string;
  horizon_hours: number;
  probability: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  unit: string | null;
  source_type: "forecast" | "synthetic";
  status: "unvalidated" | "validated" | "operational";
  input_snapshot: Record<string, unknown>;
}

export interface ModelRow {
  id: string;
  org_id: string;
  name: string;
  version: string;
  kind: string;
  target: string;
  data_origin: "synthetic" | "real_unconfirmed" | "real_confirmed";
  status: "unvalidated" | "validated" | "operational";
  evidence_url: string | null;
}

export interface BacktestRow {
  id: string;
  org_id: string;
  model_version_id: string;
  station_id: string;
  evaluation_origin: string;
  holdout_start: string;
  holdout_end: string;
  horizon_hours: number;
  event_threshold: number;
  event_threshold_unit: string;
  event_basis: string;
  n_forecasts: number;
  hits: number;
  misses: number;
  false_alarms: number;
  correct_negatives: number;
  pod: number | null;
  far: number | null;
  csi: number | null;
  brier: number | null;
  median_lead_time_s: number | null;
  reliability:
    | {
        bin_low: number;
        bin_high: number;
        n: number;
        mean_forecast: number;
        observed_frequency: number;
      }[]
    | null;
  extreme_events: {
    extreme_threshold: number | null;
    events: number;
    detected: number;
    pod: number | null;
  } | null;
  is_synthetic: boolean;
  created_at: string;
}

/** Probability as a percentage. Never rounds a non-zero chance down to "0%" or up to "100%". */
export function formatProbability(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "not available";
  if (p > 0 && p < 0.01) return "<1%";
  if (p < 1 && p > 0.99) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** A score that could not be computed is "not defined", never 0. */
export function formatScore(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? "not defined" : v.toFixed(digits);
}

export interface Currency {
  stale: boolean;
  ageHours: number;
  label: string;
}

/** A prediction is current only while the data it was made from is recent. After that it is
 *  shown as out of date, never as a live forecast. */
export function predictionCurrency(
  issuedAt: string,
  now: number = Date.now(),
): Currency {
  const ageHours = Math.max(
    0,
    (now - new Date(issuedAt).getTime()) / 3_600_000,
  );
  const stale = ageHours > MAX_PREDICTION_AGE_HOURS;
  const age =
    ageHours < 1
      ? `${Math.round(ageHours * 60)} min`
      : `${ageHours.toFixed(1)} h`;
  return {
    stale,
    ageHours,
    label: stale ? `Out of date: issued ${age} ago` : `Issued ${age} ago`,
  };
}

export function formatLead(seconds: number | null): string {
  if (seconds === null) return "not defined (no event was warned in time)";
  const h = seconds / 3600;
  return h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(seconds / 60)} min`;
}

export function originLabel(o: string): string {
  return (
    (
      {
        synthetic: "Synthetic data",
        real_unconfirmed: "Real data, not yet confirmed",
        real_confirmed: "Real data, confirmed",
      } as Record<string, string>
    )[o] ?? o
  );
}

export function statusLabel(s: string): string {
  return s === "unvalidated"
    ? "Not validated"
    : s === "validated"
      ? "Validated"
      : "Operational";
}

/** Latest prediction per (station, model), so the table never lists a superseded run. */
export function latestPerModel(rows: PredictionRow[]): PredictionRow[] {
  const best = new Map<string, PredictionRow>();
  for (const r of rows) {
    const key = `${r.station_id}|${r.model_version_id}|${r.target}`;
    const cur = best.get(key);
    if (!cur || r.issued_at > cur.issued_at) best.set(key, r);
  }
  return [...best.values()].sort((a, b) =>
    (a.station_id + a.model_version_id).localeCompare(
      b.station_id + b.model_version_id,
    ),
  );
}

/** Position of p10..p90 within a shared axis, for the uncertainty band. Null when it cannot be drawn honestly. */
export function bandPosition(
  p: PredictionRow,
  axisMin: number,
  axisMax: number,
): { left: number; width: number; mid: number } | null {
  if (p.p10 === null || p.p50 === null || p.p90 === null || axisMax <= axisMin)
    return null;
  const pct = (v: number) =>
    Math.min(100, Math.max(0, ((v - axisMin) / (axisMax - axisMin)) * 100));
  return {
    left: pct(p.p10),
    width: Math.max(0.5, pct(p.p90) - pct(p.p10)),
    mid: pct(p.p50),
  };
}

/** ISO time `hours` ago. Lives here (not in a component) because it reads the clock. */
export function hoursAgoIso(hours: number, now: number = Date.now()): string {
  return new Date(now - hours * 3_600_000).toISOString();
}
