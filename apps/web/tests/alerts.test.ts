import { describe, expect, it } from "vitest";
import { availableActions, isConflict, missingContent, type AlertLite } from "@/lib/alerts";

const base: AlertLite = {
  status: "draft", audience: "public", org_id: "o", drafted_by: "u1", expires_at: null,
  evidence: [], expected_timing: null, duration_text: null, recommended_action: null,
  issuing_authority: null, review_at: null,
};

describe("availableActions", () => {
  it("lets the drafter edit and submit, not another drafter", () => {
    const p = new Set(["warnings.draft"]);
    expect(availableActions(base, p, "u1")).toEqual(expect.arrayContaining(["edit", "submit", "cancel"]));
    expect(availableActions(base, p, "u2")).not.toContain("submit");
  });
  it("never offers approve to the drafter of a public alert", () => {
    const a = { ...base, status: "in_review" as const };
    const p = new Set(["warnings.draft", "warnings.approve"]);
    expect(availableActions(a, p, "u1")).not.toContain("approve");
    expect(availableActions(a, p, "u2")).toContain("approve");
  });
  it("publishing needs its own permission", () => {
    const a = { ...base, status: "approved" as const };
    expect(availableActions(a, new Set(["warnings.approve"]), "u2")).not.toContain("publish");
    expect(availableActions(a, new Set(["warnings.publish"]), "u2")).toContain("publish");
  });
  it("offers nothing on closed alerts except false-alarm tagging", () => {
    const a = { ...base, status: "cancelled" as const };
    expect(availableActions(a, new Set(["warnings.approve", "warnings.publish", "warnings.draft"]), "u2")).toEqual(["false_alarm"]);
  });
  it("community members can acknowledge a published alert only", () => {
    const a = { ...base, status: "published" as const };
    expect(availableActions(a, new Set(["readings.read"]), "u3")).toEqual(["ack"]);
  });
});

describe("missingContent", () => {
  it("lists every missing required field", () => {
    expect(missingContent(base)).toHaveLength(6);
  });
  it("accepts a complete alert and rejects a past expiry", () => {
    const ok = { ...base, expected_timing: "6h", duration_text: "12h", recommended_action: "Move to high ground",
      issuing_authority: "District office", evidence: [{}], expires_at: "2030-01-01T00:00:00Z" };
    expect(missingContent(ok, new Date("2029-01-01"))).toEqual([]);
    expect(missingContent(ok, new Date("2031-01-01"))).toEqual(["Expiry must be in the future"]);
  });
});

describe("isConflict", () => {
  it("flags any conflicting row", () => {
    expect(isConflict([{ has_conflict: false }, { has_conflict: true }])).toBe(true);
    expect(isConflict([])).toBe(false);
  });
});
