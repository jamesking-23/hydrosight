"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, GhostButton, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

interface Org { id: string; name: string }
interface Station { id: string; org_id: string; name: string }
export interface SensorOpt { id: string; org_id: string; station_id: string; kind: string; device_id: string | null }

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

/** The device key is returned once by the database. It is shown here once and never stored. */
function KeyNotice({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <div role="status" className="rounded-md border border-src-estimated/50 p-4">
      <p className="mb-2 font-semibold">Copy this device key now. It is shown once and cannot be recovered.</p>
      <code className="block break-all rounded bg-line/40 p-2 text-sm">{secret}</code>
      <p className="mt-2 text-sm text-muted">Put it in the device&apos;s secure configuration. If it is lost, rotate the key to issue a new one.</p>
      <div className="mt-3"><GhostButton onClick={onDone}>I have saved it</GhostButton></div>
    </div>
  );
}

export function ProvisionForm({ orgs, stations, sensors }: { orgs: Org[]; stations: Station[]; sensors: SensorOpt[] }) {
  const router = useRouter();
  const [org, setOrg] = useState(orgs[0]?.id ?? "");
  const [station, setStation] = useState("");
  const [name, setName] = useState("");
  const [interval, setInterval] = useState("300");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const free = sensors.filter((s) => s.org_id === org && !s.device_id && (!station || s.station_id === station));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { data, error: err } = await createClient().rpc("provision_device", {
      p_org: org, p_name: name, p_station: station || null, p_interval: Number(interval), p_sensors: chosen, p_serial: null,
    } as never);
    if (err) { setError(err.message); return; }
    setSecret((data as unknown as { api_key: string }).api_key);
    setName(""); setChosen([]);
    router.refresh();
  }
  if (secret) return <KeyNotice secret={secret} onDone={() => setSecret("")} />;
  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      {orgs.length > 1 ? (
        <label className="block"><span className="mb-1 block text-sm font-semibold">Organisation</span>
          <select className={inputCls} value={org} onChange={(e) => { setOrg(e.target.value); setStation(""); setChosen([]); }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      ) : null}
      <Field label="Device name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <label className="block"><span className="mb-1 block text-sm font-semibold">Station</span>
        <select className={inputCls} value={station} onChange={(e) => { setStation(e.target.value); setChosen([]); }}>
          <option value="">Any (not tied to a station)</option>
          {stations.filter((s) => s.org_id === org).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <Field label="Expected seconds between reports" type="number" min={10} max={604800} required value={interval} onChange={(e) => setInterval(e.target.value)} />
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Sensors on this device</legend>
        {free.length === 0 ? <p className="text-sm text-muted">No unassigned sensors here. Add sensors to the station first.</p> : free.map((s) => (
          <label key={s.id} className="mr-4 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))} />
            {s.kind.replace("_", " ")}
          </label>
        ))}
      </fieldset>
      <ErrorNote>{error}</ErrorNote>
      <Button>Register device and create its key</Button>
    </form>
  );
}

export function DeviceRowActions({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  async function rotate() {
    setError("");
    const { data, error: err } = await createClient().rpc("rotate_device_key", { p_device: id } as never);
    if (err) setError(err.message); else setSecret(data as unknown as string);
  }
  async function retire() {
    if (!window.confirm("Retire this device? Its key stops working immediately.")) return;
    setError("");
    const { error: err } = await createClient().rpc("retire_device", { p_device: id } as never);
    if (err) setError(err.message); else router.refresh();
  }
  if (secret) return <KeyNotice secret={secret} onDone={() => setSecret("")} />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <GhostButton onClick={rotate}>Rotate key</GhostButton>
        <GhostButton onClick={retire}>Retire</GhostButton>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

export function SensorConfigForm({ sensors, stationName }: { sensors: SensorOpt[]; stationName: Record<string, string> }) {
  const [sensor, setSensor] = useState(sensors[0]?.id ?? "");
  const [cal, setCal] = useState({ scale: "1", offset: "0", from: "", note: "" });
  const [qc, setQc] = useState({ min: "", max: "", rate: "", flat: "", cross: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  async function saveCal(e: React.FormEvent) {
    e.preventDefault(); setError(""); setDone("");
    const { error: err } = await createClient().rpc("add_calibration", {
      p_sensor: sensor, p_scale: Number(cal.scale), p_offset: Number(cal.offset),
      p_effective_from: new Date(cal.from).toISOString(), p_note: cal.note,
    } as never);
    if (err) setError(err.message); else setDone("Calibration saved. Raw values are kept; calibrated values apply from the date you chose.");
  }
  async function saveQc(e: React.FormEvent) {
    e.preventDefault(); setError(""); setDone("");
    const { error: err } = await createClient().rpc("set_sensor_qc_config", {
      p_sensor: sensor, p_min: num(qc.min), p_max: num(qc.max), p_rate: num(qc.rate), p_flatline_n: num(qc.flat), p_cross_diff: num(qc.cross),
    } as never);
    if (err) setError(err.message); else setDone("Quality limits saved. They apply to readings received from now on.");
  }
  if (sensors.length === 0) return <p>No sensors to configure.</p>;
  return (
    <div className="max-w-xl space-y-6">
      <label className="block"><span className="mb-1 block text-sm font-semibold">Sensor</span>
        <select className={inputCls} value={sensor} onChange={(e) => setSensor(e.target.value)}>
          {sensors.map((s) => <option key={s.id} value={s.id}>{stationName[s.station_id] ?? "Station"}, {s.kind.replace("_", " ")}</option>)}</select></label>
      <form onSubmit={saveCal} className="space-y-3">
        <h3 className="font-bold">Calibration</h3>
        <p className="text-sm text-muted">Corrected value = raw value × scale + offset, from the effective date. Raw readings are never changed.</p>
        <Field label="Scale" type="number" step="any" value={cal.scale} onChange={(e) => setCal({ ...cal, scale: e.target.value })} />
        <Field label="Offset" type="number" step="any" value={cal.offset} onChange={(e) => setCal({ ...cal, offset: e.target.value })} />
        <Field label="Effective from" type="datetime-local" required value={cal.from} onChange={(e) => setCal({ ...cal, from: e.target.value })} />
        <Field label="Reason and evidence (for example the gauge check)" required value={cal.note} onChange={(e) => setCal({ ...cal, note: e.target.value })} />
        <Button>Save calibration</Button>
      </form>
      <form onSubmit={saveQc} className="space-y-3">
        <h3 className="font-bold">Quality limits</h3>
        <p className="text-sm text-muted">Leave a limit empty to switch that check off. HydroSight sets no limits for you. Until limits exist, readings stay unchecked.</p>
        <Field label="Lowest plausible value" type="number" step="any" value={qc.min} onChange={(e) => setQc({ ...qc, min: e.target.value })} />
        <Field label="Highest plausible value" type="number" step="any" value={qc.max} onChange={(e) => setQc({ ...qc, max: e.target.value })} />
        <Field label="Largest believable change per hour (spike check)" type="number" step="any" min="0" value={qc.rate} onChange={(e) => setQc({ ...qc, rate: e.target.value })} />
        <Field label="Identical readings in a row that count as stuck (3 or more)" type="number" min="3" value={qc.flat} onChange={(e) => setQc({ ...qc, flat: e.target.value })} />
        <Field label="Largest allowed difference from a twin sensor at the same station" type="number" step="any" min="0" value={qc.cross} onChange={(e) => setQc({ ...qc, cross: e.target.value })} />
        <Button>Save quality limits</Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {done ? <p role="status" className="text-sm">{done}</p> : null}
    </div>
  );
}
