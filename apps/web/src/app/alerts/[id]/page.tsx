import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertActions } from "@/components/alert-actions";
import { AlertEditor } from "@/components/alert-editor";
import { Card, ErrorNote } from "@/components/ui";
import { Shell } from "@/components/shell";
import { SourceBadge, SOURCE_TYPES, type SourceType } from "@/components/source-badge";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";
import {
  FOUR_EYES_NOTE, LEVEL_LABEL, ORIGIN_LABEL, STATUS_LABEL, availableActions, missingContent,
  type AlertLite, type AlertStatus, type Level, type Origin,
} from "@/lib/alerts";

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Kampala" }) + " (EAT)" : "none");

export default async function AlertDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await loadAccess(`/alerts/${id}`);
  const { data: al, error } = await a.supabase.from("alerts").select("*").eq("id", id).maybeSingle();
  if (!al && !error) notFound();
  if (!al) return <Shell title="Alert" signedInAs={a.user.email ?? undefined}><ErrorNote>{error?.message}</ErrorNote></Shell>;
  const [events, acks] = await Promise.all([
    a.supabase.from("alert_events").select("id, event, from_status, to_status, note, created_at").eq("alert_id", id).order("created_at"),
    a.supabase.from("alert_acks").select("user_id").eq("alert_id", id),
  ]);
  const perms = permissionsInOrg(al.org_id, a);
  const lite = al as unknown as AlertLite;
  const actions = availableActions(lite, perms, a.user.id);
  const missing = al.status === "draft" ? missingContent(lite) : [];
  const evidence = (Array.isArray(al.evidence) ? al.evidence : []) as Record<string, unknown>[];
  const row = (k: string, v: string | null) => (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr]"><dt className="font-semibold">{k}</dt><dd>{v || "not set"}</dd></div>
  );
  return (
    <Shell title={al.title} signedInAs={a.user.email ?? undefined}>
      <p className="mb-6 text-sm">
        <Link className="underline" href="/alerts">Back to alerts</Link>
      </p>
      <p className="mb-4 text-lg font-semibold">
        {LEVEL_LABEL[al.level as Level]}, {STATUS_LABEL[al.status as AlertStatus]}, {al.audience === "public" ? "public" : "internal"}
      </p>
      {al.audience === "public" ? <p className="mb-4 text-sm text-muted">{FOUR_EYES_NOTE}</p> : null}
      {al.false_alarm ? <p role="status" className="mb-4 rounded-md border border-src-estimated/50 p-3 text-sm">Tagged as a false alarm. {al.false_alarm_note}</p> : null}
      <dl className="space-y-2">
        {row("Origin", ORIGIN_LABEL[al.origin as Origin])}
        {row("Hazard", al.hazard)}
        {row("Location", al.location_text)}
        {row("Expected timing", al.expected_timing)}
        {row("Expected duration", al.duration_text)}
        {row("Recommended action", al.recommended_action)}
        {row("Issuing authority", al.issuing_authority)}
        {al.source_attribution ? row("Source attribution", al.source_attribution) : null}
        {row("Confidence", al.confidence === "not_assessed" ? "Not assessed" : al.confidence)}
        {row("Expires", fmt(al.expires_at))}
        {row("Review by", fmt(al.review_at))}
        {row("Version", String(al.version))}
        {row("Acknowledged by", `${acks.data?.length ?? 0} person(s)`)}
      </dl>
      <Card title="Evidence">
        {evidence.length === 0 ? <p>No evidence attached.</p> : (
          <ul className="space-y-2">
            {evidence.map((e, i) => {
              const st = SOURCE_TYPES.includes(e.source_type as SourceType) ? (e.source_type as SourceType) : null;
              return (
                <li key={i} className="rounded-md border border-line p-3 text-sm">
                  {e.type === "reading" ? (
                    <p>Reading {String(e.value)} {String(e.unit ?? "")} observed {fmt(String(e.observed_at))} {st ? <SourceBadge source={st} /> : null}
                      {" "}(quality: {String(e.quality)}). Rule: {String(e.rule_name ?? "")}. Basis: {String(e.rule_rationale ?? "")} Evidence: {String(e.rule_evidence_ref ?? "")}</p>
                  ) : <p>{String(e.text ?? JSON.stringify(e))}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {actions.includes("edit") ? (
        <Card title="Edit draft">
          <p className="mb-3 text-sm">Saving makes you this draft&apos;s author. Automatic drafts have no author until a person edits them.</p>
          <AlertEditor alert={al as never} />
        </Card>
      ) : null}
      <Card title="Actions">
        {missing.length > 0 ? (
          <p className="mb-3 text-sm">To submit for review this draft still needs: {missing.join(", ")}. Complete it in the editor above.</p>
        ) : null}
        <AlertActions id={id} actions={actions} />
      </Card>
      <Card title="History">
        <ol className="space-y-1 text-sm">
          {(events.data ?? []).map((e) => (
            <li key={e.id}>{fmt(e.created_at)}: {e.event === "status_changed" ? `${e.from_status} to ${e.to_status}` : e.event}{e.note ? `. ${e.note}` : ""}</li>
          ))}
        </ol>
      </Card>
    </Shell>
  );
}
