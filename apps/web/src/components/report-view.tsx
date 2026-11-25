import type { Report } from "@/lib/report";

/** Renders a Report exactly as the exports contain it. */
export function ReportView({
  report,
  downloads,
}: {
  report: Report;
  downloads: { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">Download this report:</span>
        {downloads.map((d) => (
          <a
            key={d.label}
            href={d.href}
            className="rounded-md border border-[#b9cad8] bg-white px-3 py-1 text-sm font-semibold hover:border-ocean"
          >
            {d.label}
          </a>
        ))}
        <span className="text-xs text-muted">
          Each download shows the same tables, window, sources and assumptions
          as this page, and is logged.
        </span>
      </div>
      <section
        aria-label="About this report"
        className="mb-6 rounded-md border border-line bg-white p-4 text-sm"
      >
        <p className="font-semibold">{report.maturity}</p>
        <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr]">
          <dt className="font-semibold">Data window</dt>
          <dd>
            {report.window
              ? `${report.window.from} to ${report.window.to}`
              : "all current records"}
          </dd>
          <dt className="font-semibold">Generated</dt>
          <dd>
            {report.generatedAt} by {report.generatedBy}
          </dd>
          <dt className="font-semibold">Sources</dt>
          <dd>
            <ul className="list-disc pl-5">
              {report.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </dd>
          <dt className="font-semibold">Assumptions</dt>
          <dd>
            <ul className="list-disc pl-5">
              {report.assumptions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </section>
      {report.tables.map((t) => (
        <section key={t.title} className="mb-6 overflow-x-auto" role="region" aria-label={t.title} tabIndex={0}>
          <h3 className="mb-2 font-bold">{t.title}</h3>
          {t.rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {t.columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="border-b border-line py-1 pr-3 text-left font-semibold"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i} className="align-top">
                    {row.map((c, j) => (
                      <td key={j} className="border-b border-line/60 py-1 pr-3">
                        {c === null ? "" : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {t.note ? <p className="mt-1 text-xs text-muted">{t.note}</p> : null}
        </section>
      ))}
    </div>
  );
}
