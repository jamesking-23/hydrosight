import { Card, ErrorNote } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { DeviceTable, NetworkSummary, SensorTable } from "@/components/monitor-tables";
import { Shell } from "@/components/shell";
import { loadAccess } from "@/lib/load-access";
import type { DeviceRow, SensorStatusRow } from "@/lib/monitor";

export default async function Monitor() {
  const a = await loadAccess("/monitor");
  const [sensors, devices, stations] = await Promise.all([
    a.supabase.from("sensor_status")
      .select("sensor_id, org_id, station_id, kind, unit, expected_interval_s, source_type, last_observed_at, last_value, last_raw_value, last_quality, calibrated")
      .order("station_id"),
    a.supabase.from("device_status").select("*").order("name"),
    a.supabase.from("stations").select("id, name"),
  ]);
  const stationName = Object.fromEntries((stations.data ?? []).map((s) => [s.id, s.name]));
  const sensorRows = (sensors.data ?? []) as unknown as SensorStatusRow[];
  const deviceRows = (devices.data ?? []) as unknown as DeviceRow[];
  return (
    <Shell title="Live monitoring" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? sensors.error?.message ?? devices.error?.message}</ErrorNote>
      <LiveRefresh />
      <Card title="Network">
        <NetworkSummary sensors={sensorRows} devices={deviceRows} />
      </Card>
      <Card title="Sensors">
        <SensorTable sensors={sensorRows} stationName={stationName} />
      </Card>
      <Card title="Devices">
        <DeviceTable devices={deviceRows} />
      </Card>
    </Shell>
  );
}
