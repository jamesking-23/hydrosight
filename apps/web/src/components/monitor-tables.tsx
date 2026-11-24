"use client";
import { useNow } from "@/components/live-refresh";
import { SourceBadge } from "@/components/source-badge";
import {
  DEVICE_LABEL, QUALITY_LABEL, formatValue, liveDeviceState, reasonLabel, summariseDevices,
  summariseSensors, type DeviceRow, type SensorStatusRow,
} from "@/lib/monitor";
import { FRESHNESS_LABELS, classifyFreshness, describeAge } from "@/lib/stations";

const CHIP: Record<string, string> = {
  live: "border-src-measured/40 text-src-measured",
  online: "border-src-measured/40 text-src-measured",
  stale: "border-src-estimated/40 text-src-estimated",
  degraded: "border-src-estimated/40 text-src-estimated",
  offline: "border-src-synthetic/40 text-src-synthetic",
  never_reported: "border-line text-muted",
};

function Chip({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${CHIP[kind] ?? ""}`}>{children}</span>;
}

export function NetworkSummary({ sensors, devices }: { sensors: SensorStatusRow[]; devices: DeviceRow[] }) {
  const now = useNow();
  const s = summariseSensors(sensors, now);
  const d = summariseDevices(devices, now);
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg bg-mist p-3">
        <dt className="font-semibold">Devices</dt>
        <dd>{devices.length === 0 ? "No devices registered." : `${d.online} online, ${d.degraded} degraded, ${d.offline} offline`}</dd>
      </div>
      <div className="rounded-lg bg-mist p-3">
        <dt className="font-semibold">Sensors</dt>
        <dd>{sensors.length === 0 ? "No sensors." : `${s.live} live, ${s.stale} stale, ${s.offline} offline, ${s.never_reported} with no data`}</dd>
      </div>
    </dl>
  );
}

export function SensorTable({ sensors, stationName }: { sensors: SensorStatusRow[]; stationName: Record<string, string> }) {
  const now = useNow();
  if (sensors.length === 0) return <p>No sensors are visible to you yet.</p>;
  return (
    <>
    <ul className="space-y-3 md:hidden">
      {sensors.map((s) => {
        const f = classifyFreshness(s.last_observed_at, s.expected_interval_s, now);
        return (
          <li key={s.sensor_id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{stationName[s.station_id] ?? "Station"}<span className="font-normal text-muted"> · {s.kind.replace("_", " ")}</span></p>
              <Chip kind={f}>{FRESHNESS_LABELS[f]}</Chip>
            </div>
            <p className="mt-1 text-lg font-bold">
              {f === "never_reported" ? "No data received" : formatValue(s.last_value, s.unit)}
            </p>
            {s.last_observed_at ? <p className="text-sm text-muted">{describeAge(s.last_observed_at, now)}{f === "live" ? "" : ", not a current value"}</p> : null}
            {s.calibrated ? <p className="text-sm text-muted">Calibrated (raw {formatValue(s.last_raw_value, s.unit)})</p> : null}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <SourceBadge source={s.source_type} />
              <span>Quality: {s.last_quality ? QUALITY_LABEL[s.last_quality] ?? s.last_quality : "none"}</span>
            </p>
          </li>
        );
      })}
    </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="py-2 pr-3">Station</th><th className="pr-3">Sensor</th><th className="pr-3">Last value</th>
            <th className="pr-3">Status</th><th className="pr-3">Source</th><th>Quality</th>
          </tr>
        </thead>
        <tbody>
          {sensors.map((s) => {
            const f = classifyFreshness(s.last_observed_at, s.expected_interval_s, now);
            return (
              <tr key={s.sensor_id} className="border-b border-line/60 align-top">
                <td className="py-2 pr-3">{stationName[s.station_id] ?? "Station"}</td>
                <td className="pr-3">{s.kind.replace("_", " ")}</td>
                <td className="pr-3">
                  {f === "never_reported" ? "No data received" : formatValue(s.last_value, s.unit)}
                  {s.last_observed_at ? <span className="block text-xs text-muted">{describeAge(s.last_observed_at, now)}{f === "live" ? "" : ", not a current value"}</span> : null}
                  {s.calibrated ? <span className="block text-xs text-muted">Calibrated (raw {formatValue(s.last_raw_value, s.unit)})</span> : null}
                </td>
                <td className="pr-3"><Chip kind={f}>{FRESHNESS_LABELS[f]}</Chip></td>
                <td className="pr-3"><SourceBadge source={s.source_type} /></td>
                <td>{s.last_quality ? QUALITY_LABEL[s.last_quality] ?? s.last_quality : "none"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function DeviceTable({ devices }: { devices: DeviceRow[] }) {
  const now = useNow();
  if (devices.length === 0) return <p>No devices are registered. An administrator can add one on the Devices page.</p>;
  return (
    <>
    <ul className="space-y-3 md:hidden">
      {devices.map((d) => {
        const st = liveDeviceState(d, now);
        const reasons = st === "offline" && d.last_seen_at ? [`no_contact_within_${d.offline_multiple}x_interval`] : st === "offline" ? ["never_reported"] : d.reasons ?? [];
        return (
          <li key={d.device_id} className="rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{d.name}</p>
              <Chip kind={st}>{DEVICE_LABEL[st]}</Chip>
            </div>
            <p className="mt-1 text-sm text-muted">Last contact: {d.last_seen_at ? describeAge(d.last_seen_at, now) : "never"}</p>
            <p className="text-sm">Battery {d.battery_pct === null ? "unknown" : `${Math.round(d.battery_pct)}%`} · Signal {d.signal_dbm === null ? "unknown" : `${Math.round(d.signal_dbm)} dBm`}</p>
            <p className="mt-1 text-sm">{reasons.map(reasonLabel).join(", ") || "No problems reported"}</p>
          </li>
        );
      })}
    </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="py-2 pr-3">Device</th><th className="pr-3">Status</th><th className="pr-3">Last contact</th>
            <th className="pr-3">Battery</th><th className="pr-3">Signal</th><th>Why</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const st = liveDeviceState(d, now);
            const reasons = st === "offline" && d.last_seen_at ? [`no_contact_within_${d.offline_multiple}x_interval`] : st === "offline" ? ["never_reported"] : d.reasons ?? [];
            return (
              <tr key={d.device_id} className="border-b border-line/60 align-top">
                <td className="py-2 pr-3">{d.name}</td>
                <td className="pr-3"><Chip kind={st}>{DEVICE_LABEL[st]}</Chip></td>
                <td className="pr-3">{d.last_seen_at ? describeAge(d.last_seen_at, now) : "never"}</td>
                <td className="pr-3">{d.battery_pct === null ? "unknown" : `${Math.round(d.battery_pct)}%`}</td>
                <td className="pr-3">{d.signal_dbm === null ? "unknown" : `${Math.round(d.signal_dbm)} dBm`}</td>
                <td>{reasons.map(reasonLabel).join(", ") || "No problems reported"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
