"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, GhostButton, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { LEVELS, LEVEL_LABEL } from "@/lib/alerts";

interface SensorOpt { id: string; org_id: string; label: string; kind: string }

export function RuleForm({ orgs, sensors }: { orgs: { id: string; name: string }[]; sensors: SensorOpt[] }) {
  const router = useRouter();
  const [org, setOrg] = useState(orgs[0]?.id ?? "");
  const [f, setF] = useState({
    name: "", scope: "organisation", sensor: "", kind: "water_level", comparator: ">=", value: "",
    level: "watch", hysteresis: "0", cooldown: "3600", rationale: "", evidence: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const mine = sensors.filter((s) => s.org_id === org);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const bySensor = f.scope === "sensor";
    const { error: err } = await createClient().rpc("draft_threshold_rule", {
      p_org: org, p_name: f.name, p_scope: f.scope, p_scope_id: bySensor ? f.sensor : null,
      p_sensor_kind: bySensor ? null : f.kind, p_comparator: f.comparator, p_value: Number(f.value),
      p_level: f.level, p_hysteresis: Number(f.hysteresis), p_cooldown_s: Number(f.cooldown),
      p_rationale: f.rationale, p_evidence_ref: f.evidence,
    } as never);
    setBusy(false);
    if (err) setError(err.message); else { setF({ ...f, name: "", value: "", rationale: "", evidence: "" }); router.refresh(); }
  }
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-3">
      <p className="text-sm text-muted">
        HydroSight ships no thresholds. Every value must come from your own analysis or an official
        source, and a different person with approval rights must activate it.
      </p>
      {orgs.length > 1 ? (
        <label className="block"><span className="mb-1 block text-sm font-semibold">Organisation</span>
          <select className={inputCls} value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      ) : null}
      <Field label="Rule name" required value={f.name} onChange={set("name")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-sm font-semibold">Applies to</span>
          <select className={inputCls} value={f.scope} onChange={set("scope")}>
            <option value="organisation">All sensors of one kind</option><option value="sensor">One sensor</option></select></label>
        {f.scope === "sensor" ? (
          <label className="block"><span className="mb-1 block text-sm font-semibold">Sensor</span>
            <select className={inputCls} required value={f.sensor} onChange={set("sensor")}>
              <option value="">Choose…</option>
              {mine.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        ) : (
          <label className="block"><span className="mb-1 block text-sm font-semibold">Sensor kind</span>
            <select className={inputCls} value={f.kind} onChange={set("kind")}>
              {["water_level", "rainfall", "flow", "temperature", "soil_moisture"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select></label>
        )}
        <label className="block"><span className="mb-1 block text-sm font-semibold">Fires when value is</span>
          <select className={inputCls} value={f.comparator} onChange={set("comparator")}>
            <option value=">=">at or above</option><option value="<=">at or below</option></select></label>
        <Field label="Threshold value" type="number" step="any" required value={f.value} onChange={set("value")} />
        <label className="block"><span className="mb-1 block text-sm font-semibold">Alert level</span>
          <select className={inputCls} value={f.level} onChange={set("level")}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></label>
        <Field label="Hysteresis (drop needed before it can fire again)" type="number" step="any" min="0" value={f.hysteresis} onChange={set("hysteresis")} />
        <Field label="Cooldown (seconds)" type="number" min="0" max="604800" value={f.cooldown} onChange={set("cooldown")} />
      </div>
      <label className="block"><span className="mb-1 block text-sm font-semibold">Rationale (at least 20 characters)</span>
        <textarea className={inputCls} rows={3} value={f.rationale} onChange={set("rationale")} /></label>
      <Field label="Evidence reference (document, survey, official bulletin)" value={f.evidence} onChange={set("evidence")} />
      <ErrorNote>{error}</ErrorNote>
      <Button disabled={busy}>Save rule as draft</Button>
    </form>
  );
}

export function RuleActions({ id, canActivate, canRetire }: { id: string; canActivate: boolean; canRetire: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function call(name: string) {
    setError("");
    const { error: err } = await createClient().rpc(name as never, { p_id: id } as never);
    if (err) setError(err.message); else router.refresh();
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {canActivate ? <GhostButton onClick={() => call("activate_threshold_rule")}>Approve and activate</GhostButton> : null}
        {canRetire ? <GhostButton onClick={() => call("retire_threshold_rule")}>Retire</GhostButton> : null}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
