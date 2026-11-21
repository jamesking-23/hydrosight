import { ForecastView } from "@/components/forecast-view";
import { Shell } from "@/components/shell";
import { ErrorNote } from "@/components/ui";
import {
  hoursAgoIso,
  latestPerModel,
  type BacktestRow,
  type ModelRow,
  type PredictionRow,
} from "@/lib/forecast";
import { loadAccess } from "@/lib/load-access";

export const dynamic = "force-dynamic";

export default async function Forecasts() {
  const a = await loadAccess("/forecasts");
  const since = hoursAgoIso(7 * 24);
  const [preds, models, tests, stations] = await Promise.all([
    a.supabase
      .from("predictions")
      .select("*")
      .gte("issued_at", since)
      .order("issued_at", { ascending: false })
      .limit(500),
    a.supabase
      .from("model_versions")
      .select(
        "id, org_id, name, version, kind, target, data_origin, status, evidence_url",
      )
      .order("name"),
    a.supabase
      .from("backtest_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    a.supabase.from("stations").select("id, name"),
  ]);
  const stationName = Object.fromEntries(
    (stations.data ?? []).map((s) => [s.id, s.name]),
  );
  return (
    <Shell title="Forecasts" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>
        {a.loadError?.message ??
          preds.error?.message ??
          models.error?.message ??
          tests.error?.message}
      </ErrorNote>
      <ForecastView
        predictions={latestPerModel(
          (preds.data ?? []) as unknown as PredictionRow[],
        )}
        models={(models.data ?? []) as unknown as ModelRow[]}
        backtests={(tests.data ?? []) as unknown as BacktestRow[]}
        stationName={stationName}
      />
    </Shell>
  );
}
