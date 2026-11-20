import type { RainTotal } from "@/components/dashboard-v1";
import type { SensorStatusRow } from "@/lib/monitor";

// Minimal structural type so this stays independent of the generated Supabase client type.
interface ReadingsQuery {
  from: (t: string) => {
    select: (c: string) => {
      in: (c: string, v: string[]) => {
        gte: (c: string, v: string) => {
          neq: (c: string, v: string) => {
            neq: (c: string, v: string) => {
              limit: (n: number) => PromiseLike<{ data: { sensor_id: string; value: number | null }[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    };
  };
}

/** Rainfall totals for the last 24 hours from calibrated readings. Estimated and failed readings
 * are excluded, and the reading count is returned so the UI can show how complete the record is. */
export async function loadRain(
  supabase: unknown,
  rainSensors: SensorStatusRow[],
  stationName: Record<string, string>,
): Promise<{ rain: RainTotal[]; error: string | undefined }> {
  if (rainSensors.length === 0) return { rain: [], error: undefined };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const res = await (supabase as ReadingsQuery)
    .from("readings_calibrated")
    .select("sensor_id, value")
    .in("sensor_id", rainSensors.map((s) => s.sensor_id))
    .gte("observed_at", since)
    .neq("source_type", "estimated")
    .neq("quality", "bad")
    .limit(20000);
  const data = res.data ?? [];
  const rain = rainSensors.map((s) => {
    const rows = data.filter((r) => r.sensor_id === s.sensor_id);
    return {
      sensor_id: s.sensor_id,
      station: stationName[s.station_id] ?? "Station",
      mm: rows.reduce((t, r) => t + Number(r.value ?? 0), 0),
      readings: rows.length,
      interval_s: s.expected_interval_s,
      source_type: s.source_type,
    };
  });
  return { rain, error: res.error?.message };
}
