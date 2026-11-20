"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { FOUR_EYES_NOTE, LEVELS, LEVEL_LABEL } from "@/lib/alerts";

interface Org { id: string; name: string }
interface Station { id: string; org_id: string; name: string }

/** Creates a human draft. Automatic (sensor/model) alerts come only from the engine. */
export function AlertForm({ orgs, stations }: { orgs: Org[]; stations: Station[] }) {
  const router = useRouter();
  const [org, setOrg] = useState(orgs[0]?.id ?? "");
  const [f, setF] = useState({
    title: "", location: "", station: "", level: "watch", audience: "internal", origin: "human_emergency",
    timing: "", duration: "", action: "", authority: "", attribution: "", evidence: "", expires: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const evidence = f.evidence.trim()
      ? f.evidence.split("\n").filter(Boolean).map((line) => ({ type: "note", text: line.trim() }))
      : [];
    const { data, error: err } = await createClient().rpc("create_alert_draft", {
      p_org: org, p_origin: f.origin, p_level: f.level, p_title: f.title, p_location_text: f.location,
      p_station: f.station || null, p_expected_timing: f.timing || null, p_duration: f.duration || null,
      p_recommended_action: f.action || null, p_issuing_authority: f.authority || null,
      p_evidence: evidence, p_audience: f.audience,
      p_expires_at: f.expires ? new Date(f.expires).toISOString() : null,
      p_source_attribution: f.attribution || null,
    } as never);
    setBusy(false);
    if (err) setError(err.message); else router.push(`/alerts/${data as string}`);
  }
  const orgStations = stations.filter((s) => s.org_id === org);
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      {orgs.length > 1 ? (
        <label className="block"><span className="mb-1 block text-sm font-semibold">Organisation</span>
          <select className={inputCls} value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
      ) : null}
      <Field label="Title" required maxLength={200} value={f.title} onChange={set("title")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-sm font-semibold">Level</span>
          <select className={inputCls} value={f.level} onChange={set("level")}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Audience</span>
          <select className={inputCls} value={f.audience} onChange={set("audience")}>
            <option value="internal">Internal (team only)</option><option value="public">Public</option></select></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Origin</span>
          <select className={inputCls} value={f.origin} onChange={set("origin")}>
            <option value="human_emergency">Human-declared emergency</option>
            <option value="official_warning">Official warning (attribute the source)</option>
            <option value="community_observation">Community observation</option></select></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Station (optional)</span>
          <select className={inputCls} value={f.station} onChange={set("station")}>
            <option value="">None</option>
            {orgStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <Field label="Location (affected area)" required value={f.location} onChange={set("location")} />
      <Field label="Expected timing" value={f.timing} onChange={set("timing")} placeholder="e.g. river peaks in 4 to 6 hours" />
      <Field label="Expected duration" value={f.duration} onChange={set("duration")} />
      <Field label="Recommended action" value={f.action} onChange={set("action")} />
      <Field label="Issuing authority" value={f.authority} onChange={set("authority")} />
      {f.origin === "official_warning" ? (
        <Field label="Source attribution (required for official warnings)" required value={f.attribution} onChange={set("attribution")} />
      ) : null}
      <label className="block"><span className="mb-1 block text-sm font-semibold">Supporting evidence (one item per line)</span>
        <textarea className={inputCls} rows={3} value={f.evidence} onChange={set("evidence")} /></label>
      <Field label="Expires at" type="datetime-local" value={f.expires} onChange={set("expires")} />
      {f.audience === "public" ? <p className="text-sm text-muted">{FOUR_EYES_NOTE}</p> : null}
      <ErrorNote>{error}</ErrorNote>
      <Button disabled={busy}>Save draft</Button>
    </form>
  );
}
