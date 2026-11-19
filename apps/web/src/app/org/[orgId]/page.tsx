import { notFound } from "next/navigation";
import { ApiKeyForm, InviteForm, MemberActions, RevokeButton } from "@/components/org-admin";
import { Shell } from "@/components/shell";
import { Card, ErrorNote } from "@/components/ui";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!UUID.test(orgId)) notFound();
  const a = await loadAccess(`/org/${orgId}`);
  const perms = permissionsInOrg(orgId, a);
  if (!perms.has("org.read")) notFound(); // also what a user of another organisation sees

  const s = a.supabase;
  const [org, members, profiles, invites, keys] = await Promise.all([
    s.from("organizations").select("name").eq("id", orgId).single(),
    perms.has("members.read")
      ? s.from("memberships").select("id, user_id, role_key, status").eq("org_id", orgId).order("created_at")
      : null,
    perms.has("members.read") ? s.from("profiles").select("user_id, email, display_name") : null,
    perms.has("invitations.manage")
      ? s.from("invitations").select("id, email, role_key, expires_at, accepted_at, revoked_at").eq("org_id", orgId).order("created_at", { ascending: false })
      : null,
    perms.has("apikeys.manage")
      ? s.from("api_keys").select("id, name, key_prefix, scopes, expires_at, revoked_at, last_used_at").eq("org_id", orgId).order("created_at", { ascending: false })
      : null,
  ]);
  const email = new Map((profiles?.data ?? []).map((p) => [p.user_id, p.email]));
  const orgRoles = a.roleDefs.filter((r) => r.scope === "org");
  const grantable = [
    ...new Set(a.rolePerms.map((rp) => rp.permission_key)),
  ].filter((p) => perms.has(p) && !["org.manage", "members.manage", "invitations.manage", "apikeys.manage", "audit.read", "devices.manage", "thresholds.approve", "warnings.approve", "warnings.publish"].includes(p)).sort();
  const errors = [org.error, members?.error, profiles?.error, invites?.error, keys?.error]
    .filter(Boolean).map((e) => e!.message).join("; ");
  const canManage = perms.has("members.manage");

  return (
    <Shell title={org.data?.name ?? "Organisation"} signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{errors}</ErrorNote>

      {members?.data ? (
        <Card title="Members">
          <table className="w-full text-left text-sm">
            <thead><tr><th>Email</th><th>Role</th><th>Status</th>{canManage ? <th>Actions</th> : null}</tr></thead>
            <tbody>
              {members.data.map((m) => (
                <tr key={m.id} className="border-t border-ocean/40">
                  <td className="py-2">{email.get(m.user_id) ?? m.user_id.slice(0, 8)}</td>
                  <td>{a.roleDefs.find((r) => r.key === m.role_key)?.label ?? m.role_key}</td>
                  <td>{m.status}</td>
                  {canManage ? <td><MemberActions id={m.id} status={m.status} /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {invites ? (
        <Card title="Invitations">
          <InviteForm orgId={orgId} roles={orgRoles.map((r) => ({ key: r.key, label: r.label }))} />
          <table className="mt-5 w-full text-left text-sm">
            <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th>State</th><th /></tr></thead>
            <tbody>
              {(invites.data ?? []).map((i) => {
                const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
                return (
                  <tr key={i.id} className="border-t border-ocean/40">
                    <td className="py-2">{i.email}</td><td>{i.role_key}</td><td>{fmt(i.expires_at)}</td><td>{state}</td>
                    <td>{state === "pending" ? <RevokeButton kind="invitation" id={i.id} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {keys ? (
        <Card title="API keys">
          <ApiKeyForm orgId={orgId} scopes={grantable} />
          <table className="mt-5 w-full text-left text-sm">
            <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>State</th><th /></tr></thead>
            <tbody>
              {(keys.data ?? []).map((k) => {
                const state = k.revoked_at ? "revoked" : k.expires_at && new Date(k.expires_at) < new Date() ? "expired" : "active";
                return (
                  <tr key={k.id} className="border-t border-ocean/40">
                    <td className="py-2">{k.name}</td><td><code>hsk_{k.key_prefix}…</code></td>
                    <td>{k.scopes.join(", ")}</td><td>{fmt(k.last_used_at)}</td><td>{state}</td>
                    <td>{state === "active" ? <RevokeButton kind="api_key" id={k.id} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      {!members && !invites && !keys ? (
        <p className="text-[var(--text-muted)]">Your role has no administrative screens in this organisation.</p>
      ) : null}
    </Shell>
  );
}
