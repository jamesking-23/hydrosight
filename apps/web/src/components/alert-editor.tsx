"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import { LEVELS, LEVEL_LABEL } from "@/lib/alerts";

export interface EditableAlert {
  id: string; level: string; audience: string; confidence: string; expected_timing: string | null;
  duration_text: string | null; recommended_action: string | null; issuing_authority: string | null;
  expires_at: string | null; evidence: unknown[];
}

/** Editing a draft also makes the editor its drafter ("adopting" an automatic draft). */
export function AlertEditor({ alert }: { alert: EditableAlert }) {
  const router = useRouter();
  const [f, setF] = useState({
    level: alert.level, audience: alert.audience, confidence: alert.confidence,
    timing: alert.expected_timing ?? "", duration: alert.duration_text ?? "",
    action: alert.recommended_action ?? "", authority: alert.issuing_authority ?? "",
    expires: alert.expires_at ? alert.expires_at.slice(0, 16) : "", note: "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setSaved(false);
    const patch: Record<string, unknown> = {
      level: f.level, audience: f.audience, confidence: f.confidence,
      ...(f.timing ? { expected_timing: f.timing } : {}), ...(f.duration ? { duration_text: f.duration } : {}),
      ...(f.action ? { recommended_action: f.action } : {}), ...(f.authority ? { issuing_authority: f.authority } : {}),
      ...(f.expires ? { expires_at: new Date(f.expires).toISOString() } : {}),
      ...(f.note.trim() ? { evidence: [...alert.evidence, { type: "note", text: f.note.trim() }] } : {}),
    };
    const { error: err } = await createClient().rpc("edit_alert_draft", { p_id: alert.id, p_patch: patch } as never);
    setBusy(false);
    if (err) setError(err.message); else { setSaved(true); setF({ ...f, note: "" }); router.refresh(); }
  }
  return (
    <form onSubmit={save} className="max-w-2xl space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-sm font-semibold">Level</span>
          <select className={inputCls} value={f.level} onChange={set("level")}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Audience</span>
          <select className={inputCls} value={f.audience} onChange={set("audience")}>
            <option value="internal">Internal</option><option value="public">Public</option></select></label>
        <label className="block"><span className="mb-1 block text-sm font-semibold">Confidence</span>
          <select className={inputCls} value={f.confidence} onChange={set("confidence")}>
            <option value="not_assessed">Not assessed</option><option value="low">Low</option>
            <option value="medium">Medium</option><option value="high">High</option></select></label>
      </div>
      <Field label="Expected timing" value={f.timing} onChange={set("timing")} />
      <Field label="Expected duration" value={f.duration} onChange={set("duration")} />
      <Field label="Recommended action" value={f.action} onChange={set("action")} />
      <Field label="Issuing authority" value={f.authority} onChange={set("authority")} />
      <Field label="Expires at" type="datetime-local" value={f.expires} onChange={set("expires")} />
      <Field label="Add an evidence note" value={f.note} onChange={set("note")} />
      <ErrorNote>{error}</ErrorNote>
      {saved ? <p role="status" className="text-sm">Saved.</p> : null}
      <Button disabled={busy}>Save changes</Button>
    </form>
  );
}
