import Link from "next/link";
import type { ReactNode } from "react";
import { MaturityBanner } from "@/components/maturity-banner";
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
        HydroSight is a prototype. It is not validated and must not be used for operational or
        safety decisions.
      </p>
    </footer>
  );
}

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
      <SiteHeader signedInAs={signedInAs} />
      <main className="mx-auto max-w-5xl px-6 py-10">
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
