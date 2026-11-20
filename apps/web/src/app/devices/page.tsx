import { Card, ErrorNote } from "@/components/ui";
import { DeviceRowActions, ProvisionForm, SensorConfigForm } from "@/components/device-admin";
import { DeviceTable } from "@/components/monitor-tables";
import { Shell } from "@/components/shell";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";
import type { DeviceRow } from "@/lib/monitor";

export default async function Devices() {
  const a = await loadAccess("/devices");
  const [devices, stations, sensors, orgs] = await Promise.all([
    a.supabase.from("device_status").select("*").order("name"),
    a.supabase.from("stations").select("id, org_id, name"),
    a.supabase.from("sensors").select("id, org_id, station_id, kind, device_id"),
    a.supabase.from("organizations").select("id, name"),
  ]);
  const manageOrgs = a.memberships
    .filter((m) => m.status === "active" && permissionsInOrg(m.org_id, a).has("devices.manage"))
    .map((m) => m.org_id);
  const rows = (devices.data ?? []) as unknown as DeviceRow[];
  const manageable = rows.filter((d) => manageOrgs.includes(d.org_id));
  const stationName = Object.fromEntries((stations.data ?? []).map((s) => [s.id, s.name]));
  const mySensors = (sensors.data ?? []).filter((s) => manageOrgs.includes(s.org_id));
  return (
    <Shell title="Devices" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? devices.error?.message ?? sensors.error?.message}</ErrorNote>
      <Card title="Registered devices">
        <DeviceTable devices={rows} />
        {manageable.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {manageable.map((d) => (
              <li key={d.device_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                <span className="font-semibold">{d.name}</span>
                <DeviceRowActions id={d.device_id} />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {manageOrgs.length > 0 ? (
        <>
          <Card title="Register a device">
            <ProvisionForm orgs={(orgs.data ?? []).filter((o) => manageOrgs.includes(o.id))} stations={(stations.data ?? []).filter((s) => manageOrgs.includes(s.org_id))} sensors={mySensors} />
          </Card>
          <Card title="Calibration and quality limits">
            <SensorConfigForm sensors={mySensors} stationName={stationName} />
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted">Your role cannot register devices or change calibration.</p>
      )}
    </Shell>
  );
}
