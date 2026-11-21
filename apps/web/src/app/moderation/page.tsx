import { Card, ErrorNote } from "@/components/ui";
import { ModerationQueue, ResourceAdmin } from "@/components/moderation-queue";
import { Shell } from "@/components/shell";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";

export default async function Moderation() {
  const a = await loadAccess("/moderation");
  const { data: orgs, error } = await a.supabase.from("organizations").select("id, name");
  const mine = (orgs ?? []).filter((o) =>
    a.memberships.some((m) => m.org_id === o.id && m.status === "active" && permissionsInOrg(o.id, a).has("community.moderate")),
  );
  return (
    <Shell title="Community moderation" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? error?.message}</ErrorNote>
      {mine.length === 0 ? (
        <p className="text-sm text-muted">Your role does not include community moderation.</p>
      ) : (
        <>
          <Card title="Reports">
            <ModerationQueue orgs={mine} />
          </Card>
          <Card title="Safe places and emergency information">
            <ResourceAdmin orgs={mine} userId={a.user.id} />
          </Card>
        </>
      )}
    </Shell>
  );
}
