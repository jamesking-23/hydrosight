"use client";
import dynamic from "next/dynamic";

// MapLibre needs the browser, so it is loaded client-side only.
export const StationMapLoader = dynamic(
  () => import("@/components/station-map").then((m) => m.StationMap),
  { ssr: false, loading: () => <p role="status" className="text-muted">Loading map…</p> },
);
