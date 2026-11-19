import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";

export function Logo({ className = "h-12" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/hydrosight-logo.png" alt="HydroSight" className={`${className} w-auto`} />
  );
}

export function SiteHeader({ signedInAs }: { signedInAs?: string }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" aria-label="HydroSight home">
          <Logo />
        </Link>
        {signedInAs ? (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="font-semibold hover:text-ocean">
              Dashboard
            </Link>
            <Link href="/map" className="font-semibold hover:text-ocean">
              Map
            </Link>
            <span className="hidden text-muted sm:inline">{signedInAs}</span>
            <SignOutButton />
          </nav>
        ) : (
          <nav className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/login" className="hover:text-ocean">
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <p className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted">
        HydroSight is decision-support software. Forecasts and risk estimates are advisory until
        validated for your area, and public warnings are issued only after human approval.
      </p>
    </footer>
  );
}

export function Shell({
  children,
  signedInAs,
  title,
  wide = false,
}: {
  children: ReactNode;
  signedInAs?: string;
  title?: string;
  wide?: boolean;
}) {
  return (
    <>
      <SiteHeader signedInAs={signedInAs} />
      <main className={`mx-auto ${wide ? "max-w-7xl" : "max-w-5xl"} px-6 py-10`}>
        {title ? <h1 className="mb-8 text-3xl font-extrabold">{title}</h1> : null}
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

export function NotConfigured() {
  return (
    <p role="alert" className="rounded-md border border-src-synthetic/50 bg-src-synthetic/5 p-4">
      Sign-in is not available: the Supabase connection is not configured on this deployment
      (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
    </p>
  );
}
