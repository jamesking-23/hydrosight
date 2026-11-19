import { describe, expect, it } from "vitest";
import { effectivePermissions, needsMfaStep, sanitizeNext, tokenFromHash } from "@/lib/access";

const roles = [
  { key: "org_admin", requires_mfa: true },
  { key: "hydrologist", requires_mfa: false },
];
const rp = [
  { role_key: "org_admin", permission_key: "invitations.manage" },
  { role_key: "hydrologist", permission_key: "readings.read" },
];

describe("access mirror", () => {
  it("withholds MFA-required roles' permissions at aal1", () => {
    const m = [{ role_key: "org_admin", status: "active" }];
    expect(effectivePermissions(m, roles, rp, "aal1").size).toBe(0);
    expect(effectivePermissions(m, roles, rp, "aal2").has("invitations.manage")).toBe(true);
  });
  it("keeps non-MFA roles working at aal1", () => {
    const m = [{ role_key: "hydrologist", status: "active" }];
    expect(effectivePermissions(m, roles, rp, "aal1").has("readings.read")).toBe(true);
  });
  it("ignores suspended memberships", () => {
    const m = [{ role_key: "hydrologist", status: "suspended" }];
    expect(effectivePermissions(m, roles, rp, "aal2").size).toBe(0);
    expect(needsMfaStep([{ role_key: "org_admin", status: "suspended" }], roles, "aal1")).toBe(false);
  });
  it("requires an MFA step only when an active MFA role is held below aal2", () => {
    const admin = [{ role_key: "org_admin", status: "active" }];
    expect(needsMfaStep(admin, roles, "aal1")).toBe(true);
    expect(needsMfaStep(admin, roles, null)).toBe(true);
    expect(needsMfaStep(admin, roles, "aal2")).toBe(false);
    expect(needsMfaStep([{ role_key: "hydrologist", status: "active" }], roles, "aal1")).toBe(false);
  });
});

describe("sanitizeNext", () => {
  it("allows relative paths and rejects anything off-site", () => {
    expect(sanitizeNext("/org/123?x=1")).toBe("/org/123?x=1");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil", "javascript:1", "", null]) {
      expect(sanitizeNext(bad as string | null)).toBe("/dashboard");
    }
  });
});

describe("tokenFromHash", () => {
  const token = `hsi_${"a".repeat(64)}`;
  it("reads valid tokens from #token= or a bare fragment", () => {
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
    expect(tokenFromHash(`#${token}`)).toBe(token);
  });
  it("rejects malformed tokens", () => {
    expect(tokenFromHash("#token=nope")).toBe("");
    expect(tokenFromHash("")).toBe("");
  });
});
