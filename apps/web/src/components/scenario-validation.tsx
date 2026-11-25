"use client";
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  GhostButton,
  inputCls,
} from "@/components/ui";
import type { Grid, ScenarioResult } from "@/lib/scenario/solver";
import {
  comparePoints,
  validateEvent,
  type ObservedPoint,
} from "@/lib/scenario/validate";

function num(s: string): number {
  return s.trim() === "" ? Number.NaN : Number(s);
}

/**
 * Compares the shown scenario with points from a real flood event the owner can document.
 * Nothing is saved. It shows differences only and makes no accuracy claim.
 */
export function ScenarioValidation({
  grid,
  result,
  probe,
}: {
  grid: Grid;
  result: ScenarioResult;
  probe: { x: number; y: number } | null;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [points, setPoints] = useState<ObservedPoint[]>([]);
  const [label, setLabel] = useState("");
  const [wet, setWet] = useState<"wet" | "dry">("wet");
  const [obsDepth, setObsDepth] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  function addPoint() {
    setError("");
    if (!probe)
      return setError("Click the map first to choose the cell for this point.");
    const d = num(obsDepth);
    if (obsDepth.trim() !== "" && !(d >= 0))
      return setError("Observed depth must be 0 or more, or left blank.");
    setPoints((p) => [
      ...p,
      {
        x: probe.x,
        y: probe.y,
        label: label.trim() || `Point ${p.length + 1}`,
        wet: wet === "wet",
        depthM: obsDepth.trim() === "" ? undefined : d,
      },
    ]);
    setLabel("");
    setObsDepth("");
    setShown(false);
  }

  const t = num(threshold);
  const comparison = useMemo(() => {
    if (!shown) return null;
    return comparePoints(
      result.depthM,
      grid.nx,
      grid.ny,
      (i) => !Number.isNaN(grid.z[i]!),
      points,
      t,
    );
  }, [shown, result, grid, points, t]);

  function compare() {
    const errs = validateEvent({ name, date, evidence, confirmed, points }, t);
    if (errs.length > 0) {
      setShown(false);
      return setError(errs.join(". ") + ".");
    }
    setError("");
    setShown(true);
  }

  return (
    <Card title="5. Compare with a real flood">
      <p className="mb-3 text-sm text-muted">
        Enter places where a real flood was recorded, with the evidence. The
        page shows where the scenario and the record differ. Nothing is saved,
        and this does not make the model validated: one event and a few points
        cannot show that.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Event name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Event date (yyyy-mm-dd)"
          value={date}
          placeholder="2024-05-02"
          onChange={(e) => setDate(e.target.value)}
        />
        <Field
          label="Evidence (link or reference)"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked);
            setShown(false);
          }}
        />
        <span>
          I confirm this is a real event and I can show the evidence above.
        </span>
      </label>
      <div className="mt-3 max-w-xs">
        <Field
          label="A cell counts as wet from this depth (m)"
          inputMode="decimal"
          value={threshold}
          onChange={(e) => {
            setThreshold(e.target.value);
            setShown(false);
          }}
        />
      </div>

      <h3 className="mt-5 text-base font-bold">Observed points</h3>
      <p className="mb-2 text-sm text-muted">
        {probe
          ? `Selected cell on the map: ${probe.x}, ${probe.y}.`
          : "Click the map above to select a cell."}
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field
          label="Name of the place"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">
            Was it under water?
          </span>
          <select
            className={inputCls}
            value={wet}
            onChange={(e) => setWet(e.target.value as "wet" | "dry")}
          >
            <option value="wet">Yes, flooded</option>
            <option value="dry">No, stayed dry</option>
          </select>
        </label>
        <Field
          label="Observed depth (m, optional)"
          inputMode="decimal"
          value={obsDepth}
          onChange={(e) => setObsDepth(e.target.value)}
        />
        <div className="flex items-end">
          <Button type="button" onClick={addPoint}>
            Add point
          </Button>
        </div>
      </div>

      {points.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
          {points.map((p, i) => (
            <li
              key={`${p.label}-${i}`}
              className="flex items-center justify-between gap-2 p-2"
            >
              <span>
                {p.label} (cell {p.x}, {p.y}):{" "}
                {p.wet ? "flooded" : "stayed dry"}
                {p.depthM !== undefined ? `, ${p.depthM} m` : ""}
              </span>
              <GhostButton
                type="button"
                onClick={() => {
                  setPoints((all) => all.filter((_, j) => j !== i));
                  setShown(false);
                }}
              >
                Remove
              </GhostButton>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <Button type="button" onClick={compare}>
          Compare with the scenario
        </Button>
      </div>
      <div className="mt-3">
        <ErrorNote>{error}</ErrorNote>
      </div>

      {comparison ? (
        <div className="mt-4" aria-live="polite">
          <p className="text-sm font-semibold">
            Modelled scenario compared with {name.trim()} ({date}). Unvalidated.
            Not a forecast or warning.
          </p>
          <div
            className="mt-2 overflow-x-auto"
            role="region"
            aria-label="Comparison table"
            tabIndex={0}
          >
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-1 pr-3">Place</th>
                  <th className="py-1 pr-3">Observed</th>
                  <th className="py-1 pr-3">Scenario depth (m)</th>
                  <th className="py-1 pr-3">Match</th>
                  <th className="py-1">Depth difference (m)</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-1 pr-3">{r.point.label}</td>
                    <td className="py-1 pr-3">
                      {r.point.wet ? "Flooded" : "Dry"}
                      {r.point.depthM !== undefined
                        ? `, ${r.point.depthM} m`
                        : ""}
                    </td>
                    <td className="py-1 pr-3">
                      {r.modelledDepthM === undefined
                        ? "Not assessed (no terrain data)"
                        : r.modelledDepthM.toFixed(2)}
                    </td>
                    <td className="py-1 pr-3">
                      {r.agrees === undefined
                        ? "Not assessed"
                        : r.agrees
                          ? "Same"
                          : r.point.wet
                            ? "Differs: scenario dry"
                            : "Differs: scenario wet"}
                    </td>
                    <td className="py-1">
                      {r.depthErrorM === undefined
                        ? "n/a"
                        : `${r.depthErrorM > 0 ? "+" : ""}${r.depthErrorM.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm">
            {comparison.counts.agree} of {comparison.counts.compared} compared
            points are the same wet or dry.{" "}
            {comparison.counts.observedWetModelledDry} flooded in the record but
            are dry in the scenario; {comparison.counts.observedDryModelledWet}{" "}
            stayed dry in the record but are wet in the scenario.{" "}
            {comparison.counts.noData > 0
              ? `${comparison.counts.noData} not assessed. `
              : ""}
            {comparison.depth.pairs > 0
              ? `Depth: ${comparison.depth.pairs} point(s) with both values, average difference ${comparison.depth.meanErrorM!.toFixed(2)} m, average size of difference ${comparison.depth.meanAbsErrorM!.toFixed(2)} m.`
              : "No observed depths were entered."}
          </p>
          <p className="mt-2 text-sm text-muted">
            This is a comparison of {comparison.counts.points} point(s) from one
            event. It is not a measure of accuracy and does not validate the
            model. The scenario also has to use the rainfall and terrain of that
            event for the comparison to mean anything.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
