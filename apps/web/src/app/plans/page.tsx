import Link from "next/link";
import { PublicShell } from "@/components/content-page";
import { FEATURE_LABEL, type FeatureKey } from "@/lib/entitlements";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans | HydroSight" };

interface PlanRow {
  key: string;
  name: string;
  description: string;
  price_amount: string | number | null;
  price_currency: string | null;
  price_interval: string | null;
  price_basis: string | null;
}

export default async function Plans() {
  let plans: PlanRow[] = [];
  const limits: Record<string, Record<string, number | null>> = {};
  const feats: Record<string, string[]> = {};
  let failed = false;
  if (isSupabaseConfigured) {
    const sb = await createClient();
    const [p, l, f] = await Promise.all([
      sb
        .from("plans")
        .select(
          "key, name, description, price_amount, price_currency, price_interval, price_basis",
        )
        .eq("published", true)
        .order("sort_order"),
      sb.from("plan_limits").select("plan_key, limit_key, value"),
      sb.from("plan_features").select("plan_key, feature_key"),
    ]);
    failed = Boolean(p.error || l.error || f.error);
    plans = (p.data ?? []) as PlanRow[];
    for (const r of l.data ?? [])
      (limits[r.plan_key] ??= {})[r.limit_key] = r.value;
    for (const r of f.data ?? [])
      (feats[r.plan_key] ??= []).push(r.feature_key);
  }
  const lim = (k: string, key: string) => {
    const v = limits[k];
    if (!v || !(key in v)) return "none";
    return v[key] === null ? "unlimited" : String(v[key]);
  };
  return (
    <PublicShell>
      <h1 className="max-w-[20ch] text-4xl font-extrabold md:text-5xl">
        Service plans
      </h1>
      {failed ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-src-synthetic/50 bg-src-synthetic/5 p-4"
        >
          Plans could not be loaded right now. Try again shortly.
        </p>
      ) : plans.length === 0 ? (
        <div className="mt-6 max-w-[60ch]">
          <p className="text-xl text-muted">
            Plans are being finalised and are not published yet. No prices are
            quoted until they are.
          </p>
          <p className="mt-6">
            <Link
              href="/demo"
              className="rounded-md bg-ocean px-5 py-2.5 font-semibold text-white hover:bg-ocean-deep"
            >
              Request a demo
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <section key={p.key} className="rounded-md border border-line p-5">
              <h2 className="text-xl font-bold">{p.name}</h2>
              <p className="mt-1 text-muted">{p.description}</p>
              <p className="mt-4 font-semibold">
                {p.price_amount !== null
                  ? `${p.price_currency} ${Number(p.price_amount).toLocaleString("en")} per ${p.price_interval}`
                  : "Price on request"}
              </p>
              {p.price_basis ? (
                <p className="text-sm text-muted">{p.price_basis}</p>
              ) : null}
              <dl className="mt-4 text-sm">
                <div className="flex justify-between">
                  <dt>Locations</dt>
                  <dd>{lim(p.key, "locations")}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Sensors</dt>
                  <dd>{lim(p.key, "sensors")}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Users</dt>
                  <dd>{lim(p.key, "users")}</dd>
                </div>
              </dl>
              <ul className="mt-4 list-disc pl-5 text-sm">
                {(feats[p.key] ?? []).sort().map((f) => (
                  <li key={f}>{FEATURE_LABEL[f as FeatureKey] ?? f}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-10 max-w-[60ch] text-sm text-muted">
        Online payment is not available. Invoices are issued by HydroSight and
        paid by arrangement.
      </p>
    </PublicShell>
  );
}
