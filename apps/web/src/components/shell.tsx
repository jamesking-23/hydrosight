import Link from "next/link";
import type { ReactNode } from "react";
import { MaturityBanner } from "@/components/maturity-banner";
import { SignOutButton } from "@/components/sign-out-button";

export function Shell({
  children,
  signedInAs,
  title,
}: {
  children: ReactNode;
  signedInAs?: string;
  title?: string;
}) {
  return (
    <>
      <MaturityBanner status="prototype" />
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold">
          HydroSight
        </Link>
        {signedInAs ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--text-muted)]">{signedInAs}</span>
            <SignOutButton />
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-4xl px-6 pb-16">
        {title ? <h1 className="mb-6 text-2xl font-semibold">{title}</h1> : null}
        {children}
      </main>
    </>
  );
}

export function NotConfigured() {
  return (
    <p role="alert" className="rounded border border-src-synthetic p-4">
      Sign-in is not available: the Supabase connection is not configured on this deployment
      (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
    </p>
  );
}
