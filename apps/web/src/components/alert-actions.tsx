"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, GhostButton, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";
import type { AlertAction } from "@/lib/alerts";

const LABEL: Record<AlertAction, string> = {
  edit: "Edit", submit: "Submit for review", return: "Return to draft", approve: "Approve",
  publish: "Publish", cancel: "Cancel alert", ack: "Acknowledge", new_version: "Issue new version",
  false_alarm: "Tag as false alarm",
};

/** Buttons call the database functions; the database re-checks permission, state and approver. */
export function AlertActions({ id, actions }: { id: string; actions: AlertAction[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");

  async function call(name: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setError(""); setDone("");
    const { error: err } = await createClient().rpc(name as never, args as never);
    setBusy(false);
    if (err) setError(err.message);
    else { setDone(ok); setNote(""); router.refresh(); }
  }
  const needsNote = actions.includes("cancel") || actions.includes("return") || actions.includes("approve") || actions.includes("false_alarm");

  const run = (a: AlertAction) => {
    if (a === "submit") return call("submit_alert", { p_id: id }, "Submitted for review.");
    if (a === "return") return call("return_alert_to_draft", { p_id: id, p_note: note || null }, "Returned to draft.");
    if (a === "approve") return call("approve_alert", { p_id: id, p_note: note || null }, "Approved. It is not public until someone with publish permission publishes it.");
    if (a === "publish") return call("publish_alert", { p_id: id }, "Published.");
    if (a === "cancel") return call("cancel_alert", { p_id: id, p_reason: note }, "Cancelled.");
    if (a === "ack") return call("ack_alert", { p_id: id }, "Acknowledged.");
    if (a === "false_alarm") return call("tag_false_alarm", { p_id: id, p_flag: true, p_note: note || null }, "Tagged as a false alarm.");
    if (a === "new_version") {
      return (async () => {
        setBusy(true); setError("");
        const { data, error: err } = await createClient().rpc("new_alert_version", { p_id: id });
        setBusy(false);
        if (err) setError(err.message); else router.push(`/alerts/${data as string}`);
      })();
    }
  };
  const buttons = actions.filter((a) => a !== "edit");
  if (buttons.length === 0) return <p className="text-sm text-muted">No actions are available to you on this alert.</p>;
  return (
    <div className="space-y-3">
      {needsNote ? (
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Note or reason (required to cancel, 5+ characters)</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {buttons.map((a) =>
          a === "approve" || a === "publish" || a === "submit" ? (
            <Button key={a} disabled={busy} onClick={() => run(a)}>{LABEL[a]}</Button>
          ) : (
            <GhostButton key={a} disabled={busy || (a === "cancel" && note.trim().length < 5)} onClick={() => run(a)}>{LABEL[a]}</GhostButton>
          ),
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {done ? <p role="status" className="text-sm">{done}</p> : null}
    </div>
  );
}
