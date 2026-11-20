"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type LinkState = "connecting" | "connected" | "not_connected";

/** Current time that ticks, so ages and freshness keep moving on a page left open. */
export function useNow(everyMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * Subscribes to Supabase Realtime (row-level security applies per viewer) and re-fetches the page
 * when readings, device health or alerts change. The connection state is always shown; if live
 * updates are not connected the page still refreshes every minute and says so.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [state, setState] = useState<LinkState>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = createClient();
    const bump = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, 2000);
    };
    const channel = sb.channel("hydrosight-live");
    for (const table of ["readings", "device_health", "alerts"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    }
    channel.subscribe((s) => {
      setState(s === "SUBSCRIBED" ? "connected" : s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "not_connected" : "connecting");
    });
    const poll = setInterval(() => router.refresh(), 60000);
    return () => {
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      void sb.removeChannel(channel);
    };
  }, [router]);

  const text =
    state === "connected"
      ? "Live updates connected. The page refreshes as new data arrives."
      : state === "connecting"
        ? "Connecting to live updates. The page refreshes every minute meanwhile."
        : "Live updates are not connected. The page refreshes every minute.";
  return (
    <p role="status" className="mb-4 text-sm text-muted" data-live-state={state}>
      {text}
    </p>
  );
}
