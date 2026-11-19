import type { FeatureCollection, Geometry, Point } from "geojson";
import type { SourceType } from "@/components/source-badge";

export interface StationRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  river_name: string | null;
  elevation_m: number | null;
  elevation_source_type: SourceType | null;
  source_type: SourceType;
  status: "prototype" | "validated" | "operational";
  notes: string | null;
}

export interface StationFilter {
  query: string;
  sources: ReadonlySet<SourceType>; // empty set = no source filter
  river: string; // "" = any river
}

export const SENSOR_LABELS: Record<string, string> = {
  water_level: "Water level",
  rainfall: "Rainfall",
  flow: "Flow",
  temperature: "Temperature",
  soil_moisture: "Soil moisture",
};

/** Case-insensitive search over name, code and river; plus source-type and river filters. */
export function filterStations(stations: StationRow[], f: StationFilter): StationRow[] {
  const q = f.query.trim().toLowerCase();
  return stations.filter((s) => {
    if (f.sources.size > 0 && !f.sources.has(s.source_type)) return false;
    if (f.river && s.river_name !== f.river) return false;
    if (!q) return true;
    return [s.name, s.code, s.river_name ?? ""].some((v) => v.toLowerCase().includes(q));
  });
}

export function stationsToGeoJSON(stations: StationRow[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: stations
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({
        type: "Feature",
        id: s.id,
        properties: { id: s.id, code: s.code, name: s.name, source_type: s.source_type },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      })),
  };
}

export function riverNames(stations: StationRow[]): string[] {
  return [...new Set(stations.map((s) => s.river_name).filter((n): n is string => !!n))].sort();
}

/** [west, south, east, north] of the stations, or null when there are none. */
export function boundsOf(stations: StationRow[]): [number, number, number, number] | null {
  if (stations.length === 0) return null;
  const lons = stations.map((s) => s.lon);
  const lats = stations.map((s) => s.lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function geojsonCollection(
  rows: { id: string; name: string; geojson: Geometry }[],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      id: r.id,
      properties: { name: r.name },
      geometry: r.geojson,
    })),
  };
}
