import Link from "next/link";
import { Card } from "@/components/ui";
import { NetworkSummary, SensorTable } from "@/components/monitor-tables";
import { SourceBadge } from "@/components/source-badge";
import { completenessPct, type DeviceRow, type SensorStatusRow } from "@/lib/monitor";
import { LEVEL_LABEL, type Level } from "@/lib/alerts";

export interface RainTotal {
  sensor_id: string;
  station: string;
  mm: number;
  readings: number;
  interval_s: number;
  source_type: SensorStatusRow["source_type"];
}

export interface AlertSummaryRow {
  id: string;
  title: string;
  level: Level;
  status: string;
}

/** Dashboard v1: what is measured now, how healthy the network is, and which alerts need people.
 * It shows measurements and human-approved alerts only. There is no risk score. */
export function DashboardV1({
  sensors, devices, rain, alerts, stationName,
}: {
  sensors: SensorStatusRow[];
  devices: DeviceRow[];
  rain: RainTotal[];
  alerts: AlertSummaryRow[];
  stationName: Record<string, string>;
}) {
  const levels = sensors.filter((s) => s.kind === "water_level");
  const published = alerts.filter((a) => a.status === "published");
  const waiting = alerts.filter((a) => a.status === "draft" || a.status === "in_review" || a.status === "approved");
  return (
    <>
      <Card title="Flood risk">
        <p>
          Not assessed. No validated risk model is connected, so HydroSight does not show a risk score.
          Below are measurements, forecasts and human-approved alerts only.
        </p>
      </Card>
      <Card title="Active alerts">
        {published.length === 0 ? <p>No published alerts.</p> : (
          <ul className="space-y-2">
            {published.map((a) => (
              <li key={a.id}><Link className="underline" href={`/alerts/${a.id}`}>{a.title}</Link> <span className="text-sm text-muted">{LEVEL_LABEL[a.level]}</span></li>
            ))}
          </ul>
        )}
        {waiting.length > 0 ? (
          <p className="mt-3 text-sm">{waiting.length} alert{waiting.length === 1 ? "" : "s"} waiting for a person to complete, review, approve or publish. <Link className="underline" href="/alerts">Open alerts</Link></p>
        ) : null}
      </Card>
      <Card title="Rainfall, last 24 hours">
        {rain.length === 0 ? <p>No rainfall sensors report to you yet.</p> : (
          <ul className="space-y-2">
            {rain.map((r) => {
              const pct = completenessPct(r.readings, r.interval_s, 24);
              return (
                <li key={r.sensor_id}>
                  <span className="font-semibold">{r.station}</span>: {Math.round(r.mm * 10) / 10} mm <SourceBadge source={r.source_type} />
                  <span className="block text-sm text-muted">
                    {r.readings === 0 ? "No readings in the last 24 hours." : `Based on ${r.readings} readings (${pct}% of the expected record).${pct < 90 ? " Missing readings are not filled, so the true total may be higher." : ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="River levels">
        {levels.length === 0 ? <p>No water-level sensors report to you yet.</p> : <SensorTable sensors={levels} stationName={stationName} />}
      </Card>
      <Card title="Sensor network">
        <NetworkSummary sensors={sensors} devices={devices} />
        <p className="mt-3 text-sm"><Link className="underline" href="/monitor">Open live monitoring</Link></p>
      </Card>
    </>
  );
}
