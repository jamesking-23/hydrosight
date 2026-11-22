"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button, ErrorNote, Field } from "./ui";

export function AssistantLimit({
  orgId,
  enabled,
  cap,
  perTurn,
}: {
  orgId: string;
  enabled: boolean;
  cap: number | null;
  perTurn: number | null;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [daily, setDaily] = useState(cap ? String(cap) : "");
  const [turn, setTurn] = useState(String(perTurn ?? 4000));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    const d = Number(daily);
    const t = Number(turn);
    if (!Number.isInteger(d) || d < 1000 || d > 5_000_000)
      return setError(
        "Daily limit must be a whole number from 1,000 to 5,000,000 tokens.",
      );
    if (!Number.isInteger(t) || t < 500 || t > 16_000)
      return setError(
        "Per-question limit must be a whole number from 500 to 16,000 tokens.",
      );
    const { error: err } = await createClient().rpc("set_assistant_limit", {
      p_org: orgId,
      p_enabled: on,
      p_daily_token_cap: d,
      p_max_tokens_per_turn: t,
    });
    if (err) return setError(err.message);
    setSaved(true);
    router.refresh();
  }
  return (
    <form
      onSubmit={save}
      className="mb-8 grid max-w-xl gap-3 rounded-md border border-line bg-white p-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <ErrorNote>{error}</ErrorNote>
      </div>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
        <span className="text-sm font-semibold">
          Assistant is on for this organisation
        </span>
      </label>
      <Field
        label="Daily limit (tokens, all users)"
        inputMode="numeric"
        value={daily}
        onChange={(e) => setDaily(e.target.value)}
      />
      <Field
        label="Limit per question (tokens)"
        inputMode="numeric"
        value={turn}
        onChange={(e) => setTurn(e.target.value)}
      />
      <div className="sm:col-span-2">
        <Button>Save limits</Button>
        {saved ? <span className="ml-3 text-sm">Saved.</span> : null}
        <p className="mt-2 text-xs text-muted">
          There is no default limit: the assistant stays off until you set one.
          Limits are in tokens because HydroSight does not assume any model
          price. The daily limit resets at 00:00 UTC and can be exceeded by at
          most one question.
        </p>
      </div>
    </form>
  );
}
