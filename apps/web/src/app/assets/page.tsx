import { AssetFormView } from "@/components/asset-form";
import { ReportView } from "@/components/report-view";
import { Shell } from "@/components/shell";
import { ErrorNote } from "@/components/ui";
import { blockedMessage } from "@/lib/entitlements";
import { loadAccess, permissionsInOrg } from "@/lib/load-access";
import { loadAssetsReport } from "@/lib/report-data";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? null;

export default async function Assets({ searchParams }: { searchParams: SP }) {
  const a = await loadAccess("/assets");
  const sp = await searchParams;
  const orgs = a.memberships.map((m) => m.org_id as string);
  const orgId =
    one(sp.org) && orgs.includes(one(sp.org) as string)
      ? (one(sp.org) as string)
      : (orgs[0] ?? null);
  const blocked = orgId
    ? await blockedMessage(a.supabase, [orgId], "assets")
    : null;
  if (blocked)
    return (
      <Shell title="Assets and exposure" signedInAs={a.user.email ?? undefined}>
        <ErrorNote>{blocked}</ErrorNote>
      </Shell>
    );
  const names = orgId
    ? await a.supabase.from("organizations").select("id, name").in("id", orgs)
    : null;
  const loaded = orgId
    ? await loadAssetsReport(a.supabase, a.user.email ?? a.user.id, orgId)
    : null;
  const canManage = orgId
    ? permissionsInOrg(orgId, a).has("assets.manage")
    : false;
  return (
    <Shell title="Assets and exposure" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>
        {a.loadError?.message ??
          (loaded && !loaded.ok ? loaded.error : undefined)}
      </ErrorNote>
      {orgs.length > 1 ? (
        <form method="get" className="mb-6 flex items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">
              Organisation
            </span>
            <select
              name="org"
              defaultValue={orgId ?? ""}
              className="rounded-md border border-[#b9cad8] bg-white px-3 py-2"
            >
              {(names?.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md border border-[#b9cad8] bg-white px-3 py-2 text-sm font-semibold">
            Switch
          </button>
        </form>
      ) : null}
      {!orgId ? (
        <p className="text-sm text-muted">
          You are not a member of an organisation yet.
        </p>
      ) : null}
      {orgId && canManage ? (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold">Register an asset</h2>
          <AssetFormView orgId={orgId} />
        </section>
      ) : null}
      {loaded && loaded.ok ? (
        <ReportView
          report={loaded.report}
          downloads={(["csv", "xlsx", "pdf"] as const).map((f) => ({
            label: f.toUpperCase(),
            href: `/api/reports/assets?org=${orgId}&format=${f}`,
          }))}
        />
      ) : null}
    </Shell>
  );
}
