import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/shell";
import type { PageContent } from "@/lib/site-content";

export function PublicShell({
  children,
  signedInAs,
}: {
  children: ReactNode;
  signedInAs?: string;
}) {
  return (
    <>
      <SiteHeader signedInAs={signedInAs} />
      <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
      <SiteFooter />
    </>
  );
}

export function ContentPage({
  c,
  extra,
}: {
  c: PageContent;
  extra?: ReactNode;
}) {
  return (
    <PublicShell>
      <h1 className="max-w-[20ch] text-4xl font-extrabold md:text-5xl">
        {c.title}
      </h1>
      <p className="mt-5 max-w-[60ch] text-xl text-muted">{c.lead}</p>
      <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
        {c.sections.map((s) => (
          <section key={s.heading} className="border-t border-line pt-5">
            <h2 className="text-xl font-bold">{s.heading}</h2>
            {s.body ? <p className="mt-2 max-w-[60ch]">{s.body}</p> : null}
            {s.points ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
      {extra ?? (
        <p className="mt-12">
          <Link
            href="/demo"
            className="rounded-md bg-ocean px-5 py-2.5 font-semibold text-white hover:bg-ocean-deep"
          >
            Request a demo
          </Link>
        </p>
      )}
    </PublicShell>
  );
}
