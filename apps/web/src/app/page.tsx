import Link from "next/link";
import { Hydrograph } from "@/components/hydrograph";
import { SiteFooter, SiteHeader } from "@/components/shell";
import { SOURCE_TYPES, SourceBadge } from "@/components/source-badge";
import {
  HOME_NOT_YET as NOT_YET,
  HOME_WORKS as WORKS,
} from "@/lib/site-content";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-10 px-6 py-14 md:grid-cols-[1.05fr_1fr] md:py-20">
          <div>
            <h1 className="max-w-[16ch] text-5xl font-extrabold md:text-6xl">
              Flood risk and early warning for East Africa
            </h1>
            <p className="mt-6 max-w-[44ch] text-xl text-muted">
              HydroSight brings river and rain readings, forecasts and community
              reports into one place, and labels every number with where it came
              from.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="rounded-md bg-ocean px-5 py-2.5 font-semibold text-white hover:bg-ocean-deep"
              >
                Request a demo
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-[#b9cad8] px-5 py-2.5 font-semibold hover:border-ocean"
              >
                Sign in
              </Link>
              <Link
                href="/invite"
                className="rounded-md border border-[#b9cad8] px-5 py-2.5 font-semibold hover:border-ocean"
              >
                Accept an invitation
              </Link>
            </div>
          </div>
          <Hydrograph />
        </section>

        <section className="border-y border-line bg-mist">
          <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-2">
            <div>
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
            <div>
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

        <section className="mx-auto max-w-5xl px-6 py-12">
          <h2 className="text-2xl font-bold">Every value shows its source</h2>
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
