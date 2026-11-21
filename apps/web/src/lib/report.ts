// One report object feeds the screen and every export format, so a download can never disagree
// with what was on screen. Builders are pure: no clock, no network.

export type Cell = string | number | null;

export interface ReportTable {
  title: string;
  columns: string[];
  rows: Cell[][];
  note?: string;
}

export interface Report {
  kind: "analytics" | "assets";
  title: string;
  scope: string; // station or organisation name
  generatedAt: string; // ISO, supplied by the caller
  generatedBy: string;
  window: { from: string; to: string } | null;
  sources: string[];
  maturity: string;
  assumptions: string[];
  tables: ReportTable[];
}

const dash = "—";

export function num(v: number | null | undefined, digits = 3): number | null {
  return v === null || v === undefined || !Number.isFinite(v)
    ? null
    : Number(v.toFixed(digits));
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? "not defined"
    : `${(v * 100).toFixed(1)}%`;
}

/** Show an empty cell as "not available", never as zero. */
export function cell(v: Cell | undefined): Cell {
  return v === undefined || v === null ? "not available" : v;
}

// ---------- raw shapes returned by the database functions ----------
export interface SensorAnalytics {
  sensor_id: string;
  kind: string;
  unit: string;
  source_type: string;
  expected_interval_s: number;
  summary: {
    readings: number;
    used_in_statistics: number;
    quality_good: number;
    quality_unchecked: number;
    quality_suspect: number;
    quality_bad: number;
    estimated_excluded: number;
    min: number | null;
    mean: number | null;
    max: number | null;
    first_at: string | null;
    last_at: string | null;
    expected_readings: number;
    completeness: number;
  };
  monthly: {
    month: string;
    readings: number;
    mean: number | null;
    max: number | null;
    sum: number | null;
  }[];
  weekly_performance: {
    week_start: string;
    received: number;
    expected: number;
    completeness: number;
    suspect: number;
    bad: number;
  }[];
  seasonal: {
    month_number: number;
    years_with_data: number;
    mean: number | null;
    max: number | null;
  }[];
  annual_maxima: { year: number; max: number | null; readings: number }[];
  days_at_or_above_level: { year: number; days_at_or_above: number }[] | null;
}

export interface StationAnalytics {
  station_id: string;
  org_id: string;
  station: string;
  window_from: string;
  window_to: string;
  level: number | null;
  sensors: SensorAnalytics[];
}

export interface VerificationRow {
  model: string;
  predictions: number;
  outcome_unknown: number;
  hits: number;
  misses: number;
  false_alarms: number;
  correct_negatives: number;
  brier: number | null;
  includes_synthetic: boolean;
}

export interface EventRow {
  started_at: string;
  ended_at: string | null;
  peak_value: number | null;
  peak_unit: string | null;
  data_origin: string;
  evidence_ref: string;
  description: string | null;
}

export interface BacktestSummary {
  model: string;
  holdout_start: string;
  holdout_end: string;
  horizon_hours: number;
  n_forecasts: number;
  pod: number | null;
  far: number | null;
  csi: number | null;
  brier: number | null;
  is_synthetic: boolean;
}

export interface RuleInfo {
  id: string;
  value: number;
  unit: string;
  rationale: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface AnalyticsInput {
  data: StationAnalytics;
  rule: RuleInfo | null;
  warn: number | null;
  verification: VerificationRow[] | null;
  events: EventRow[];
  backtests: BacktestSummary[];
  generatedAt: string;
  generatedBy: string;
}

export function buildAnalyticsReport(i: AnalyticsInput): Report {
  const d = i.data;
  const tables: ReportTable[] = [];
  const synthetic = d.sensors.some((s) => s.source_type === "synthetic");
  for (const s of d.sensors) {
    const sm = s.summary;
    const label = `${s.kind.replace("_", " ")} (${s.unit})`;
    tables.push({
      title: `Summary: ${label}`,
      columns: ["Measure", "Value"],
      rows: [
        ["Source type", s.source_type],
        ["Readings stored in window", sm.readings],
        [
          "Readings used in statistics (good or unchecked, not estimated)",
          sm.used_in_statistics,
        ],
        ["Quality: good", sm.quality_good],
        ["Quality: unchecked", sm.quality_unchecked],
        ["Quality: suspect", sm.quality_suspect],
        ["Quality: bad", sm.quality_bad],
        ["Estimated (interpolated) readings excluded", sm.estimated_excluded],
        ["Minimum", cell(num(sm.min))],
        ["Mean", cell(num(sm.mean))],
        ["Maximum", cell(num(sm.max))],
        ["First reading", cell(sm.first_at)],
        ["Last reading", cell(sm.last_at)],
        ["Readings expected at the configured interval", sm.expected_readings],
        ["Completeness (received / expected)", pct(sm.completeness)],
      ],
    });
    const rain = s.kind === "rainfall";
    tables.push({
      title: `Monthly: ${label}`,
      columns: rain
        ? ["Month", "Readings", "Mean", "Maximum", "Sum of values"]
        : ["Month", "Readings", "Mean", "Maximum"],
      rows: s.monthly.map((m) =>
        rain
          ? [
              m.month,
              m.readings,
              cell(num(m.mean)),
              cell(num(m.max)),
              cell(num(m.sum)),
            ]
          : [m.month, m.readings, cell(num(m.mean)), cell(num(m.max))],
      ),
      note: rain
        ? "The sum adds the recorded values. It is a rainfall total only if each reading is the rain that fell in its interval; check the sensor unit and interval."
        : undefined,
    });
    tables.push({
      title: `By calendar month: ${label}`,
      columns: ["Month", "Years with data", "Mean", "Maximum"],
      rows: s.seasonal.map((m) => [
        MONTHS[m.month_number - 1] ?? String(m.month_number),
        m.years_with_data,
        cell(num(m.mean)),
        cell(num(m.max)),
      ]),
      note: "Each calendar month is summarised only over the years inside the window. Fewer years means a weaker seasonal picture.",
    });
    tables.push({
      title: `Highest value each year: ${label}`,
      columns: ["Year", "Highest value", "Readings"],
      rows: s.annual_maxima.map((a) => [a.year, cell(num(a.max)), a.readings]),
      note: "Return periods are not estimated. A short record cannot support them, and none is computed here.",
    });
    if (s.days_at_or_above_level) {
      tables.push({
        title: `Days at or above ${d.level} ${s.unit}: ${label}`,
        columns: ["Year", "Days"],
        rows: s.days_at_or_above_level.map((y) => [y.year, y.days_at_or_above]),
        note: i.rule
          ? `Level from approved rule ${i.rule.id}. Basis: ${i.rule.rationale}`
          : undefined,
      });
    }
    tables.push({
      title: `Sensor performance by week: ${label}`,
      columns: [
        "Week starting",
        "Received",
        "Expected",
        "Completeness",
        "Suspect",
        "Bad",
      ],
      rows: s.weekly_performance.map((w) => [
        w.week_start.slice(0, 10),
        w.received,
        w.expected,
        pct(w.completeness),
        w.suspect,
        w.bad,
      ]),
      note: "Gaps are shown as lower completeness. Missing readings are never filled in.",
    });
  }
  tables.push({
    title: "Recorded flood events",
    columns: [
      "Started",
      "Ended",
      "Peak",
      "Data origin",
      "Evidence",
      "Description",
    ],
    rows: i.events.map((e) => [
      e.started_at,
      cell(e.ended_at),
      e.peak_value === null
        ? "not recorded"
        : `${e.peak_value} ${e.peak_unit ?? ""}`.trim(),
      e.data_origin.replace("_", " "),
      e.evidence_ref,
      cell(e.description),
    ]),
    note:
      i.events.length === 0
        ? "No flood events are recorded for this station in the window."
        : undefined,
  });
  if (i.verification === null) {
    tables.push({
      title: "Forecast verification",
      columns: ["Status"],
      rows: [
        [
          "Not shown: choose a warning probability to compare stored predictions with what was observed.",
        ],
      ],
    });
  } else {
    tables.push({
      title: `Forecast verification (warning at ${i.warn} probability)`,
      columns: [
        "Model",
        "Predictions",
        "Outcome unknown",
        "Hits",
        "Misses",
        "False alarms",
        "Correct negatives",
        "Brier",
        "Includes synthetic",
      ],
      rows: i.verification.map((v) => [
        v.model,
        v.predictions,
        v.outcome_unknown,
        v.hits,
        v.misses,
        v.false_alarms,
        v.correct_negatives,
        cell(num(v.brier, 4)),
        v.includes_synthetic ? "yes" : "no",
      ]),
      note: "Counts only. Small samples say little, and no pass mark is applied.",
    });
  }
  tables.push({
    title: "Backtests on stored history",
    columns: [
      "Model",
      "Hold-out",
      "Horizon (h)",
      "Forecasts",
      "POD",
      "FAR",
      "CSI",
      "Brier",
      "Synthetic data",
    ],
    rows: i.backtests.map((b) => [
      b.model,
      `${b.holdout_start.slice(0, 10)} to ${b.holdout_end.slice(0, 10)}`,
      b.horizon_hours,
      b.n_forecasts,
      b.pod === null ? "not defined" : num(b.pod, 2),
      b.far === null ? "not defined" : num(b.far, 2),
      b.csi === null ? "not defined" : num(b.csi, 2),
      cell(num(b.brier, 4)),
      b.is_synthetic ? "yes: tests software only" : "no",
    ]),
    note:
      i.backtests.length === 0
        ? "No backtests have been run for this station."
        : undefined,
  });

  const kinds = [...new Set(d.sensors.map((s) => s.source_type))];
  return {
    kind: "analytics",
    title: `Station analytics: ${d.station}`,
    scope: d.station,
    generatedAt: i.generatedAt,
    generatedBy: i.generatedBy,
    window: { from: d.window_from, to: d.window_to },
    sources: [
      `Stored sensor readings with calibration applied at read time (source type: ${kinds.join(", ") || "none"}).`,
      "Recorded flood events entered by people with an evidence reference.",
      "Stored predictions and backtest runs from the prediction engine.",
    ],
    maturity: synthetic
      ? "SYNTHETIC DATA is included. These figures test the software and say nothing about a real river. Nothing in this report has been validated."
      : "Nothing in this report has been validated. Measured values are as recorded, after the quality checks stated.",
    assumptions: [
      "Only readings with quality good or unchecked, and not interpolated, are used in statistics; every quality class is counted.",
      "Completeness compares readings received with those expected at the sensor's configured interval.",
      "No gaps are filled and no return period is estimated.",
      ...(i.rule
        ? [
            `Event level ${i.rule.value} ${i.rule.unit} comes from approved rule ${i.rule.id}.`,
          ]
        : [
            "No approved threshold rule was available, so no level-based figures are shown.",
          ]),
    ],
    tables,
  };
}

// ---------- assets ----------
export interface ExposureRow {
  asset_id: string;
  name: string;
  kind: string;
  geometry_type: string;
  lon: number;
  lat: number;
  record_source_type: string;
  elevation: {
    status: string;
    value_m?: number;
    source_type?: string;
    note?: string;
  };
  waterway: {
    status: string;
    nearest?: string;
    distance_m?: number;
    source?: string;
    note?: string;
  };
  hazard: {
    status: string;
    loaded_zones: number;
    zones?: {
      name: string;
      scenario: string;
      source: string;
      source_type: string;
      status: string;
    }[];
    note: string;
  };
  value: {
    amount: number;
    currency: string;
    basis: string;
    label: string;
  } | null;
}

export interface Portfolio {
  assets: ExposureRow[];
  value_inside_loaded_zones_by_currency: {
    currency: string;
    amount: number;
    assets: number;
  }[];
  assumptions: string[];
}

export interface ZoneRow {
  name: string;
  scenario: string;
  source: string;
  licence: string;
  source_type: string;
  status: string;
}

export const HAZARD_TEXT: Record<string, string> = {
  not_assessed: "Not assessed (no hazard zones loaded)",
  inside: "Inside a loaded zone",
  outside_loaded_zones: "Outside loaded zones (not a statement of safety)",
};

export function buildAssetsReport(p: {
  portfolio: Portfolio;
  zones: ZoneRow[];
  orgName: string;
  generatedAt: string;
  generatedBy: string;
}): Report {
  const a = p.portfolio.assets;
  return {
    kind: "assets",
    title: `Asset exposure: ${p.orgName}`,
    scope: p.orgName,
    generatedAt: p.generatedAt,
    generatedBy: p.generatedBy,
    window: null,
    sources: [
      "Assets registered by people in this organisation.",
      "Hazard zones loaded by people, each with its own source and licence (listed below).",
      "Imported river geometry, where any exists.",
    ],
    maturity:
      "Not validated. Indicators depend on layers a person loaded; where a layer is missing the indicator says not assessed. Values are user-supplied assumptions, not established losses.",
    assumptions: p.portfolio.assumptions,
    tables: [
      {
        title: "Assets and exposure indicators",
        columns: [
          "Asset",
          "Kind",
          "Shape",
          "Record source",
          "Elevation",
          "Nearest waterway",
          "Hazard zones",
          "Zones",
          "Supplied value",
          "Value basis",
        ],
        rows: a.map((x) => [
          x.name,
          x.kind.replace("_", " "),
          x.geometry_type,
          x.record_source_type,
          x.elevation.status === "provided"
            ? `${x.elevation.value_m} m (${x.elevation.source_type})`
            : "not provided",
          x.waterway.status === "assessed"
            ? `${x.waterway.nearest}, ${x.waterway.distance_m} m (straight line)`
            : "not assessed",
          HAZARD_TEXT[x.hazard.status] ?? x.hazard.status,
          x.hazard.zones
            ?.map((z) => `${z.name} [${z.scenario}; unvalidated]`)
            .join("; ") ?? dash,
          x.value ? `${x.value.amount} ${x.value.currency}` : "none supplied",
          x.value ? x.value.basis : dash,
        ]),
        note: a.length === 0 ? "No assets are registered." : undefined,
      },
      {
        title: "Supplied value inside loaded hazard zones",
        columns: ["Currency", "Assets", "Total supplied value"],
        rows: p.portfolio.value_inside_loaded_zones_by_currency.map((v) => [
          v.currency,
          v.assets,
          v.amount,
        ]),
        note: "This is the supplied value of assets inside a loaded zone. No damage curve is applied and no loss is estimated. Assets with no supplied value are not counted.",
      },
      {
        title: "Hazard zones loaded",
        columns: [
          "Zone",
          "Scenario (as labelled by the source)",
          "Source",
          "Licence",
          "Source type",
          "Status",
        ],
        rows: p.zones.map((z) => [
          z.name,
          z.scenario,
          z.source,
          z.licence,
          z.source_type,
          z.status,
        ]),
        note: p.zones.length === 0 ? "No hazard zones are loaded." : undefined,
      },
    ],
  };
}
