import Link from "next/link";
import { Shell } from "@/components/shell";
import { Card, ErrorNote } from "@/components/ui";
import {
  limitText,
  loadEntitlements,
  FEATURE_LABEL,
  type FeatureKey,
} from "@/lib/entitlements";
import { money, type InvoiceRow } from "@/lib/invoice-format";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";
import { paymentProviderFromEnv } from "@/lib/payments";

export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Billing({ searchParams }: { searchParams: SP }) {
  const a = await loadAccess("/billing");
  const sp = await searchParams;
  const want = Array.isArray(sp.org) ? sp.org[0] : sp.org;
  const orgs = a.memberships.map((m) => m.org_id as string);
  const orgId = want && orgs.includes(want) ? want : (orgs[0] ?? null);
  const can = orgId ? permissionsInOrg(orgId, a).has("billing.read") : false;
  const ent = orgId && can ? await loadEntitlements(a.supabase, orgId) : null;
  const inv =
    orgId && can
      ? await a.supabase
          .from("invoices")
          .select(
            "id, number, status, period_start, period_end, currency, total, issued_at, due_at",
          )
          .eq("org_id", orgId)
          .order("issued_at", { ascending: false })
      : null;
  const provider = paymentProviderFromEnv();
  return (
    <Shell title="Plan and billing" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>
        {a.loadError?.message ??
          (ent && !ent.ok ? ent.error : undefined) ??
          inv?.error?.message}
      </ErrorNote>
      {!orgId ? (
        <p>You are not a member of an organisation yet.</p>
      ) : !can ? (
        <p>Only organisation admins can see the plan and invoices.</p>
      ) : ent?.ok ? (
        <>
          <Card title="Your plan">
            {!ent.e.managed ? (
              <p>
                No plan is assigned to this organisation, so nothing is limited.
                Usage: {ent.e.usage?.locations ?? 0} locations,{" "}
                {ent.e.usage?.sensors ?? 0} sensors, {ent.e.usage?.users ?? 0}{" "}
                users.
              </p>
            ) : (
              <>
                <p className="text-lg font-semibold">
                  {ent.e.plan_name}{" "}
                  <span className="text-muted">({ent.e.status})</span>
                </p>
                {!ent.e.in_force ? (
                  <p
                    role="alert"
                    className="mt-2 rounded-md border border-src-synthetic/50 bg-src-synthetic/5 p-3"
                  >
                    This plan is not active. You cannot add stations, sensors,
                    users or assets. Existing data is kept and still readable.
                  </p>
                ) : null}
                {ent.e.ends_at ? (
                  <p className="text-muted">
                    Ends {new Date(ent.e.ends_at).toLocaleDateString("en-GB")}
                  </p>
                ) : null}
                <dl className="mt-4 grid max-w-md gap-1">
                  {ent.e.limits
                    ? (["locations", "sensors", "users"] as const).map((k) => (
                        <div
                          key={k}
                          className="flex justify-between border-b border-line py-1"
                        >
                          <dt className="capitalize">{k}</dt>
                          <dd>{limitText(ent.e.limits![k])}</dd>
                        </div>
                      ))
                    : null}
                </dl>
                <p className="mt-4 text-sm font-semibold">Included</p>
                <ul className="list-disc pl-5 text-sm">
                  {(ent.e.features ?? []).map((f) => (
                    <li key={f}>{FEATURE_LABEL[f as FeatureKey] ?? f}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-4 text-sm text-muted">
              Usage is counted live. A history of past usage is not kept yet.
            </p>
          </Card>
          <Card title="Invoices">
            {inv?.data && inv.data.length > 0 ? (
              <div className="overflow-x-auto" role="region" aria-label="Billing table" tabIndex={0}><table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="py-2">Number</th>
                    <th>Period</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(inv.data as unknown as InvoiceRow[]).map((i) => (
                    <tr key={i.id} className="border-b border-line">
                      <td className="py-2">
                        <Link
                          className="font-semibold text-ocean underline"
                          href={`/billing/invoice/${i.id}`}
                        >
                          {i.number ?? "(no number)"}
                        </Link>
                      </td>
                      <td>
                        {i.period_start} to {i.period_end}
                      </td>
                      <td>{money(i.total, i.currency)}</td>
                      <td>{i.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : (
              <p className="text-muted">No invoices yet.</p>
            )}
            <p className="mt-4 text-sm text-muted">
              {provider.name === "manual"
                ? "Online payment is not available. Pay by arrangement with HydroSight and quote the invoice number."
                : "Online payment is not available. Contact HydroSight to arrange payment and quote the invoice number."}
            </p>
          </Card>
        </>
      ) : null}
    </Shell>
  );
}
