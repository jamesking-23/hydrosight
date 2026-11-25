"use client";
import { useNow } from "@/components/live-refresh";
import { SourceBadge } from "@/components/source-badge";
import { Card } from "@/components/ui";
import {
  bandPosition,
  formatLead,
  formatProbability,
  formatScore,
  originLabel,
  predictionCurrency,
  statusLabel,
  type BacktestRow,
  type ModelRow,
  type PredictionRow,
} from "@/lib/forecast";

interface Props {
  predictions: PredictionRow[];
  models: ModelRow[];
  backtests: BacktestRow[];
  stationName: Record<string, string>;
}

function Provenance({ p, model }: { p: PredictionRow; model?: ModelRow }) {
  const s = p.input_snapshot as Record<string, unknown>;
  const thr = (s.threshold ?? {}) as {
    value?: number;
    unit?: string;
    rationale?: string;
    rule_id?: string;
  };
  return (
    <details className="mt-1 text-xs text-muted">
      <summary className="cursor-pointer font-semibold text-ink">
        Where this number comes from
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt>Model</dt>
        <dd>
          {model
            ? `${model.name} ${model.version} (${model.kind})`
            : p.model_version_id}
        </dd>
        <dt>Input data</dt>
        <dd>
          {String(s.series_from ?? "?")} to {String(s.series_to ?? "?")},{" "}
          {String(s.n_hours ?? "?")} hourly values,{" "}
          {originLabel(String(s.data_origin ?? "unknown"))}
        </dd>
        <dt>Event level used</dt>
        <dd>
          {thr.value !== undefined
            ? `${thr.value} ${thr.unit ?? ""}`
            : "not recorded"}{" "}
          (rule {thr.rule_id ?? "not recorded"})
        </dd>
        <dt>Why that level</dt>
        <dd>{thr.rationale ?? "not recorded"}</dd>
        <dt>Model inputs</dt>
        <dd>
          <code>{JSON.stringify(s.model_inputs ?? {})}</code>
        </dd>
        <dt>Water-level sensor</dt>
        <dd>{String(s.stage_sensor_id ?? "not recorded")}</dd>
      </dl>
    </details>
  );
}

function PredictionCard({
  p,
  model,
  axis,
  now,
}: {
  p: PredictionRow;
  model?: ModelRow;
  axis: [number, number];
  now: number;
}) {
  const cur = predictionCurrency(p.issued_at, now);
  const band = bandPosition(p, axis[0], axis[1]);
  return (
    <li
      className={`rounded-lg border p-4 ${cur.stale ? "border-src-estimated/60 bg-src-estimated/5" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {model ? `${model.name} ${model.version}` : "Unknown model"}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <SourceBadge source={p.source_type} />
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-bold">
            {statusLabel(p.status)}
          </span>
        </span>
      </div>
      <p className="mt-2 text-lg">
        Chance the water level reaches the event level within {p.horizon_hours}{" "}
        h: <strong>{formatProbability(p.probability)}</strong>
      </p>
      {band ? (
        <div
          className="mt-2"
          role="img"
          aria-label={`Stage at the end of the horizon: ${p.p10?.toFixed(2)} to ${p.p90?.toFixed(2)} ${p.unit}, middle ${p.p50?.toFixed(2)}`}
        >
          <div className="relative h-3 rounded bg-line">
            <div
              className="absolute h-3 rounded bg-ocean/30"
              style={{ left: `${band.left}%`, width: `${band.width}%` }}
            />
            <div
              className="absolute h-3 w-0.5 bg-ocean-deep"
              style={{ left: `${band.mid}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Expected stage at {new Date(p.valid_to).toLocaleString()}:{" "}
            {p.p10?.toFixed(2)} to {p.p90?.toFixed(2)} {p.unit} (10th to 90th
            percentile, middle {p.p50?.toFixed(2)}). Axis {axis[0].toFixed(1)}{" "}
            to {axis[1].toFixed(1)} {p.unit}.
          </p>
        </div>
      ) : null}
      <p
        className={`mt-2 text-sm ${cur.stale ? "font-semibold text-src-estimated" : "text-muted"}`}
      >
        {cur.label}
      </p>
      <Provenance p={p} model={model} />
    </li>
  );
}

export function ForecastView({
  predictions,
  models,
  backtests,
  stationName,
}: Props) {
  const now = useNow(60000); // ages keep moving on a page left open
  const modelById = Object.fromEntries(models.map((m) => [m.id, m]));
  const byStation = new Map<string, PredictionRow[]>();
  for (const p of predictions)
    byStation.set(p.station_id, [...(byStation.get(p.station_id) ?? []), p]);
  const lows = predictions
    .map((p) => p.p10)
    .filter((v): v is number => v !== null);
  const highs = predictions
    .map((p) => p.p90)
    .filter((v): v is number => v !== null);
  const axis: [number, number] =
    lows.length && highs.length
      ? [Math.min(...lows), Math.max(...highs)]
      : [0, 1];

  return (
    <>
      <p className="mb-6 rounded-md border border-line bg-white p-3 text-sm">
        These are model outputs, not warnings. No model here has been validated,
        and no accuracy is claimed beyond the backtest scores below, which are
        measured on the data stated. A public warning only ever comes from a
        person approving it.
      </p>
      <Card title="Latest predictions">
        {predictions.length === 0 ? (
          <p className="text-sm text-muted">
            No predictions yet. A station gets predictions when a person has
            registered a model for the organisation, an approved threshold rule
            with a written basis exists, and fresh water-level readings are
            arriving.
          </p>
        ) : (
          [...byStation.entries()].map(([station, rows]) => (
            <div key={station} className="mb-6">
              <h3 className="mb-2 font-bold">
                {stationName[station] ?? "Station"}
              </h3>
              <ul className="space-y-3">
                {rows.map((p) => (
                  <PredictionCard
                    key={p.id}
                    p={p}
                    model={modelById[p.model_version_id]}
                    axis={axis}
                    now={now}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </Card>
      <Card title="Backtests: how each model did on past data">
        {backtests.length === 0 ? (
          <p className="text-sm text-muted">
            No backtests have been run. Until one has, nothing is known about
            how well a model performs.
          </p>
        ) : (
          <ul className="space-y-4">
            {backtests.map((b) => {
              const m = modelById[b.model_version_id];
              return (
                <li key={b.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {m ? `${m.name} ${m.version}` : "Unknown model"} at{" "}
                      {stationName[b.station_id] ?? "station"}
                    </span>
                    {b.is_synthetic ? (
                      <SourceBadge source="synthetic" />
                    ) : (
                      <span className="text-xs font-bold">
                        {originLabel(b.evaluation_origin)}
                      </span>
                    )}
                  </div>
                  {b.is_synthetic ? (
                    <p className="mt-2 rounded border border-src-synthetic/40 bg-src-synthetic/5 p-2 text-sm">
                      Synthetic data. This only tests the software; it says
                      nothing about how the model would do on a real river.
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-muted">
                    Event = water level at or above {b.event_threshold}{" "}
                    {b.event_threshold_unit}. Why: {b.event_basis}. Held-out
                    period {new Date(b.holdout_start).toLocaleDateString()} to{" "}
                    {new Date(b.holdout_end).toLocaleDateString()},{" "}
                    {b.horizon_hours} h ahead, {b.n_forecasts} forecasts.
                  </p>
                  <div className="overflow-x-auto" role="region" aria-label="Measured scores" tabIndex={0}><table className="mt-3 w-full text-sm">
                    <caption className="sr-only">Measured scores</caption>
                    <tbody>
                      <tr>
                        <th
                          scope="row"
                          className="py-1 pr-3 text-left font-semibold"
                        >
                          Detected (POD)
                        </th>
                        <td>
                          {formatScore(b.pod)} ({b.hits} of {b.hits + b.misses}{" "}
                          events)
                        </td>
                      </tr>
                      <tr>
                        <th
                          scope="row"
                          className="py-1 pr-3 text-left font-semibold"
                        >
                          False alarm ratio (FAR)
                        </th>
                        <td>
                          {formatScore(b.far)} ({b.false_alarms} false alarms)
                        </td>
                      </tr>
                      <tr>
                        <th
                          scope="row"
                          className="py-1 pr-3 text-left font-semibold"
                        >
                          Critical success index (CSI)
                        </th>
                        <td>{formatScore(b.csi)}</td>
                      </tr>
                      <tr>
                        <th
                          scope="row"
                          className="py-1 pr-3 text-left font-semibold"
                        >
                          Brier score (lower is better)
                        </th>
                        <td>{formatScore(b.brier, 4)}</td>
                      </tr>
                      <tr>
                        <th
                          scope="row"
                          className="py-1 pr-3 text-left font-semibold"
                        >
                          Median warning lead time
                        </th>
                        <td>{formatLead(b.median_lead_time_s)}</td>
                      </tr>
                      <tr>
                        <th
                          scope="row"
                          className="py-1 pr-3 text-left font-semibold"
                        >
                          Extreme events
                        </th>
                        <td>
                          {b.extreme_events &&
                          b.extreme_events.extreme_threshold !== null
                            ? `${b.extreme_events.detected} of ${b.extreme_events.events} at or above ${b.extreme_events.extreme_threshold} ${b.event_threshold_unit} detected`
                            : "not assessed"}
                        </td>
                      </tr>
                    </tbody>
                  </table></div>
                  {b.reliability && b.reliability.length > 0 ? (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-semibold">
                        Reliability: forecast chance against what happened
                      </summary>
                      <div className="overflow-x-auto" role="region" aria-label="Reliability table" tabIndex={0}><table className="mt-2 w-full text-xs">
                        <thead>
                          <tr>
                            <th className="text-left">Forecast chance</th>
                            <th className="text-left">Forecasts</th>
                            <th className="text-left">Average forecast</th>
                            <th className="text-left">Event happened</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.reliability.map((r) => (
                            <tr key={r.bin_low}>
                              <td>
                                {Math.round(r.bin_low * 100)}% to{" "}
                                {Math.round(r.bin_high * 100)}%
                              </td>
                              <td>{r.n}</td>
                              <td>{formatProbability(r.mean_forecast)}</td>
                              <td>{formatProbability(r.observed_frequency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Registered models">
        {models.length === 0 ? (
          <p className="text-sm text-muted">
            No models are registered for your organisations.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {models.map((m) => (
              <li key={m.id}>
                <strong>
                  {m.name} {m.version}
                </strong>{" "}
                ({m.kind}), trained or tested on: {originLabel(m.data_origin)},
                status: {statusLabel(m.status)}
                {m.evidence_url ? <> , evidence: {m.evidence_url}</> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
