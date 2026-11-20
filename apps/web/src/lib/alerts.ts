// UI-side mirror of the alert lifecycle rules enforced in the database (migration 0006).
// It only decides what to SHOW. The database remains the sole authority and re-checks every
// action, including permissions, state, and "drafter cannot approve their own public warning".

export const LEVELS = ["advisory", "watch", "warning", "severe_warning"] as const;
export type Level = (typeof LEVELS)[number];
export type AlertStatus =
  | "draft" | "in_review" | "approved" | "published" | "updated" | "cancelled" | "expired";
export type Origin =
  | "sensor_threshold" | "model_risk" | "official_warning" | "community_observation" | "human_emergency";
export type Audience = "internal" | "public";

export const LEVEL_LABEL: Record<Level, string> = {
  advisory: "Advisory", watch: "Watch", warning: "Warning", severe_warning: "Severe warning",
};
export const STATUS_LABEL: Record<AlertStatus, string> = {
  draft: "Draft", in_review: "In review", approved: "Approved", published: "Published",
  updated: "Superseded by a newer version", cancelled: "Cancelled", expired: "Expired",
};
export const ORIGIN_LABEL: Record<Origin, string> = {
  sensor_threshold: "Sensor threshold (automatic draft)",
  model_risk: "Model risk (automatic draft)",
  official_warning: "Official warning (attributed)",
  community_observation: "Community observation",
  human_emergency: "Human-declared emergency",
};

export interface AlertLite {
  status: AlertStatus;
  audience: Audience;
  org_id: string;
  drafted_by: string | null;
  expires_at: string | null;
  evidence: unknown[];
  expected_timing: string | null;
  duration_text: string | null;
  recommended_action: string | null;
  issuing_authority: string | null;
  review_at: string | null;
}

export type AlertAction =
  | "edit" | "submit" | "return" | "approve" | "publish" | "cancel" | "ack" | "new_version" | "false_alarm";

/** Which lifecycle buttons to offer. Not a permission decision: the database decides. */
export function availableActions(a: AlertLite, perms: Set<string>, userId: string): AlertAction[] {
  const out: AlertAction[] = [];
  const isDrafter = a.drafted_by === null || a.drafted_by === userId;
  if (a.status === "draft") {
    if (perms.has("warnings.draft") && isDrafter) out.push("edit", "submit");
    if (perms.has("warnings.approve") || (a.drafted_by === userId && perms.has("warnings.draft"))) out.push("cancel");
  }
  if (a.status === "in_review") {
    if (perms.has("warnings.approve") || perms.has("warnings.review")) out.push("return");
    if (perms.has("warnings.approve") && !(a.audience === "public" && a.drafted_by === userId)) out.push("approve");
    if (perms.has("warnings.approve") || (a.drafted_by === userId && perms.has("warnings.draft"))) out.push("cancel");
  }
  if (a.status === "approved" && perms.has("warnings.publish")) out.push("publish", "cancel");
  if (a.status === "published") {
    if (perms.has("readings.read") || perms.has("warnings.approve")) out.push("ack");
    if (perms.has("warnings.draft")) out.push("new_version");
    if (perms.has("warnings.publish")) out.push("cancel");
  }
  if (perms.has("warnings.approve") || perms.has("warnings.review")) out.push("false_alarm");
  return out;
}

/** Mirrors submit_alert(): the content every alert needs before review. */
export function missingContent(a: AlertLite, now: Date = new Date()): string[] {
  const missing: string[] = [];
  const blank = (s: string | null) => !s || s.trim() === "";
  if (blank(a.expected_timing)) missing.push("Expected timing");
  if (blank(a.duration_text)) missing.push("Expected duration");
  if (blank(a.recommended_action)) missing.push("Recommended action");
  if (blank(a.issuing_authority)) missing.push("Issuing authority");
  if (!Array.isArray(a.evidence) || a.evidence.length === 0) missing.push("Supporting evidence");
  if (!a.expires_at && !a.review_at) missing.push("Expiry or review time");
  if (a.expires_at && new Date(a.expires_at) <= now) missing.push("Expiry must be in the future");
  return missing;
}

/** Plain-language reason a public warning needs a second person. */
export const FOUR_EYES_NOTE =
  "A public warning needs two different people: one drafts it, another approves it. Publishing is a separate permission.";

export function isConflict(rows: { has_conflict: boolean }[]): boolean {
  return rows.some((r) => r.has_conflict);
}
