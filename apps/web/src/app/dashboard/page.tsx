import Link from "next/link";
import { Card, ErrorNote } from "@/components/ui";
import { Shell } from "@/components/shell";
import { DashboardV1 } from "@/components/dashboard-v1";
import { LiveRefresh } from "@/components/live-refresh";
import { loadRain } from "@/lib/dashboard-data";
import { loadAccess } from "@/lib/load-access";
import type { DeviceRow, SensorStatusRow } from "@/lib/monitor";
import type { Level } from "@/lib/alerts";

export default async function Dashboard() {
  const a = await loadAccess("/dashboard");
  const { data: orgs, error: orgError } = await a.supabase.from("organizations").select("id, name");
  const label = new Map(a.roleDefs.map((r) => [r.key, r.label]));
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const active = a.memberships.filter((m) => m.status === "active");

  const [sensorsRes, devicesRes, stationsRes, alertsRes] = active.length
    ? await Promise.all([
        a.supabase.from("sensor_status").select("sensor_id, org_id, station_id, kind, unit, expected_interval_s, source_type, last_observed_at, last_value, last_raw_value, last_quality, calibrated").order("station_id"),
        a.supabase.from("device_status").select("*").order("name"),
        a.supabase.from("stations").select("id, name"),
        a.supabase.from("alerts").select("id, title, level, status").in("status", ["draft", "in_review", "approved", "published"]).order("created_at", { ascending: false }).limit(50),
      ])
    : [null, null, null, null];
  const sensors = (sensorsRes?.data ?? []) as unknown as SensorStatusRow[];
  const devices = (devicesRes?.data ?? []) as unknown as DeviceRow[];
  const stationName = Object.fromEntries((stationsRes?.data ?? []).map((s) => [s.id, s.name]));
  const { rain, error: rainError } = await loadRain(a.supabase, sensors.filter((s) => s.kind === "rainfall"), stationName);
  const alertRows = ((alertsRes?.data ?? []) as { id: string; title: string; level: string; status: string }[]).map((x) => ({ ...x, level: x.level as Level }));

  return (
    <Shell title="Dashboard" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? orgError?.message ?? sensorsRes?.error?.message ?? devicesRes?.error?.message ?? rainError}</ErrorNote>
      {active.length > 0 ? (
        <>
          <LiveRefresh />
          <DashboardV1 sensors={sensors} devices={devices} rain={rain} alerts={alertRows} stationName={stationName} />
          <h2 className="mb-4 border-t border-line pt-6 text-xl font-bold">Your organisations</h2>
        </>
      ) : null}
      {active.length === 0 && !a.loadError ? (
        <Card title="No organisation yet">
          <p className="mb-3">
            An account on its own gives no access. Ask an organisation administrator for an
            invitation, then{" "}
            <Link className="underline" href="/invite">
              accept it here
            </Link>
            .
          </p>
        </Card>
      ) : null}
      <ul className="space-y-3">
        {active.map((m) => (
          <li key={m.id} className="rounded-lg border border-line p-4 hover:border-ocean">
            <p className="font-semibold">{orgName.get(m.org_id) ?? "Organisation"}</p>
            <p className="text-sm text-muted">
              Role: {label.get(m.role_key) ?? m.role_key}
            </p>
            <Link className="mt-2 inline-block underline" href={`/org/${m.org_id}`}>
              Open
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        <Link className="underline" href="/invite">
          Have an invitation code?
        </Link>
      </p>
    </Shell>
  );
}
