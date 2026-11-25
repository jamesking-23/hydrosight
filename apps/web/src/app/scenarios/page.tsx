import {
  ScenarioApp,
  type SavedComparison,
  type OrgChoice,
} from "@/components/scenario-app";
import { Shell } from "@/components/shell";
import { ErrorNote } from "@/components/ui";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";

export const dynamic = "force-dynamic";

export default async function Scenarios() {
  const a = await loadAccess("/scenarios");
  const orgIds = [...new Set(a.memberships.map((m) => m.org_id))];
  const [orgs, saved] = await Promise.all([
    a.supabase.from("organizations").select("id, name").in("id", orgIds),
    a.supabase
      .from("scenario_validations")
      .select(
        "id, org_id, event_name, event_date, terrain_name, data_origin, status, comparison, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const choices: OrgChoice[] = (orgs.data ?? []).map((o) => {
    const p = permissionsInOrg(o.id as string, a);
    return {
      id: o.id as string,
      name: o.name as string,
      canRecord: p.has("models.manage"),
      canConfirm: p.has("models.promote"),
    };
  });
  return (
    <Shell title="Flood scenarios" signedInAs={a.user.email ?? undefined} wide>
      <ErrorNote>{orgs.error?.message ?? saved.error?.message}</ErrorNote>
      <ScenarioApp
        orgs={choices}
        saved={(saved.data ?? []) as unknown as SavedComparison[]}
      />
    </Shell>
  );
}
