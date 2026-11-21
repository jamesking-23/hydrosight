import { ReportView } from "@/components/report-view";
import { Shell } from "@/components/shell";
import { ErrorNote, Field } from "@/components/ui";
import { loadAccess } from "@/lib/load-access";
import { defaultWindow, loadAnalyticsReport } from "@/lib/report-data";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? null;

export default async function Analytics({
  searchParams,
}: {
  searchParams: SP;
}) {
  const a = await loadAccess("/analytics");
  const sp = await searchParams;
  const dw = defaultWindow();
  const q = {
    station: one(sp.station),
    from: one(sp.from) ?? dw.from,
    to: one(sp.to) ?? dw.to,
    warn: one(sp.warn),
  };
  const stations = await a.supabase
    .from("stations")
    .select("id, name")
    .order("name");
  const loaded = q.station
    ? await loadAnalyticsReport(a.supabase, a.user.email ?? a.user.id, q)
    : null;
  const qs = new URLSearchParams({
    station: q.station ?? "",
    from: q.from,
    to: q.to,
    ...(q.warn ? { warn: q.warn } : {}),
  });
  return (
    <Shell title="Analytics" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>
        {a.loadError?.message ??
          stations.error?.message ??
          (loaded && !loaded.ok ? loaded.error : undefined)}
      </ErrorNote>
      <form method="get" className="mb-8 grid max-w-3xl gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold">Station</span>
          <select
            name="station"
            defaultValue={q.station ?? ""}
            className="w-full rounded-md border border-[#b9cad8] bg-white px-3 py-2"
          >
            <option value="">Choose a station</option>
            {(stations.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="From" name="from" type="date" defaultValue={q.from} />
        <Field label="To" name="to" type="date" defaultValue={q.to} />
        <Field
          label="Warning probability for forecast verification (optional, 0 to 1)"
          name="warn"
          inputMode="decimal"
          defaultValue={q.warn ?? ""}
        />
        <div className="flex items-end">
          <button className="rounded-md bg-ocean px-4 py-2 font-semibold text-white hover:bg-ocean-deep">
            Show analytics
          </button>
        </div>
      </form>
      {loaded && loaded.ok ? (
        <ReportView
          report={loaded.report}
          downloads={(["csv", "xlsx", "pdf"] as const).map((f) => ({
            label: f.toUpperCase(),
            href: `/api/reports/analytics?${qs.toString()}&format=${f}`,
          }))}
        />
      ) : !q.station ? (
        <p className="text-sm text-muted">
          Choose a station and a window. Everything shown comes from stored
          readings; gaps are shown, never filled in.
        </p>
      ) : null}
    </Shell>
  );
}
