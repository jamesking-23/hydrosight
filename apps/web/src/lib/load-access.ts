import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { effectivePermissions, needsMfaStep, type Aal } from "@/lib/access";

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role_key: string;
  status: string;
}

/** Loads the signed-in user, their memberships, and what they may do. Redirects as needed. */
export async function loadAccess(returnTo: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (aalData?.currentLevel ?? null) as Aal;

  const [mine, roles, rolePerms] = await Promise.all([
    supabase.from("memberships").select("id, org_id, user_id, role_key, status").eq("user_id", user.id),
    supabase.from("roles").select("key, label, scope, requires_mfa"),
    supabase.from("role_permissions").select("role_key, permission_key"),
  ]);
  const loadError = mine.error ?? roles.error ?? rolePerms.error;
  const memberships = (mine.data ?? []) as Membership[];
  const roleDefs = roles.data ?? [];
  if (!loadError && needsMfaStep(memberships, roleDefs, aal)) {
    redirect(`/mfa?next=${encodeURIComponent(returnTo)}`);
  }
  return { supabase, user, aal, memberships, roleDefs, rolePerms: rolePerms.data ?? [], loadError };
}

export function permissionsInOrg(
  orgId: string,
  a: Awaited<ReturnType<typeof loadAccess>>,
): Set<string> {
  return effectivePermissions(
    a.memberships.filter((m) => m.org_id === orgId),
    a.roleDefs,
    a.rolePerms,
    a.aal,
  );
}
