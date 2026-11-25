"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScenarioValidation } from "@/components/scenario-validation";
import { SourceBadge } from "@/components/source-badge";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  GhostButton,
  inputCls,
} from "@/components/ui";
import { DEMO_TERRAIN_LABEL, demoTerrain } from "@/lib/scenario/demo";
import { applyEdits, type TerrainEdit } from "@/lib/scenario/edit";
import { loadElevationTiff } from "@/lib/scenario/geotiff-load";
import {
  LAYER_LABEL,
  hillshade,
  layerScale,
  paintPixels,
  rampColour,
  type Layer,
} from "@/lib/scenario/render";
import {
  runScenario,
  validateInput,
  type Grid,
  type ScenarioInput,
  type ScenarioResult,
} from "@/lib/scenario/solver";

type Terrain = {
  grid: Grid;
  name: string;
  notes: string[];
  isDemo: boolean;
  bbox?: [number, number, number, number];
};

const LABEL = "Modelled scenario. Unvalidated. Not a forecast or warning.";

const COPERNICUS_LICENCE =
  "Free of charge under the Copernicus DEM licence. For adapted data: produced using Copernicus WorldDEM-30. The organisations in charge of the Copernicus programme incur no liability for any use. Provided as is.";

const LIMITS = [
  "No momentum: it cannot model dam breaks, surges or wave fronts.",
  "Weak where water backs up (tidal or tributary backwater).",
  "Storm drains, culverts and bridges are not represented unless you change the terrain yourself.",
  "Depressions are filled so water can drain, so ponding in them is not shown.",
  "Terrain resolution limits everything. Streets, walls and buildings are not resolved at 30 m.",
  "Cells at the edge of the area are unreliable. Draw your area larger than the place you care about.",
  "Rainfall is one constant rate over one duration, with one constant infiltration rate and one roughness value.",
];

function num(s: string): number {
  return s.trim() === "" ? Number.NaN : Number(s);
}

export function ScenarioApp() {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [centre, setCentre] = useState({ lon: "", lat: "", km: "" });
  const [meta, setMeta] = useState({ name: "", licence: "", ref: "" });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [rain, setRain] = useState("");
  const [dur, setDur] = useState("");
  const [infil, setInfil] = useState("");
  const [rough, setRough] = useState("");
  const [chan, setChan] = useState("");
  const [minSlope, setMinSlope] = useState("0.001");
  const [half, setHalf] = useState("15");

  const [edits, setEdits] = useState<TerrainEdit[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
  const [editWidth, setEditWidth] = useState("");
  const [editDelta, setEditDelta] = useState("");
  const [editLabel, setEditLabel] = useState("");

  const [base, setBase] = useState<ScenarioResult | null>(null);
  const [mitigated, setMitigated] = useState<ScenarioResult | null>(null);
  const [view, setView] = useState<"base" | "mitigated">("base");
  const [layer, setLayer] = useState<Layer>("depth");
  const [minDepth, setMinDepth] = useState("0.1");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);

  const canvas = useRef<HTMLCanvasElement>(null);

  const editedGrid = useMemo(
    () =>
      terrain && edits.length > 0 ? applyEdits(terrain.grid, edits) : null,
    [terrain, edits],
  );
  const shownGrid =
    view === "mitigated" && editedGrid ? editedGrid : (terrain?.grid ?? null);
  const shade = useMemo(
    () => (shownGrid ? hillshade(shownGrid) : null),
    [shownGrid],
  );
  const result = view === "mitigated" && mitigated ? mitigated : base;
  const minD = Math.max(0, num(minDepth) || 0);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !shownGrid || !shade) return;
    c.width = shownGrid.nx;
    c.height = shownGrid.ny;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const scale = result ? layerScale(result, layer, minD) : null;
    const px = paintPixels(shade, result, layer, minD, scale);
    ctx.putImageData(
      new ImageData(
        px as unknown as Uint8ClampedArray<ArrayBuffer>,
        shownGrid.nx,
        shownGrid.ny,
      ),
      0,
      0,
    );
    const line = (
      pts: { x: number; y: number }[],
      colour: string,
      w: number,
    ) => {
      if (pts.length === 0) return;
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = Math.max(1, w);
      ctx.beginPath();
      pts.forEach((p, i) =>
        i === 0
          ? ctx.moveTo(p.x + 0.5, p.y + 0.5)
          : ctx.lineTo(p.x + 0.5, p.y + 0.5),
      );
      ctx.stroke();
      for (const p of pts) ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    };
    for (const e of edits)
      line(
        e.points,
        e.deltaM >= 0 ? "#c0392b" : "#0e7f7a",
        e.widthM / shownGrid.cellSizeM,
      );
    line(draft, "#111", 1);
  }, [shownGrid, shade, result, layer, minD, edits, draft]);

  async function useDemo() {
    setLoadError("");
    setBase(null);
    setMitigated(null);
    setEdits([]);
    setTerrain({
      grid: demoTerrain(),
      name: DEMO_TERRAIN_LABEL,
      notes: [],
      isDemo: true,
    });
  }

  async function loadFile() {
    setLoadError("");
    if (!file) return setLoadError("Choose a GeoTIFF elevation file first.");
    if (!meta.name.trim() || !meta.licence.trim() || !meta.ref.trim())
      return setLoadError(
        "Fill in the dataset name, its licence and where and when you got it. They are recorded with every result.",
      );
    const anyCentre =
      centre.lon !== "" || centre.lat !== "" || centre.km !== "";
    if (
      anyCentre &&
      [centre.lon, centre.lat, centre.km].some((v) => !Number.isFinite(num(v)))
    )
      return setLoadError(
        "To pick an area, fill in longitude, latitude and half-width in km, or leave all three blank.",
      );
    setLoading(true);
    try {
      const t = await loadElevationTiff(file, {
        maxSide: 800,
        centre: anyCentre
          ? {
              lon: num(centre.lon),
              lat: num(centre.lat),
              halfWidthKm: num(centre.km),
            }
          : undefined,
      });
      setBase(null);
      setMitigated(null);
      setEdits([]);
      setTerrain({
        grid: t.grid,
        name: meta.name.trim(),
        notes: t.notes,
        isDemo: false,
        bbox: t.bbox,
      });
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not read that file.",
      );
    } finally {
      setLoading(false);
    }
  }

  function currentInput(): ScenarioInput {
    return {
      rainMmPerHour: num(rain),
      durationHours: num(dur),
      infiltrationMmPerHour: num(infil),
      manningN: num(rough),
      channelAreaKm2: num(chan),
      minSlope: num(minSlope),
      transectHalfWidthCells: num(half),
    };
  }

  function run() {
    setRunError("");
    if (!terrain) return setRunError("Not assessed. Load terrain data first.");
    const input = currentInput();
    const errs = validateInput(input);
    if (errs.length > 0) return setRunError(errs.join(". ") + ".");
    setRunning(true);
    // Let the "Running" state paint before the calculation blocks the page.
    setTimeout(() => {
      try {
        const b = runScenario(terrain.grid, input);
        setBase(b);
        setMitigated(editedGrid ? runScenario(editedGrid, input) : null);
        setView("base");
      } catch (e) {
        setRunError(e instanceof Error ? e.message : "The run failed.");
      } finally {
        setRunning(false);
      }
    }, 30);
  }

  function cellAt(ev: React.MouseEvent<HTMLCanvasElement>) {
    const c = canvas.current;
    if (!c || !shownGrid) return null;
    const r = c.getBoundingClientRect();
    const x = Math.min(
      shownGrid.nx - 1,
      Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * shownGrid.nx)),
    );
    const y = Math.min(
      shownGrid.ny - 1,
      Math.max(0, Math.floor(((ev.clientY - r.top) / r.height) * shownGrid.ny)),
    );
    return { x, y };
  }

  function onCanvasClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    const p = cellAt(ev);
    if (!p) return;
    if (drawing) setDraft((d) => [...d, p]);
    else setProbe(p);
  }

  function finishEdit() {
    setRunError("");
    const w = num(editWidth);
    const d = num(editDelta);
    if (draft.length < 1)
      return setRunError(
        "Click at least one point on the map to place the change.",
      );
    if (!(w > 0) || !Number.isFinite(d) || d === 0)
      return setRunError(
        "Give the width (m, above 0) and the elevation change (m, not 0) for this change.",
      );
    setEdits((e) => [
      ...e,
      {
        points: draft,
        widthM: w,
        deltaM: d,
        label:
          editLabel.trim() || (d > 0 ? "Raised terrain" : "Lowered terrain"),
      },
    ]);
    setDraft([]);
    setDrawing(false);
    setMitigated(null);
  }

  const probeInfo = useMemo(() => {
    if (!probe || !shownGrid) return null;
    const i = probe.y * shownGrid.nx + probe.x;
    return {
      x: probe.x,
      y: probe.y,
      z: shownGrid.z[i]!,
      depth: result?.depthM[i],
      vel: result?.velocityMs[i],
      ttp: result?.timeToPeakH[i],
      q: result?.peakDischargeM3s[i],
    };
  }, [probe, shownGrid, result]);

  const scale = result ? layerScale(result, layer, minD) : null;
  const legend = [0, 0.25, 0.5, 0.75, 1].map((t) => rampColour(layer, t));

  return (
    <div>
      <p
        role="note"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8c9f0] bg-[#f7f3fd] p-3 text-sm font-semibold"
      >
        <SourceBadge source="synthetic" />
        <span>{LABEL}</span>
        <span className="font-normal text-muted">
          Results come from typed-in what-if rainfall. Nothing here feeds
          alerts, station status or public messages, and nothing is saved or
          exported.
        </span>
      </p>

      <Card title="1. Terrain">
        {terrain ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-semibold">{terrain.name}</span> —{" "}
              {terrain.grid.nx} × {terrain.grid.ny} cells,{" "}
              {Math.round(terrain.grid.cellSizeM)} m each (
              {((terrain.grid.nx * terrain.grid.cellSizeM) / 1000).toFixed(1)} ×{" "}
              {((terrain.grid.ny * terrain.grid.cellSizeM) / 1000).toFixed(1)}{" "}
              km).
            </p>
            {terrain.notes.map((n) => (
              <p key={n} className="text-muted">
                {n}
              </p>
            ))}
            <GhostButton
              onClick={() => {
                setTerrain(null);
                setBase(null);
                setMitigated(null);
                setEdits([]);
              }}
            >
              Load different terrain
            </GhostButton>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Not assessed. Load terrain to run a scenario. Elevation comes only
              from data you load, with its source and licence recorded.
            </p>
            <div className="rounded-lg border border-line p-3">
              <h3 className="font-bold">Try it on invented terrain</h3>
              <p className="mb-2 text-sm text-muted">
                A made-up valley system for learning the tool. It is not a real
                place.
              </p>
              <Button type="button" onClick={useDemo}>
                Use demo terrain
              </Button>
            </div>
            <div className="rounded-lg border border-line p-3">
              <h3 className="mb-2 font-bold">Load a GeoTIFF elevation file</h3>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Elevation file (.tif)
                  </span>
                  <input
                    type="file"
                    accept=".tif,.tiff,image/tiff"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-[#b9cad8] file:bg-white file:px-3 file:py-2 file:font-semibold hover:file:border-ocean"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Area centre longitude (optional)"
                    inputMode="decimal"
                    value={centre.lon}
                    onChange={(e) =>
                      setCentre({ ...centre, lon: e.target.value })
                    }
                  />
                  <Field
                    label="Area centre latitude (optional)"
                    inputMode="decimal"
                    value={centre.lat}
                    onChange={(e) =>
                      setCentre({ ...centre, lat: e.target.value })
                    }
                  />
                  <Field
                    label="Half-width in km (optional)"
                    inputMode="decimal"
                    value={centre.km}
                    onChange={(e) =>
                      setCentre({ ...centre, km: e.target.value })
                    }
                  />
                </div>
                <p className="text-xs text-muted">
                  Leave the area blank to use the whole file. Large areas are
                  resampled to at most 800 × 800 cells.
                </p>
                <Field
                  label="Dataset name"
                  value={meta.name}
                  onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                />
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Licence and attribution
                  </span>
                  <textarea
                    rows={3}
                    value={meta.licence}
                    onChange={(e) =>
                      setMeta({ ...meta, licence: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <Field
                  label="Where and when you got it (link and date)"
                  value={meta.ref}
                  onChange={(e) => setMeta({ ...meta, ref: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  <GhostButton
                    type="button"
                    onClick={() =>
                      setMeta((m) => ({
                        ...m,
                        name: "Copernicus DEM GLO-30",
                        licence: COPERNICUS_LICENCE,
                      }))
                    }
                  >
                    Fill in for Copernicus DEM GLO-30
                  </GhostButton>
                  <Button type="button" onClick={loadFile} disabled={loading}>
                    {loading ? "Reading…" : "Load terrain"}
                  </Button>
                </div>
                <ErrorNote>{loadError}</ErrorNote>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="2. Rainfall and ground">
        <p className="mb-3 text-sm text-muted">
          You type every value. None is assumed. Use values from your own
          analysis or an official source and keep a note of where they came
          from.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Rainfall intensity (mm per hour)"
            inputMode="decimal"
            value={rain}
            onChange={(e) => setRain(e.target.value)}
          />
          <Field
            label="Rainfall duration (hours)"
            inputMode="decimal"
            value={dur}
            onChange={(e) => setDur(e.target.value)}
          />
          <Field
            label="Infiltration (mm per hour, 0 if none)"
            inputMode="decimal"
            value={infil}
            onChange={(e) => setInfil(e.target.value)}
          />
          <Field
            label="Manning roughness n"
            inputMode="decimal"
            value={rough}
            onChange={(e) => setRough(e.target.value)}
          />
          <Field
            label="Channel threshold (upstream area, km²)"
            inputMode="decimal"
            value={chan}
            onChange={(e) => setChan(e.target.value)}
          />
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            Numerical settings
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field
              label="Minimum slope on flat ground (m/m)"
              inputMode="decimal"
              value={minSlope}
              onChange={(e) => setMinSlope(e.target.value)}
            />
            <Field
              label="Cross-section half-width (cells)"
              inputMode="numeric"
              value={half}
              onChange={(e) => setHalf(e.target.value)}
            />
          </div>
          <p className="mt-2 text-muted">
            These keep the maths stable. Results on flat ground depend on the
            minimum slope, and spreading stops at the cross-section edge.
          </p>
        </details>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={run} disabled={running || !terrain}>
            {running
              ? "Running…"
              : edits.length > 0
                ? "Run with and without changes"
                : "Run scenario"}
          </Button>
          {!terrain ? (
            <span className="text-sm text-muted">Load terrain first.</span>
          ) : null}
        </div>
        <div className="mt-3">
          <ErrorNote>{runError}</ErrorNote>
        </div>
      </Card>

      {terrain ? (
        <Card title="3. Map">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">Layer</span>
              <select
                value={layer}
                onChange={(e) => setLayer(e.target.value as Layer)}
                className={inputCls}
                disabled={!result}
              >
                {(Object.keys(LAYER_LABEL) as Layer[]).map((l) => (
                  <option key={l} value={l}>
                    {LAYER_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">
                Show cells deeper than (m)
              </span>
              <input
                value={minDepth}
                inputMode="decimal"
                onChange={(e) => setMinDepth(e.target.value)}
                className={`${inputCls} w-32`}
              />
            </label>
            {mitigated ? (
              <div
                role="group"
                aria-label="Terrain version"
                className="flex gap-1 rounded-lg border border-line p-1"
              >
                {(["base", "mitigated"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`min-h-10 rounded-md px-3 text-sm font-semibold ${view === v ? "bg-ocean text-white" : "hover:bg-mist"}`}
                  >
                    {v === "base" ? "Original terrain" : "With changes"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <canvas
            ref={canvas}
            onClick={onCanvasClick}
            role="img"
            aria-label={
              result
                ? `Map of ${LAYER_LABEL[layer]}. ${LABEL}`
                : "Relief map of the loaded terrain. No scenario has been run."
            }
            className={`block h-auto w-full max-w-3xl rounded-lg border border-line bg-mist [image-rendering:pixelated] ${drawing ? "cursor-crosshair" : "cursor-pointer"}`}
          />
          <p className="mt-2 text-xs font-semibold">
            {LABEL}{" "}
            {terrain.isDemo ? DEMO_TERRAIN_LABEL : `Terrain: ${terrain.name}.`}
          </p>
          {result && scale ? (
            <div className="mt-2 max-w-xs text-xs">
              <div
                className="h-3 rounded"
                style={{
                  background: `linear-gradient(to right, ${legend.map((c) => `rgb(${c.join(",")})`).join(",")})`,
                }}
                aria-hidden="true"
              />
              <div className="mt-1 flex justify-between">
                <span>0</span>
                <span>
                  {scale.max.toFixed(scale.max < 10 ? 2 : 0)}{" "}
                  {LAYER_LABEL[layer].match(/\(([^)]+)\)/)?.[1]}
                </span>
              </div>
            </div>
          ) : null}
          {probeInfo ? (
            <p className="mt-2 text-sm" aria-live="polite">
              Cell {probeInfo.x}, {probeInfo.y}: ground{" "}
              {Number.isNaN(probeInfo.z)
                ? "no data"
                : `${probeInfo.z.toFixed(1)} m`}
              {probeInfo.depth !== undefined
                ? ` · depth ${probeInfo.depth.toFixed(2)} m · speed ${probeInfo.vel!.toFixed(2)} m/s · time to peak ${probeInfo.ttp!.toFixed(1)} h · peak discharge ${probeInfo.q!.toFixed(1)} m³/s`
                : ""}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Click the map to read the values for a cell.
            </p>
          )}
        </Card>
      ) : null}

      {terrain ? (
        <Card title="4. Test a change to the terrain">
          <p className="mb-3 text-sm text-muted">
            Sketch a barrier (raise) or a channel or basin (lower) and see how
            the scenario changes. Click points along the line on the map, set
            its width and height, then add it. Run again to compare. This
            changes the terrain model only; it is not a design.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Width of the strip (m)"
              inputMode="decimal"
              value={editWidth}
              onChange={(e) => setEditWidth(e.target.value)}
            />
            <Field
              label="Height change (m, minus to lower)"
              inputMode="decimal"
              value={editDelta}
              onChange={(e) => setEditDelta(e.target.value)}
            />
            <Field
              label="Name (optional)"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <GhostButton
              type="button"
              onClick={() => {
                setDrawing(!drawing);
                setDraft([]);
              }}
            >
              {drawing ? "Stop placing points" : "Place points on the map"}
            </GhostButton>
            <GhostButton
              type="button"
              onClick={() => setDraft((d) => d.slice(0, -1))}
              disabled={draft.length === 0}
            >
              Undo point
            </GhostButton>
            <Button
              type="button"
              onClick={finishEdit}
              disabled={draft.length === 0}
            >
              Add this change
            </Button>
          </div>
          {drawing ? (
            <p className="mt-2 text-sm" aria-live="polite">
              Placing points: {draft.length} placed. Click the map.
            </p>
          ) : null}
          {edits.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {edits.map((e, i) => (
                <li
                  key={`${e.label}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2"
                >
                  <span>
                    {e.label}: {e.deltaM > 0 ? "+" : ""}
                    {e.deltaM} m, {e.widthM} m wide, {e.points.length} point
                    {e.points.length === 1 ? "" : "s"}
                  </span>
                  <GhostButton
                    type="button"
                    onClick={() => {
                      setEdits((x) => x.filter((_, j) => j !== i));
                      setMitigated(null);
                      setView("base");
                    }}
                  >
                    Remove
                  </GhostButton>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {base ? (
        <Card title="5. Results">
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Scenario results table"
            tabIndex={0}
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Scenario summary. {LABEL}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3">
                    Measure
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Original terrain
                  </th>
                  {mitigated ? (
                    <th scope="col" className="py-2 pr-3">
                      With changes
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [
                      "Area deeper than 0.01 m (km²)",
                      (r: ScenarioResult) => r.stats.wetAreaKm2.toFixed(2),
                    ],
                    [
                      "Greatest depth (m)",
                      (r: ScenarioResult) => r.stats.maxDepthM.toFixed(2),
                    ],
                    [
                      "Greatest flow speed (m/s)",
                      (r: ScenarioResult) => r.stats.maxVelocityMs.toFixed(2),
                    ],
                    [
                      "Greatest peak discharge (m³/s)",
                      (r: ScenarioResult) =>
                        r.stats.maxPeakDischargeM3s.toFixed(1),
                    ],
                    [
                      "Channel cells",
                      (r: ScenarioResult) => String(r.stats.channelCells),
                    ],
                  ] as const
                ).map(([name, f]) => (
                  <tr key={name} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {name}
                    </th>
                    <td className="py-2 pr-3">{f(base)}</td>
                    {mitigated ? (
                      <td className="py-2 pr-3">{f(mitigated)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {[...new Set([...base.warnings, ...(mitigated?.warnings ?? [])])].map(
            (w) => (
              <p key={w} className="mt-2 text-sm text-muted">
                {w}
              </p>
            ),
          )}
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">
              Settings used for this run
            </summary>
            <ul className="mt-2 list-disc pl-5">
              <li>
                Terrain: {terrain?.name}
                {terrain && !terrain.isDemo
                  ? ` (${meta.licence.slice(0, 120)}…; ${meta.ref})`
                  : ""}
              </li>
              <li>
                Rainfall {base.settings.rainMmPerHour} mm/h for{" "}
                {base.settings.durationHours} h; infiltration{" "}
                {base.settings.infiltrationMmPerHour} mm/h
              </li>
              <li>
                Manning n {base.settings.manningN}; channel threshold{" "}
                {base.settings.channelAreaKm2} km²
              </li>
              <li>
                Minimum slope {base.settings.minSlope}; cross-section half-width{" "}
                {base.settings.transectHalfWidthCells} cells
              </li>
              <li>Terrain edits: {edits.length}</li>
            </ul>
          </details>
          <p className="mt-3 text-sm font-semibold">
            Not validated: no result here has been checked against a recorded
            flood. Section 5 only shows differences for points you enter.
          </p>
        </Card>
      ) : null}

      {shownGrid && result ? (
        <ScenarioValidation grid={shownGrid} result={result} probe={probe} />
      ) : null}

      <Card title="What this model cannot do">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          The method is a simplified steady-state approach written for
          HydroSight from published work. It is not FastFlood and has not been
          checked against real floods. See docs/SCENARIO_MODEL.md.
        </p>
      </Card>
    </div>
  );
}
