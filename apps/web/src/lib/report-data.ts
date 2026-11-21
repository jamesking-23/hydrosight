import type { createClient } from "@/lib/supabase/server";
import {
  buildAnalyticsReport,
  buildAssetsReport,
  type BacktestSummary,
  type EventRow,
  type Portfolio,
  type Report,
  type RuleInfo,
  type StationAnalytics,
  type VerificationRow,
  type ZoneRow,
} from "@/lib/report";

type Sb = Awaited<ReturnType<typeof createClient>>;
export type Loaded<T> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

export function isUuid(v: string | null | undefined): v is string {
  return !!v && UUID.test(v);
}

/** Last 30 days, as dates. Lives here (not in a component) because it reads the clock. */
export function defaultWindow(now: number = Date.now()): {
  from: string;
  to: string;
} {
  return {
    from: new Date(now - 30 * DAY).toISOString().slice(0, 10),
    to: new Date(now + DAY).toISOString().slice(0, 10),
  };
}

export interface AnalyticsQuery {
  station: string | null;
  from: string | null;
  to: string | null;
  warn: string | null;
}

export function validateAnalyticsQuery(
  q: AnalyticsQuery,
):
  | { ok: true; station: string; from: string; to: string; warn: number | null }
  | { ok: false; error: string } {
  if (!isUuid(q.station)) return { ok: false, error: "Choose a station." };
  const from = q.from ? Date.parse(q.from) : NaN;
  const to = q.to ? Date.parse(q.to) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to))
    return { ok: false, error: "Enter a start and end date." };
  if (to <= from)
    return { ok: false, error: "The end date must be after the start date." };
  if (to - from > 5 * 365 * DAY)
    return { ok: false, error: "The window can be at most 5 years." };
  let warn: number | null = null;
  if (q.warn !== null && q.warn !== "") {
    warn = Number(q.warn);
    if (!Number.isFinite(warn) || warn <= 0 || warn > 1)
      return {
        ok: false,
        error: "Warning probability must be above 0 and at most 1.",
      };
  }
  return {
    ok: true,
    station: q.station,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    warn,
  };
}

export async function loadAnalyticsReport(
  sb: Sb,
  email: string,
  q: AnalyticsQuery,
): Promise<
  Loaded<{ report: Report; orgId: string; from: string; to: string }>
> {
  const v = validateAnalyticsQuery(q);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const station = await sb
    .from("stations")
    .select("id, name, org_id")
    .eq("id", v.station)
    .maybeSingle();
  if (station.error)
    return { ok: false, status: 500, error: station.error.message };
  if (!station.data)
    return {
      ok: false,
      status: 404,
      error: "Station not found, or you cannot see it.",
    };
  const orgId = station.data.org_id as string;

  const rules = await sb
    .from("threshold_rules")
    .select("id, threshold_value, rationale, comparator, sensor_kind")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (rules.error)
    return { ok: false, status: 500, error: rules.error.message };
  const best = (rules.data ?? [])
    .filter(
      (r) =>
        r.comparator === ">=" &&
        (r.sensor_kind === null || r.sensor_kind === "water_level") &&
        (r.rationale ?? "").trim().length >= 20,
    )
    .sort((a, b) => a.threshold_value - b.threshold_value)[0];

  const a = await sb.rpc("analytics_station", {
    p_station: v.station,
    p_from: v.from,
    p_to: v.to,
    p_level: best ? best.threshold_value : null,
  });
  if (a.error) return { ok: false, status: 500, error: a.error.message };
  const data = a.data as StationAnalytics | null;
  if (!data)
    return {
      ok: false,
      status: 404,
      error: "Station not found, or you cannot see it.",
    };
  const unit = data.sensors.find((s) => s.kind === "water_level")?.unit ?? "m";
  const rule: RuleInfo | null = best
    ? {
        id: best.id,
        value: best.threshold_value,
        unit,
        rationale: best.rationale ?? "",
      }
    : null;

  const [ev, bt, models, ver] = await Promise.all([
    sb
      .from("flood_events")
      .select(
        "started_at, ended_at, peak_value, peak_unit, data_origin, evidence_ref, description",
      )
      .eq("station_id", v.station)
      .gte("started_at", v.from)
      .lt("started_at", v.to)
      .order("started_at"),
    sb
      .from("backtest_runs")
      .select(
        "model_version_id, holdout_start, holdout_end, horizon_hours, n_forecasts, pod, far, csi, brier, is_synthetic",
      )
      .eq("station_id", v.station)
      .order("created_at", { ascending: false })
      .limit(50),
    sb.from("model_versions").select("id, name, version").eq("org_id", orgId),
    v.warn === null
      ? Promise.resolve({ data: null, error: null })
      : sb.rpc("prediction_verification", {
          p_org: orgId,
          p_from: v.from,
          p_to: v.to,
          p_warn: v.warn,
        }),
  ]);
  const err = ev.error ?? bt.error ?? models.error ?? ver.error;
  if (err) return { ok: false, status: 500, error: err.message };
  const name = Object.fromEntries(
    (models.data ?? []).map((m) => [m.id, `${m.name} ${m.version}`]),
  );
  const backtests: BacktestSummary[] = (bt.data ?? []).map((b) => ({
    ...b,
    model: name[b.model_version_id] ?? "unknown model",
  }));
  const report = buildAnalyticsReport({
    data,
    rule,
    warn: v.warn,
    verification:
      v.warn === null ? null : ((ver.data ?? []) as VerificationRow[]),
    events: (ev.data ?? []) as EventRow[],
    backtests,
    generatedAt: new Date().toISOString(),
    generatedBy: email,
  });
  return { ok: true, report, orgId, from: v.from, to: v.to };
}

export async function loadAssetsReport(
  sb: Sb,
  email: string,
  orgId: string | null,
): Promise<Loaded<{ report: Report; orgId: string }>> {
  if (!isUuid(orgId))
    return { ok: false, status: 400, error: "Choose an organisation." };
  const [org, port, zones] = await Promise.all([
    sb.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    sb.rpc("portfolio_exposure", { p_org: orgId }),
    sb
      .from("hazard_zones")
      .select("name, scenario, source, licence, source_type, status")
      .eq("org_id", orgId)
      .order("name"),
  ]);
  const err = org.error ?? port.error ?? zones.error;
  if (err) return { ok: false, status: 500, error: err.message };
  if (!org.data)
    return {
      ok: false,
      status: 404,
      error: "Organisation not found, or you cannot see it.",
    };
  const report = buildAssetsReport({
    portfolio: port.data as Portfolio,
    zones: (zones.data ?? []) as ZoneRow[],
    orgName: org.data.name as string,
    generatedAt: new Date().toISOString(),
    generatedBy: email,
  });
  return { ok: true, report, orgId };
}
