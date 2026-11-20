import { Card, ErrorNote } from "@/components/ui";
import { Shell } from "@/components/shell";
import { RuleActions, RuleForm } from "@/components/rule-forms";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";
import { LEVEL_LABEL, type Level } from "@/lib/alerts";

export default async function RulesPage() {
  const a = await loadAccess("/rules");
  const [rules, sensors, stations, orgs] = await Promise.all([
    a.supabase.from("threshold_rules").select("*").order("created_at", { ascending: false }),
    a.supabase.from("sensors").select("id, org_id, station_id, kind"),
    a.supabase.from("stations").select("id, name"),
    a.supabase.from("organizations").select("id, name"),
  ]);
  const stationName = new Map((stations.data ?? []).map((s) => [s.id, s.name]));
  const drafters = a.memberships.filter((m) => m.status === "active" && permissionsInOrg(m.org_id, a).has("thresholds.draft")).map((m) => m.org_id);
  const sensorOpts = (sensors.data ?? []).map((s) => ({
    id: s.id, org_id: s.org_id, kind: s.kind, label: `${stationName.get(s.station_id) ?? "Station"}, ${s.kind.replace("_", " ")}`,
  }));
  const rows = rules.data ?? [];
  return (
    <Shell title="Threshold rules" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? rules.error?.message ?? sensors.error?.message}</ErrorNote>
      <Card title="Rules">
        {rows.length === 0 ? <p>No rules yet. Until an approved rule exists, no automatic alert drafts are created.</p> : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const p = permissionsInOrg(r.org_id, a);
              const canActivate = r.status === "draft" && p.has("thresholds.approve") && r.drafted_by !== a.user.id;
              const canRetire = r.status !== "retired" && (p.has("thresholds.approve") || (r.status === "draft" && r.drafted_by === a.user.id && p.has("thresholds.draft")));
              return (
                <li key={r.id} className="rounded-lg border border-line p-4">
                  <p className="font-semibold">{r.name} <span className="text-sm font-normal text-muted">({r.status})</span></p>
                  <p className="text-sm">
                    {r.scope === "sensor" ? "One sensor" : `All ${String(r.sensor_kind).replace("_", " ")} sensors`}: {r.comparator === ">=" ? "at or above" : "at or below"} {r.threshold_value}, {LEVEL_LABEL[r.level as Level]}; hysteresis {r.hysteresis}, cooldown {r.cooldown_s}s
                  </p>
                  <p className="text-sm text-muted">Basis: {r.rationale ?? "none yet"}. Evidence: {r.evidence_ref ?? "none yet"}.</p>
                  {r.status === "draft" && r.drafted_by === a.user.id && p.has("thresholds.approve") ? (
                    <p className="text-sm text-muted">You drafted this rule, so someone else must approve it.</p>
                  ) : null}
                  <RuleActions id={r.id} canActivate={canActivate} canRetire={canRetire} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {drafters.length > 0 ? (
        <Card title="Draft a rule">
          <RuleForm orgs={(orgs.data ?? []).filter((o) => drafters.includes(o.id))} sensors={sensorOpts} />
        </Card>
      ) : null}
    </Shell>
  );
}
