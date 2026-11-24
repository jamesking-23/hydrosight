import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { AppNav, PublicNav, type NavGroup } from "@/components/site-nav";
import { NAV } from "@/lib/site-content";

export function Logo({ className = "h-12" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/hydrosight-logo.png"
      alt="HydroSight"
      className={`${className} w-auto`}
    />
  );
}

const APP_NAV: readonly NavGroup[] = [
  {
    title: "Overview",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/map", label: "Map" },
      { href: "/monitor", label: "Monitor" },
    ],
  },
  {
    title: "Intelligence",
    links: [
      { href: "/forecasts", label: "Forecasts" },
      { href: "/analytics", label: "Analytics" },
      { href: "/assistant", label: "Assistant" },
    ],
  },
  {
    title: "Warnings",
    links: [
      { href: "/alerts", label: "Alerts" },
      { href: "/rules", label: "Rules" },
      { href: "/moderation", label: "Moderation" },
    ],
  },
  {
    title: "Organisation",
    links: [
      { href: "/devices", label: "Devices" },
      { href: "/assets", label: "Assets" },
      { href: "/billing", label: "Billing" },
    ],
  },
];

export function SiteHeader({ signedInAs }: { signedInAs?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div
        className={`mx-auto grid ${signedInAs ? "max-w-7xl" : "max-w-5xl"} grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-2 sm:px-6`}
      >
        <Link
          href="/"
          aria-label="HydroSight home"
          className="inline-flex w-fit"
        >
          <Logo className="h-9 sm:h-11" />
        </Link>
        {signedInAs ? (
          <AppNav
            groups={APP_NAV}
            signedInAs={signedInAs}
            signOut={<SignOutButton />}
          />
        ) : (
          <PublicNav links={NAV} />
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <p className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted sm:px-6">
        HydroSight is decision-support software. Forecasts and risk estimates
        are advisory until validated for your area, and public warnings are
        issued only after human approval.
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
      <main
        className={`mx-auto ${wide ? "max-w-7xl" : "max-w-5xl"} px-4 py-6 sm:px-6 sm:py-10`}
      >
        {title ? (
          <h1 className="mb-6 text-2xl font-extrabold sm:mb-8 sm:text-3xl">
            {title}
          </h1>
        ) : null}
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

export function NotConfigured() {
  return (
    <p
      role="alert"
      className="rounded-md border border-src-synthetic/50 bg-src-synthetic/5 p-4"
    >
      Sign-in is not available: the Supabase connection is not configured on
      this deployment (NEXT_PUBLIC_SUPABASE_URL /
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
    </p>
  );
}
