import { Shell } from "@/components/shell";
import { AlertForm } from "@/components/alert-form";
import { ErrorNote } from "@/components/ui";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";

export default async function NewAlert() {
  const a = await loadAccess("/alerts/new");
  const orgIds = a.memberships
    .filter((m) => m.status === "active" && permissionsInOrg(m.org_id, a).has("warnings.draft"))
    .map((m) => m.org_id);
  const [orgs, stations] = await Promise.all([
    a.supabase.from("organizations").select("id, name").in("id", orgIds),
    a.supabase.from("stations").select("id, org_id, name").in("org_id", orgIds),
  ]);
  return (
    <Shell title="Draft an alert" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{orgs.error?.message ?? stations.error?.message}</ErrorNote>
      {orgIds.length === 0 ? (
        <p>Your role cannot draft alerts.</p>
      ) : (
        <AlertForm orgs={orgs.data ?? []} stations={stations.data ?? []} />
      )}
    </Shell>
  );
}
