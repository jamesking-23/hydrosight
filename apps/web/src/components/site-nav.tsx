"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type NavLink = { href: string; label: string };
export type NavGroup = { title: string; links: readonly NavLink[] };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Shared open/close behaviour for the small-screen menu: Escape closes and returns focus. */
function useMenu() {
  const pathname = usePathname();
  // The menu is open only for the page it was opened on, so navigating closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    setOpenAt(value ? pathname : null);
  };
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenAt(null);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind the open menu from scrolling.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return { pathname, open, setOpen, button };
}

function MenuButton({
  open,
  onToggle,
  panelId,
  buttonRef,
}: {
  open: boolean;
  onToggle: () => void;
  panelId: string;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold hover:border-ocean hover:text-ocean lg:hidden"
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        {open ? (
          <path d="M4 4l10 10M14 4L4 14" />
        ) : (
          <path d="M2 4.5h14M2 9h14M2 13.5h14" />
        )}
      </svg>
      {open ? "Close" : "Menu"}
    </button>
  );
}

const linkBase =
  "rounded-md px-3 py-2 text-[0.95rem] font-semibold whitespace-nowrap transition-colors";

/** Navigation for people who are signed in: grouped tab bar on wide screens, grouped menu on small ones. */
export function AppNav({
  groups,
  signedInAs,
  signOut,
}: {
  groups: readonly NavGroup[];
  signedInAs: string;
  signOut: ReactNode;
}) {
  const { pathname, open, setOpen, button } = useMenu();
  const panelId = useId();

  return (
    <>
      <div className="flex items-center gap-3">
        <span
          className="hidden max-w-[16rem] truncate text-sm text-muted sm:inline"
          title={signedInAs}
        >
          {signedInAs}
        </span>
        <span className="hidden lg:inline [&_button]:whitespace-nowrap">
          {signOut}
        </span>
        <MenuButton
          open={open}
          onToggle={() => setOpen((v) => !v)}
          panelId={panelId}
          buttonRef={button}
        />
      </div>

      {/* Wide screens: one row of tabs under the logo bar, groups divided by a thin rule. */}
      <nav
        aria-label="Main"
        className="col-span-2 hidden border-t border-line lg:block"
      >
        <ul className="-mx-3 flex flex-wrap items-center gap-y-1 py-1.5">
          {groups.map((g, gi) => (
            <li key={g.title} className="flex items-center">
              {gi > 0 ? (
                <span aria-hidden="true" className="mx-2 h-5 w-px bg-line" />
              ) : null}
              <ul aria-label={g.title} className="flex items-center gap-0.5">
                {g.links.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={active ? "page" : undefined}
                        className={`${linkBase} ${
                          active
                            ? "bg-mist text-ocean-deep shadow-[inset_0_-2px_0_var(--color-ocean)]"
                            : "text-ink hover:bg-mist hover:text-ocean"
                        }`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {/* Small screens: full-width panel below the bar. */}
      {open ? (
        <div
          id={panelId}
          className="col-span-2 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain border-t border-line pb-6 lg:hidden"
        >
          <nav aria-label="Main">
            {groups.map((g) => (
              <section key={g.title} className="pt-4">
                <h2 className="px-1 pb-1 text-sm font-bold text-muted">
                  {g.title}
                </h2>
                <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {g.links.map((l) => {
                    const active = isActive(pathname, l.href);
                    return (
                      <li key={l.href}>
                        <Link
                          href={l.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-11 items-center rounded-md border px-3 text-[0.95rem] font-semibold ${
                            active
                              ? "border-ocean bg-mist text-ocean-deep"
                              : "border-line hover:border-ocean hover:text-ocean"
                          }`}
                        >
                          {l.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4 [&_button]:whitespace-nowrap">
            <span className="min-w-0 truncate text-sm text-muted">
              {signedInAs}
            </span>
            {signOut}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Navigation for visitors: inline links on wide screens, menu with the same links on small ones. */
export function PublicNav({ links }: { links: readonly NavLink[] }) {
  const { pathname, open, setOpen, button } = useMenu();
  const panelId = useId();

  return (
    <>
      <div className="flex items-center gap-2">
        <nav aria-label="Main" className="hidden items-center lg:flex">
          <ul className="flex items-center gap-0.5">
            {links.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={`${linkBase} ${
                      active
                        ? "text-ocean-deep shadow-[inset_0_-2px_0_var(--color-ocean)]"
                        : "text-ink hover:bg-mist hover:text-ocean"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <Link
          href="/login"
          className="hidden min-h-11 items-center rounded-md px-3 text-[0.95rem] font-semibold hover:bg-mist hover:text-ocean sm:inline-flex"
        >
          Sign in
        </Link>
        <Link
          href="/demo"
          className="inline-flex min-h-11 items-center rounded-md bg-ocean px-4 text-[0.95rem] font-semibold text-white hover:bg-ocean-deep"
        >
          Request a demo
        </Link>
        <MenuButton
          open={open}
          onToggle={() => setOpen((v) => !v)}
          panelId={panelId}
          buttonRef={button}
        />
      </div>

      {open ? (
        <div
          id={panelId}
          className="col-span-2 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain border-t border-line pb-6 lg:hidden"
        >
          <nav aria-label="Main" className="pt-3">
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {[...links, { href: "/login", label: "Sign in" }].map((l) => {
                const active = isActive(pathname, l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center rounded-md border px-3 text-[0.95rem] font-semibold ${
                        active
                          ? "border-ocean bg-mist text-ocean-deep"
                          : "border-line hover:border-ocean hover:text-ocean"
                      }`}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}
