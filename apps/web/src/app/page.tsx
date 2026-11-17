import { MaturityBanner } from "@/components/maturity-banner";
import { SourceBadge, SOURCE_TYPES } from "@/components/source-badge";
import { BASE_PATH, IS_STATIC_PREVIEW } from "@/lib/base-path";
import { t } from "@/lib/i18n";

export default function Home() {
  return (
    <>
      <MaturityBanner status="prototype" />
      {IS_STATIC_PREVIEW && (
        <div role="note" className="w-full bg-surface-raised px-4 py-2 text-center text-sm">
          Static progress preview: no API, database, live data or sensors are connected here.
        </div>
      )}
      <main className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}/brand/hydrosight-logo.png`}
            alt="HydroSight"
            width={160}
            height={160}
            className="h-16 w-auto rounded bg-white"
          />
          <p className="text-lg text-[var(--text-muted)]">{t("en", "app.tagline")}</p>
        </header>

        <section className="rounded border border-ocean p-5" aria-labelledby="status-title">
          <h1 id="status-title" className="mb-2 text-xl font-semibold">
            {t("en", "status.title")}
          </h1>
          <p className="mb-4">{t("en", "status.foundations")}</p>
          <p className="mb-2 text-sm text-[var(--text-muted)]">
            Every value in HydroSight carries one of these source labels:
          </p>
          <ul className="flex flex-wrap gap-2">
            {SOURCE_TYPES.map((s) => (
              <li key={s}>
                <SourceBadge source={s} />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
