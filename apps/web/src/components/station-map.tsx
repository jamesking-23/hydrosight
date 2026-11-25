"use client";
import type { Geometry } from "geojson";
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";

// The worker is served from /vendor (see scripts/copy-maplibre-worker.mjs).
setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_TYPES, SourceBadge, type SourceType } from "@/components/source-badge";
import { inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { describeSignals, reportsToGeoJSON, type CommunityMapReport } from "@/lib/community";
import {
  FRESHNESS_LABELS,
  SENSOR_LABELS,
  boundsOf,
  classifyFreshness,
  describeAge,
  filterStations,
  forecastTotalMm,
  geojsonCollection,
  riverNames,
  stationsToGeoJSON,
  type ForecastRow,
  type Freshness,
  type StationRow,
} from "@/lib/stations";

type Geo = { id: string; name: string; geojson: Geometry }[];
export interface GeoImportInfo {
  kind: string;
  source: string;
  licence: string;
  source_type: string;
}
interface SensorRow {
  sensor_id: string;
  kind: string;
  unit: string;
  expected_interval_s: number;
  source_type: SourceType;
  last_observed_at: string | null;
  last_value: number | null;
}

const FRESHNESS_STYLE: Record<Freshness, string> = {
  live: "border-[#9ccf9f] bg-[#e8f6e9] text-[#1f5a23]",
  stale: "border-[#e8d48a] bg-[#fff6d6] text-[#5c4a05]",
  offline: "border-[#e3a3a3] bg-[#fdeaea] text-[#8a1f1f]",
  never_reported: "border-line bg-[#f3f5f7] text-muted",
};

function FreshnessChip({ sensor, now }: { sensor: SensorRow; now: number }) {
  const f = classifyFreshness(sensor.last_observed_at, sensor.expected_interval_s, now);
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${FRESHNESS_STYLE[f]}`} data-freshness={f}>
      {FRESHNESS_LABELS[f]}
    </span>
  );
}

/** A value is shown as current only while the sensor is live; otherwise it is labelled as the
 * last reading with its age (rule 6). */
function latestValue(s: SensorRow, now: number): string {
  if (s.last_observed_at === null || s.last_value === null) return "—";
  const f = classifyFreshness(s.last_observed_at, s.expected_interval_s, now);
  const v = `${s.last_value} ${s.unit}`;
  return f === "live" ? v : `${v} (last reading, ${describeAge(s.last_observed_at, now)}; not current)`;
}

function ForecastBlock({ state, now }: { state: { rows: ForecastRow[]; error: string } | null; now: number }) {
  if (!state) return <p className="mt-4 text-sm text-muted" role="status">Loading forecast…</p>;
  if (state.error) return <p role="alert" className="mt-4 text-sm text-src-synthetic">Could not load forecast: {state.error}</p>;
  const total = forecastTotalMm(state.rows, now, 24);
  const first = state.rows[0];
  if (total === null || !first) return <p className="mt-4 text-sm text-muted">No forecast has been loaded for this station.</p>;
  return (
    <div className="mt-4 rounded-lg border border-line p-3 text-sm">
      <div className="flex items-center gap-2">
        <SourceBadge source="forecast" />
        <strong>Rain forecast, next 24 h: {total} mm</strong>
      </div>
      <p className="mt-1 text-muted">
        {first.model}, issued {describeAge(first.issued_at, now)}. Weather data: MET Norway ({first.provider_licence}). Advisory only until validated for this area.
      </p>
    </div>
  );
}

const COLORS: Record<SourceType, string> = {
  measured: "#2f7a33",
  estimated: "#8a6d0e",
  forecast: "#1b5e9b",
  community: "#7a4aa8",
  synthetic: "#b3261e",
};
const UGANDA: [number, number, number, number] = [29.5, -1.5, 35.1, 4.3];

export function StationMap({
  stations,
  rivers,
  catchments,
  imports,
  reports = [],
}: {
  reports?: CommunityMapReport[];
  stations: StationRow[];
  rivers: Geo;
  catchments: Geo;
  imports: GeoImportInfo[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [query, setQuery] = useState("");
  const [river, setRiver] = useState("");
  const [sources, setSources] = useState<Set<SourceType>>(new Set());
  const [layers, setLayers] = useState({ basemap: true, stations: true, rivers: true, catchments: true, reports: true });
  const [selectedReport, setSelectedReport] = useState<CommunityMapReport | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sensorResult, setSensorResult] = useState<{ id: string; rows: SensorRow[]; error: string } | null>(null);

  const visible = useMemo(() => filterStations(stations, { query, sources, river }), [stations, query, sources, river]);
  const selected = stations.find((s) => s.id === selectedId) ?? null;
  // results for a previously selected station are ignored, so a stale list is never shown
  const [forecastResult, setForecastResult] = useState<{ id: string; rows: ForecastRow[]; error: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const forecastState = forecastResult && forecastResult.id === selectedId ? forecastResult : null;
  const sensorState = sensorResult && sensorResult.id === selectedId ? sensorResult : null;
  const sensors = sensorState && !sensorState.error ? sensorState.rows : null;
  const sensorError = sensorState?.error ?? "";

  // create the map once
  useEffect(() => {
    if (!el.current) return;
    const map = new MapLibreMap({
      container: el.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      bounds: UGANDA,
      fitBoundsOptions: { padding: 20 },
      attributionControl: false,
    });
    map.addControl(
      new AttributionControl({
        compact: false,
        customAttribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
      }),
    );
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("error", (e) => {
      if ((e as { sourceId?: string }).sourceId === "osm") setTileError(true);
    });
    map.on("style.load", () => {
      map.addSource("catchments", { type: "geojson", data: geojsonCollection(catchments) });
      map.addSource("rivers", { type: "geojson", data: geojsonCollection(rivers) });
      map.addSource("stations", { type: "geojson", data: stationsToGeoJSON(stations) });
      map.addLayer({ id: "catchments-fill", type: "fill", source: "catchments", paint: { "fill-color": "#1b5e9b", "fill-opacity": 0.08 } });
      map.addLayer({ id: "catchments-line", type: "line", source: "catchments", paint: { "line-color": "#1b5e9b", "line-width": 1.5, "line-dasharray": [3, 2] } });
      map.addLayer({ id: "rivers-line", type: "line", source: "rivers", paint: { "line-color": "#1b5e9b", "line-width": 2.5 } });
      map.addLayer({
        id: "stations-circle",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": 9,
          "circle-color": ["match", ["get", "source_type"], ...Object.entries(COLORS).flat(), "#4a6176"] as unknown as ExpressionSpecification,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
        },
      });
      map.addLayer({
        id: "stations-selected",
        type: "circle",
        source: "stations",
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#0b1f33", "circle-stroke-width": 3 },
      });
      map.addSource("reports", { type: "geojson", data: reportsToGeoJSON(reports) });
      // Community reports: purple ring, hollow centre, so they never look like a station measurement.
      map.addLayer({
        id: "reports-circle",
        type: "circle",
        source: "reports",
        paint: {
          "circle-radius": 8,
          "circle-color": "rgba(255,255,255,0.85)",
          "circle-stroke-color": COLORS.community,
          "circle-stroke-width": 3,
        },
      });
      map.on("click", "reports-circle", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        setSelectedReport(reports.find((r) => r.id === id) ?? null);
      });
      map.on("mouseenter", "reports-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "reports-circle", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "stations-circle", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) setSelectedId(id);
      });
      map.on("mouseenter", "stations-circle", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "stations-circle", () => (map.getCanvas().style.cursor = ""));
      const b = boundsOf(stations);
      if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, maxZoom: 9, duration: 0 });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // the map is created once; data updates are handled by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // filters -> map data
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("stations") as GeoJSONSource).setData(stationsToGeoJSON(visible));
  }, [visible, ready]);

  // layer panel -> visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    map.setLayoutProperty("osm", "visibility", vis(layers.basemap));
    map.setLayoutProperty("stations-circle", "visibility", vis(layers.stations));
    map.setLayoutProperty("stations-selected", "visibility", vis(layers.stations));
    map.setLayoutProperty("rivers-line", "visibility", vis(layers.rivers));
    map.setLayoutProperty("catchments-fill", "visibility", vis(layers.catchments));
    map.setLayoutProperty("catchments-line", "visibility", vis(layers.catchments));
    map.setLayoutProperty("reports-circle", "visibility", vis(layers.reports));
  }, [layers, ready]);

  // selection -> highlight, fly, load sensors
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map) {
      map.setFilter("stations-selected", ["==", ["get", "id"], selectedId ?? ""]);
      if (selected) map.flyTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 9), duration: 600 });
    }
    if (!selectedId) return;
    let cancelled = false;
    const sb = createClient();
    sb.from("sensor_status")
      .select("sensor_id, kind, unit, expected_interval_s, source_type, last_observed_at, last_value")
      .eq("station_id", selectedId)
      .order("kind")
      .then(({ data, error }) => {
        if (cancelled) return;
        setSensorResult({ id: selectedId, rows: (data ?? []) as SensorRow[], error: error?.message ?? "" });
      });
    sb.from("forecast_latest")
      .select("valid_at, value, issued_at, model, provider_licence")
      .eq("station_id", selectedId)
      .order("valid_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        setForecastResult({ id: selectedId, rows: (data ?? []) as ForecastRow[], error: error?.message ?? "" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  const toggleSource = (s: SourceType) =>
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const rivers_ = riverNames(stations);

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <aside className="space-y-5" aria-label="Map controls">
        <div>
          <label htmlFor="station-search" className="mb-1 block text-sm font-semibold">Search stations</label>
          <input id="station-search" type="search" className={inputCls} placeholder="Name, code or river"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Filter by source</legend>
          <div className="flex flex-wrap gap-2">
            {SOURCE_TYPES.map((s) => (
              <button key={s} type="button" aria-pressed={sources.has(s)} onClick={() => toggleSource(s)}
                className={`rounded-full ${sources.has(s) ? "ring-2 ring-ink" : "opacity-70 hover:opacity-100"}`}>
                <SourceBadge source={s} />
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="river-filter" className="mb-1 block text-sm font-semibold">River</label>
          <select id="river-filter" className={inputCls} value={river} onChange={(e) => setRiver(e.target.value)}>
            <option value="">All rivers</option>
            {rivers_.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Layers</legend>
          {([
            ["basemap", "Base map (OpenStreetMap)"],
            ["stations", `Stations (${visible.length} of ${stations.length})`],
            ["rivers", rivers.length ? `Rivers (${rivers.length})` : "Rivers: no geometry loaded yet"],
            ["catchments", catchments.length ? `Catchments (${catchments.length})` : "Catchments: none loaded yet"],
            ["reports", `Community reports, unverified (${reports.length}, last 72 h)`],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 py-1.5 text-sm">
              <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          {imports.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {imports.map((i, n) => (
                <li key={n}>{i.kind}: {i.source} (licence: {i.licence})</li>
              ))}
            </ul>
          ) : null}
        </fieldset>
        {selectedReport ? (
          <section aria-label="Selected community report" className="rounded-lg border border-line p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-bold">{selectedReport.kind.replaceAll("_", " ")}</span>
              <SourceBadge source="community" />
            </div>
            <p>
              {selectedReport.status === "validated"
                ? "A moderator checked this report."
                : "Not checked by anyone yet. Treat it as a hint, not a measurement."}
            </p>
            <p className="text-muted">Seen {new Date(selectedReport.observed_at).toLocaleString()}</p>
            {selectedReport.water_depth_cm !== null ? (
              <p className="text-muted">Depth {selectedReport.water_depth_cm} cm (reporter&apos;s own estimate)</p>
            ) : null}
            <p className="text-muted">{describeSignals(selectedReport.trust_signals).join(", ")}</p>
            <button className="mt-1 underline" onClick={() => setSelectedReport(null)}>Close</button>
          </section>
        ) : null}

        <div>
          <label htmlFor="time-slider" className="mb-1 block text-sm font-semibold">Time</label>
          <input id="time-slider" type="range" disabled min={0} max={100} defaultValue={100} className="w-full opacity-50" />
          <p className="text-xs text-muted">Not active yet. Readings, and with them the time slider, arrive in the next phase.</p>
        </div>

        <div>
          <h2 className="mb-1 text-sm font-semibold">Results</h2>
          {visible.length === 0 ? (
            <p className="text-sm text-muted">
              {stations.length === 0 ? "No stations are visible to your account yet." : "No stations match these filters."}
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto">
              {visible.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSelectedId(s.id)} aria-current={s.id === selectedId}
                    className={`w-full rounded-md border px-3 py-1.5 text-left text-sm hover:border-ocean ${s.id === selectedId ? "border-ink" : "border-line"}`}>
                    <span className="font-semibold">{s.name}</span>
                    <span className="block text-xs text-muted">{s.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="space-y-4">
        <div className="relative">
          <div ref={el} className="h-[min(28rem,70dvh)] w-full overflow-hidden rounded-xl border border-line lg:h-[34rem]" role="region" aria-label="Map of monitoring stations" />
          {tileError && layers.basemap ? (
            <p role="alert" className="absolute left-3 top-3 rounded-md border border-src-synthetic/50 bg-white p-2 text-sm text-src-synthetic">
              Base map tiles could not be loaded. Stations are still shown, without a background map.
            </p>
          ) : null}
        </div>

        {selected ? (
          <section aria-label="Station details" className="rounded-xl border border-line p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{selected.name}</h2>
                <p className="text-sm text-muted">{selected.code}{selected.river_name ? ` · ${selected.river_name}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SourceBadge source={selected.source_type} />
                <span className="rounded-full border border-[#e8d48a] bg-[#fff6d6] px-2.5 py-0.5 text-xs font-bold text-[#5c4a05]">
                  {selected.status === "unvalidated" ? "Not yet validated" : selected.status}
                </span>
              </div>
            </div>
            <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="font-semibold">Position</dt><dd>{selected.lat.toFixed(4)}, {selected.lon.toFixed(4)} (WGS84)</dd></div>
              <div>
                <dt className="font-semibold">Elevation</dt>
                <dd>
                  {selected.elevation_m != null && selected.elevation_source_type ? (
                    <>{selected.elevation_m} m <SourceBadge source={selected.elevation_source_type} /></>
                  ) : "Not recorded"}
                </dd>
              </div>
              {selected.notes ? <div className="sm:col-span-2"><dt className="font-semibold">Notes</dt><dd>{selected.notes}</dd></div> : null}
            </dl>
            <h3 className="mb-2 mt-5 font-bold">Sensors</h3>
            {sensorError ? <p role="alert" className="text-sm text-src-synthetic">Could not load sensors: {sensorError}</p> : null}
            {sensors === null && !sensorError ? <p className="text-sm text-muted" role="status">Loading sensors…</p> : null}
            {sensors && sensors.length === 0 ? <p className="text-sm text-muted">No sensors registered for this station.</p> : null}
            {sensors && sensors.length > 0 ? (
              <div className="overflow-x-auto" role="region" aria-label="Sensors table" tabIndex={0}><table className="w-full text-left text-sm">
                <thead><tr><th className="py-1">Sensor</th><th>Status</th><th>Latest value</th><th>Expected every</th><th>Source</th></tr></thead>
                <tbody>
                  {sensors.map((s) => (
                    <tr key={s.sensor_id} className="border-t border-line">
                      <td className="py-2">{SENSOR_LABELS[s.kind] ?? s.kind}</td>
                      <td><FreshnessChip sensor={s} now={now} /></td>
                      <td>{latestValue(s, now)}</td>
                      <td>{Math.round(s.expected_interval_s / 60)} min</td>
                      <td><SourceBadge source={s.source_type} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : null}
            {sensors && sensors.length > 0 && sensors.every((s) => !s.last_observed_at) ? (
              <p className="mt-3 text-sm text-muted">No readings have been received for this station, so no value is shown.</p>
            ) : null}
            <ForecastBlock state={forecastState} now={now} />
          </section>
        ) : (
          <p className="text-sm text-muted">Select a station on the map or in the results list to see its details.</p>
        )}
      </div>
    </div>
  );
}
