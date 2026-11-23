import { PlatformAdmin } from "@/components/platform-admin";
import { Shell } from "@/components/shell";
import { loadAccess } from "@/lib/load-access";

export const dynamic = "force-dynamic";

export default async function Platform() {
  const a = await loadAccess("/platform");
  const me = await a.supabase.rpc("my_platform_access");
  if (me.error || me.data !== true)
    return (
      <Shell title="Platform" signedInAs={a.user.email ?? undefined}>
        <p>This area is for HydroSight platform staff only.</p>
      </Shell>
    );
  const [demos, plans, limits, feats, orgs, plansOrg, invoices] =
    await Promise.all([
      a.supabase
        .from("demo_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      a.supabase.from("plans").select("*").order("sort_order"),
      a.supabase.from("plan_limits").select("plan_key, limit_key, value"),
      a.supabase.from("plan_features").select("plan_key, feature_key"),
      a.supabase.rpc("platform_orgs"),
      a.supabase.from("org_plans").select("org_id, plan_key, status, ends_at"),
      a.supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
  const err = [demos, plans, limits, feats, orgs, plansOrg, invoices].find(
    (r) => r.error,
  )?.error;
  return (
    <Shell title="Platform" signedInAs={a.user.email ?? undefined} wide>
      <PlatformAdmin
        loadError={err?.message ?? null}
        demos={demos.data ?? []}
        plans={plans.data ?? []}
        limits={limits.data ?? []}
        features={feats.data ?? []}
        orgs={(orgs.data ?? []) as { id: string; name: string }[]}
        orgPlans={plansOrg.data ?? []}
        invoices={invoices.data ?? []}
      />
    </Shell>
  );
}
