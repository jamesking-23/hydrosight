// UI-side mirror of the database rule in private.has_permission(). It only decides what to
// SHOW. The database remains the sole authority and re-checks every action.

export type Aal = "aal1" | "aal2" | null;
export interface RoleDef {
  key: string;
  requires_mfa: boolean;
}
export interface MembershipLite {
  role_key: string;
  status: string;
}

export function needsMfaStep(
  memberships: MembershipLite[],
  roles: RoleDef[],
  aal: Aal,
): boolean {
  if (aal === "aal2") return false;
  const mfa = new Set(roles.filter((r) => r.requires_mfa).map((r) => r.key));
  return memberships.some((m) => m.status === "active" && mfa.has(m.role_key));
}

export function effectivePermissions(
  memberships: MembershipLite[],
  roles: RoleDef[],
  rolePermissions: { role_key: string; permission_key: string }[],
  aal: Aal,
): Set<string> {
  const requiresMfa = new Map(roles.map((r) => [r.key, r.requires_mfa]));
  const held = new Set(
    memberships
      .filter((m) => m.status === "active")
      .filter((m) => !requiresMfa.get(m.role_key) || aal === "aal2")
      .map((m) => m.role_key),
  );
  return new Set(
    rolePermissions.filter((rp) => held.has(rp.role_key)).map((rp) => rp.permission_key),
  );
}

/** Only same-site relative paths are allowed as post-login targets (no open redirect). */
export function sanitizeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}

/** Reads an invitation token from a URL fragment (#token=...) so it never reaches server logs. */
export function tokenFromHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const value = new URLSearchParams(raw).get("token") ?? raw;
  return /^hsi_[0-9a-f]{64}$/.test(value) ? value : "";
}
