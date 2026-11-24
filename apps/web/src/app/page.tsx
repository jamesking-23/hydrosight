import Link from "next/link";
import { Hydrograph } from "@/components/hydrograph";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { SOURCE_TYPES, SourceBadge } from "@/components/source-badge";
import {
  HOME_NOT_YET as NOT_YET,
  HOME_WORKS as WORKS,
} from "@/lib/site-content";

const icon = "h-5 w-5";
const PRINCIPLES = [
  {
    title: "Every value shows its source",
    body: "Measured, forecast, estimated, community or synthetic: the label is always next to the number.",
    icon: (
      <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12V4h8l10 10-8 8L3 12z" />
        <circle cx="7.5" cy="8.5" r="1.2" />
      </svg>
    ),
  },
  {
    title: "People approve every warning",
    body: "A warning is drafted by one person and approved by a different one. Nothing is sent automatically.",
    icon: (
      <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
        <path d="M16 11l2.2 2.2L22 9.5" />
      </svg>
    ),
  },
  {
    title: "Stale and offline are shown",
    body: "A sensor that stops reporting is marked as stale or offline, never shown as live.",
    icon: (
      <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" />
        <path d="M3 3l18 18" />
      </svg>
    ),
  },
] as const;

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden bg-gradient-to-b from-[#e8f2f9] via-[#f4f9fc] to-white">
          <svg
            aria-hidden="true"
            viewBox="0 0 1440 220"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full [mask-image:linear-gradient(to_bottom,black_55%,transparent)] md:h-40"
          >
            <path
              d="M0 120 C180 60 300 180 520 130 S880 40 1100 100 S1360 150 1440 90 L1440 220 L0 220 Z"
              fill="#1b5e9b"
              opacity="0.06"
            />
            <path
              d="M0 160 C220 110 360 210 600 165 S940 90 1160 140 S1380 190 1440 150 L1440 220 L0 220 Z"
              fill="#0e7f7a"
              opacity="0.07"
            />
          </svg>
          <div className="relative mx-auto grid max-w-5xl items-center gap-10 px-4 py-10 sm:px-6 md:grid-cols-[1.05fr_1fr] md:py-20">
          <div>
            <h1 className="max-w-[16ch] text-4xl font-extrabold sm:text-5xl md:text-6xl">
              Flood risk and early warning for East Africa
            </h1>
            <p className="mt-5 max-w-[44ch] text-lg text-muted sm:mt-6 sm:text-xl">
              HydroSight brings river and rain readings, forecasts and community
              reports into one place, and labels every number with where it came
              from.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="inline-flex min-h-11 items-center rounded-md bg-ocean px-5 font-semibold text-white shadow-sm hover:bg-ocean-deep"
              >
                Request a demo
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center rounded-md border border-[#b9cad8] bg-white px-5 font-semibold hover:border-ocean"
              >
                Sign in
              </Link>
              <Link
                href="/invite"
                className="inline-flex min-h-11 items-center rounded-md border border-[#b9cad8] bg-white px-5 font-semibold hover:border-ocean"
              >
                Accept an invitation
              </Link>
            </div>
          </div>
          <Hydrograph />
          </div>
        </section>

        <section aria-label="How HydroSight works" className="mx-auto max-w-5xl px-4 pb-4 pt-10 sm:px-6">
          <ul className="grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <li key={p.title} className="rounded-xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(11,31,51,0.04)]">
                <span aria-hidden="true" className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-mist text-ocean">
                  {p.icon}
                </span>
                <h2 className="text-lg font-bold">{p.title}</h2>
                <p className="mt-1 text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 border-y border-line bg-mist">
          <div className="mx-auto grid max-w-5xl gap-5 px-4 py-10 sm:px-6 md:grid-cols-2 md:py-12">
            <div className="rounded-xl border border-line bg-white p-5 sm:p-6">
              <h2 className="text-2xl font-bold">Built and working</h2>
              <ul className="mt-4 space-y-3">
                {WORKS.map((w) => (
                  <li key={w} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-leaf"
                    />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-dashed border-[#b9cad8] bg-white/60 p-5 sm:p-6">
              <h2 className="text-2xl font-bold">Not available yet</h2>
              <ul className="mt-4 space-y-3">
                {NOT_YET.map((w) => (
                  <li key={w} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-2 h-2 w-2 shrink-0 rounded-full border-2 border-muted"
                    />
                    {w}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-muted">
                Nothing here has been validated for an area yet. Everything is
                labelled unvalidated until a named person promotes it with
                evidence.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
          <h2 className="text-2xl font-bold">The five source labels</h2>
          <p className="mt-2 max-w-[60ch] text-muted">
            Nothing in HydroSight appears without one of these labels, so a
            forecast is never read as a measurement and a community report is
            never read as verified.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {SOURCE_TYPES.map((s) => (
              <li key={s}>
                <SourceBadge source={s} />
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
