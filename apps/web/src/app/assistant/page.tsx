import { AssistantLimit } from "@/components/assistant-limit";
import { AssistantPanel } from "@/components/assistant-panel";
import { Shell } from "@/components/shell";
import { ErrorNote } from "@/components/ui";
import { blockedMessage } from "@/lib/entitlements";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Assistant({
  searchParams,
}: {
  searchParams: SP;
}) {
  const a = await loadAccess("/assistant");
  const sp = await searchParams;
  const want = Array.isArray(sp.org) ? sp.org[0] : sp.org;
  const orgs = a.memberships.map((m) => m.org_id as string);
  const orgId = want && orgs.includes(want) ? want : (orgs[0] ?? null);
  const blocked = orgId
    ? await blockedMessage(a.supabase, [orgId], "assistant")
    : null;
  if (blocked)
    return (
      <Shell title="Assistant" signedInAs={a.user.email ?? undefined}>
        <ErrorNote>{blocked}</ErrorNote>
      </Shell>
    );
  const perms = orgId ? permissionsInOrg(orgId, a) : new Set<string>();
  const lim =
    orgId && (perms.has("assistant.manage") || perms.has("assistant.use"))
      ? await a.supabase
          .from("assistant_limits")
          .select("enabled, daily_token_cap, max_tokens_per_turn")
          .eq("org_id", orgId)
          .maybeSingle()
      : null;
  return (
    <Shell title="Data assistant" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? lim?.error?.message}</ErrorNote>
      {!orgId ? (
        <p className="text-sm text-muted">
          You are not a member of an organisation yet.
        </p>
      ) : null}
      {orgId && perms.has("assistant.manage") ? (
        <AssistantLimit
          orgId={orgId}
          enabled={lim?.data?.enabled ?? false}
          cap={lim?.data?.daily_token_cap ?? null}
          perTurn={lim?.data?.max_tokens_per_turn ?? null}
        />
      ) : null}
      {orgId && perms.has("assistant.use") ? (
        <AssistantPanel orgId={orgId} />
      ) : null}
      {orgId && !perms.has("assistant.use") ? (
        <p className="text-sm text-muted">
          Your role in this organisation cannot use the assistant.
        </p>
      ) : null}
    </Shell>
  );
}
