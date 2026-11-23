import type { SupabaseClient } from "@supabase/supabase-js";

export type FeatureKey =
  | "map"
  | "monitoring"
  | "alerts"
  | "forecasts"
  | "analytics"
  | "assets"
  | "assistant"
  | "community"
  | "api_access";

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  map: "Map",
  monitoring: "Monitoring",
  alerts: "Alerts",
  forecasts: "Forecasts",
  analytics: "Analytics",
  assets: "Assets and exposure",
  assistant: "Assistant",
  community: "Community reports",
  api_access: "API access",
};

export interface LimitUsage {
  limit: number | null;
  unlimited: boolean;
  used: number;
}
export interface Entitlements {
  managed: boolean;
  in_force: boolean;
  plan_key?: string;
  plan_name?: string;
  status?: string;
  starts_at?: string;
  ends_at?: string | null;
  features?: string[];
  limits?: Record<"locations" | "sensors" | "users", LimitUsage>;
  usage?: Record<"locations" | "sensors" | "users", number>;
  note?: string;
}

/** Reads the organisation's plan through the database function (it checks membership itself). */
export async function loadEntitlements(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ ok: true; e: Entitlements } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("entitlements", { p_org: orgId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, e: data as Entitlements };
}

export type Gate =
  | { allowed: true }
  | { allowed: false; reason: "plan_inactive" | "not_in_plan" };

/**
 * Same rule as the database (private.org_feature_allowed), used only to explain a block on screen.
 * The database enforces it either way. No plan assigned = unmanaged = not gated.
 */
export function featureGate(e: Entitlements, feature: FeatureKey): Gate {
  if (!e.managed) return { allowed: true };
  if (!e.in_force) return { allowed: false, reason: "plan_inactive" };
  return (e.features ?? []).includes(feature)
    ? { allowed: true }
    : { allowed: false, reason: "not_in_plan" };
}

export function gateMessage(gate: Gate, feature: FeatureKey): string | null {
  if (gate.allowed) return null;
  return gate.reason === "plan_inactive"
    ? `Your organisation's plan is not active, so ${FEATURE_LABEL[feature]} is unavailable. Existing data is kept. Contact HydroSight to restore the plan.`
    : `${FEATURE_LABEL[feature]} is not included in your organisation's plan. Contact HydroSight to change the plan.`;
}

export function limitText(l: LimitUsage): string {
  if (l.unlimited) return `${l.used} used, no limit`;
  return `${l.used} of ${l.limit ?? 0} used`;
}

/**
 * A message to show when the feature is blocked in EVERY organisation the person belongs to
 * (null when at least one allows it, or when entitlements could not be read: the database still
 * enforces the real limits, so a read failure never blocks the screen).
 */
export async function blockedMessage(
  supabase: SupabaseClient,
  orgIds: string[],
  feature: FeatureKey,
): Promise<string | null> {
  if (orgIds.length === 0) return null;
  const gates: Gate[] = [];
  for (const id of orgIds) {
    const r = await loadEntitlements(supabase, id);
    if (!r.ok) return null;
    gates.push(featureGate(r.e, feature));
  }
  if (gates.some((g) => g.allowed)) return null;
  return gateMessage(gates[0]!, feature);
}
