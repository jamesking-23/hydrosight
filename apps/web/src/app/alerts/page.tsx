import Link from "next/link";
import { Card, ErrorNote } from "@/components/ui";
import { Shell } from "@/components/shell";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";
import { LEVEL_LABEL, ORIGIN_LABEL, STATUS_LABEL, isConflict, type AlertStatus, type Level, type Origin } from "@/lib/alerts";

export default async function AlertsPage() {
  const a = await loadAccess("/alerts");
  const [alerts, ranked] = await Promise.all([
    a.supabase.from("alerts")
      .select("id, org_id, title, level, status, origin, audience, location_text, created_at, version")
      .order("created_at", { ascending: false }).limit(100),
    a.supabase.from("alerts_active_ranked")
      .select("id, station_id, location_text, title, level, origin, origin_rank, has_conflict")
      .order("origin_rank"),
  ]);
  const rows = alerts.data ?? [];
  const canDraft = a.memberships.some((m) => m.status === "active" && permissionsInOrg(m.org_id, a).has("warnings.draft"));
  const active = ranked.data ?? [];
  const byPlace = new Map<string, typeof active>();
  for (const r of active) {
    const k = r.station_id ?? r.location_text;
    byPlace.set(k, [...(byPlace.get(k) ?? []), r]);
  }
  const conflicts = [...byPlace.values()].filter((g) => isConflict(g));

  return (
    <Shell title="Alerts" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? alerts.error?.message ?? ranked.error?.message}</ErrorNote>
      <p className="mb-6 text-sm text-muted">
        Automatic alerts are drafts only. Nothing becomes public without a person approving it and a person
        with publish permission releasing it.
      </p>
      {canDraft ? (
        <p className="mb-6"><Link className="underline font-semibold" href="/alerts/new">Draft an alert</Link></p>
      ) : null}
      {conflicts.length > 0 ? (
        <Card title="Conflicting information">
          <p className="mb-3 text-sm">Active alerts for the same place disagree. Official warnings are listed first.</p>
          {conflicts.map((g, i) => (
            <ul key={i} className="mb-3 rounded-md border border-src-estimated/50 p-3">
              {g.map((r) => (
                <li key={r.id}>
                  <Link className="underline" href={`/alerts/${r.id}`}>{r.title}</Link>{" "}
                  <span className="text-sm text-muted">
                    {LEVEL_LABEL[r.level as Level]}, {ORIGIN_LABEL[r.origin as Origin]}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </Card>
      ) : null}
      <Card title="All alerts">
        {rows.length === 0 ? (
          <p>No alerts yet. When an approved threshold rule is breached by a live sensor, a draft appears here for a person to review.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-4">
                <Link className="font-semibold underline" href={`/alerts/${r.id}`}>{r.title}</Link>
                <p className="text-sm text-muted">
                  {LEVEL_LABEL[r.level as Level]}, {STATUS_LABEL[r.status as AlertStatus]}, {r.audience === "public" ? "public" : "internal"}, {r.location_text}
                </p>
                <p className="text-sm text-muted">{ORIGIN_LABEL[r.origin as Origin]}, version {r.version}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
