"use client";
import dynamic from "next/dynamic";

// The community app reads this phone's storage and connection, so it renders in the browser only.
export const CommunityLoader = dynamic(
  () => import("@/components/community-app").then((m) => m.CommunityApp),
  { ssr: false, loading: () => <p role="status" className="px-4 py-6 text-muted">Loading…</p> },
);
