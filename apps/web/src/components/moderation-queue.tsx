"use client";
import { useCallback, useEffect, useState } from "react";
import { SourceBadge } from "@/components/source-badge";
import { Button, ErrorNote, GhostButton, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { hexToBytes } from "@/lib/community";

interface QueueRow {
  id: string;
  kind: string;
  description: string | null;
  water_depth_cm: number | null;
  lon: number;
  lat: number;
  observed_at: string;
  created_at: string;
  status: string;
  anonymous: boolean;
  has_photo: boolean;
  duplicate_of: string | null;
  group_size: number;
}
const STATUSES = ["unvalidated", "validated", "rejected"] as const;

function Photo({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  async function load() {
    const { data, error: err } = await createClient().from("report_photos").select("data, content_type").eq("report_id", id).single();
    if (err || !data) return setError(err?.message ?? "no photo");
    const bytes = hexToBytes(String(data.data));
    setUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: data.content_type })));
  }
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="Photo sent with this report" className="mt-2 max-h-64 rounded-md border border-line" />;
  }
  return (
    <div className="mt-2">
      <GhostButton onClick={() => void load()}>Show photo</GhostButton>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function ReportCard({ r, onDone }: { r: QueueRow; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: "validate" | "reject" | "reopen") {
    setBusy(true);
    setError("");
    const { error: err } = await createClient().rpc("moderate_community_report", {
      p_id: r.id,
      p_action: action,
      p_note: note,
      p_evidence_ref: action === "validate" ? evidence : null,
    } as never);
    setBusy(false);
    if (err) setError(err.message);
    else onDone();
  }
  return (
    <li className="rounded-lg border border-line p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-bold">{r.kind.replaceAll("_", " ")}</span>
        <SourceBadge source="community" />
        <span className="text-sm text-muted">{r.status}</span>
        {r.group_size > 1 ? <span className="text-sm text-muted">{r.group_size} nearby reports in this group</span> : null}
        {r.duplicate_of ? <span className="text-sm text-muted">grouped under an earlier report</span> : null}
      </div>
      <p className="text-sm text-muted">
        Seen {new Date(r.observed_at).toLocaleString()} · sent {new Date(r.created_at).toLocaleString()} ·{" "}
        {r.anonymous ? "anonymous" : "signed-in reporter"} · {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
        {r.water_depth_cm !== null ? ` · reported depth ${r.water_depth_cm} cm (their estimate)` : ""}
      </p>
      {r.description ? <p className="mt-2 text-sm">{r.description}</p> : null}
      {r.has_photo ? <Photo id={r.id} /> : null}
      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Note (required)</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        {r.status === "unvalidated" ? (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">How did you check it? (required to validate)</span>
            <input className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={300} placeholder="Call with the village chair, site photo, gauge reading…" />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {r.status === "unvalidated" ? (
            <>
              <Button disabled={busy || note.trim().length < 3 || evidence.trim().length < 3} onClick={() => void act("validate")}>Validate</Button>
              <GhostButton disabled={busy || note.trim().length < 3} onClick={() => void act("reject")}>Reject</GhostButton>
            </>
          ) : (
            <GhostButton disabled={busy || note.trim().length < 3} onClick={() => void act("reopen")}>Reopen</GhostButton>
          )}
        </div>
        <p className="text-xs text-muted">Validated means a person checked it. It stays labelled as a community report.</p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </li>
  );
}

export function ModerationQueue({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? "");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("unvalidated");
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!org) return;
    const { data, error: err } = await createClient().rpc("community_moderation_queue", { p_org: org, p_status: status } as never);
    if (err) setError(err.message);
    else {
      setError("");
      setRows(data as unknown as QueueRow[]);
    }
  }, [org, status]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        {orgs.length > 1 ? (
          <select className={`${inputCls} max-w-xs`} value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organisation">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : null}
        <select className={`${inputCls} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])} aria-label="Status">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {rows && rows.length === 0 ? <p className="text-sm text-muted">No reports are waiting.</p> : null}
      <ul className="space-y-4">
        {(rows ?? []).map((r) => <ReportCard key={r.id} r={r} onDone={() => void load()} />)}
      </ul>
    </div>
  );
}

interface ResourceRow {
  id: string;
  kind: string;
  title: string;
  published: boolean;
  created_by: string;
}

export function ResourceAdmin({ orgs, userId }: { orgs: { id: string; name: string }[]; userId: string }) {
  const [org, setOrg] = useState(orgs[0]?.id ?? "");
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ kind: "safe_location", title: "", body: "", phone: "", lon: "", lat: "" });
  const [evidence, setEvidence] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from("community_resources").select("id, kind, title, published, created_by").eq("org_id", org).order("created_at");
    if (err) setError(err.message);
    else setRows((data ?? []) as ResourceRow[]);
  }, [org]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function call(name: string, args: Record<string, unknown>) {
    setError("");
    const { error: err } = await createClient().rpc(name as never, args as never);
    if (err) setError(err.message);
    else await load();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Safe places and emergency information can send people to the wrong place if they are wrong. A second person must
        publish each one and say how it was checked.
      </p>
      {orgs.length > 1 ? (
        <select className={`${inputCls} max-w-xs`} value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organisation">
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border border-line p-3 text-sm">
            <p className="font-semibold">{r.title} <span className="font-normal text-muted">({r.kind.replaceAll("_", " ")}) — {r.published ? "published" : "not published"}</span></p>
            {r.published ? (
              <GhostButton className="mt-2" onClick={() => void call("unpublish_community_resource", { p_id: r.id })}>Unpublish</GhostButton>
            ) : r.created_by === userId ? (
              <p className="text-muted">Someone else must check and publish this.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <input className={`${inputCls} max-w-xs`} placeholder="How was this checked?" value={evidence[r.id] ?? ""} onChange={(e) => setEvidence({ ...evidence, [r.id]: e.target.value })} />
                <Button disabled={(evidence[r.id] ?? "").trim().length < 3} onClick={() => void call("publish_community_resource", { p_id: r.id, p_evidence_ref: evidence[r.id] })}>Publish</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 rounded-lg border border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void call("add_community_resource", {
            p_org: org, p_kind: form.kind, p_title: form.title, p_body: form.body || null, p_phone: form.phone || null,
            p_lon: form.lon === "" ? null : Number(form.lon), p_lat: form.lat === "" ? null : Number(form.lat),
          }).then(() => setForm({ ...form, title: "", body: "", phone: "" }));
        }}
      >
        <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Kind">
          <option value="safe_location">Safe location</option>
          <option value="emergency_contact">Emergency contact</option>
          <option value="emergency_info">Emergency information</option>
        </select>
        <input className={inputCls} placeholder="Name" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inputCls} placeholder="Details" rows={2} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <input className={inputCls} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Latitude (optional)" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
          <input className={inputCls} placeholder="Longitude (optional)" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} />
        </div>
        <Button type="submit">Add (not published until checked)</Button>
      </form>
    </div>
  );
}
