"use client";

import { useState } from "react";
import type { AssistantAnswer, CitedItem } from "@/lib/assistant/types";
import { Button, ErrorNote, inputCls } from "./ui";

type Reply = {
  status: string;
  answer?: AssistantAnswer | null;
  message?: string | null;
  error?: string;
};

function Cited({
  title,
  items,
  empty,
}: {
  title: string;
  items: CitedItem[];
  empty: string;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-1 font-bold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="text-sm">
              {it.text}
              <div className="mt-0.5 text-xs text-muted">
                {it.cites.map((c) => (
                  <span key={c.ref} className="mr-3">
                    {c.ref}
                    {c.as_of ? `, as of ${c.as_of}` : ", no observation time"}
                    {c.stale ? " (stale or offline)" : ""}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Plain({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-1 font-bold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="list-disc pl-5 text-sm">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AssistantPanel({ orgId }: { orgId: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply>();

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setReply(undefined);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: orgId, question: q }),
      });
      setReply((await res.json()) as Reply);
    } catch {
      setReply({
        status: "error",
        error: "The request failed. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  const a = reply?.answer;
  return (
    <div className="max-w-3xl">
      <form onSubmit={ask} className="mb-6">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">
            Ask about your stations, sensors, forecasts, alerts or assets
          </span>
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            rows={3}
            maxLength={2000}
            className={inputCls}
            placeholder="Which sensors are stale right now?"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button className="shrink-0 whitespace-nowrap" disabled={busy || q.trim().length < 3}>
            {busy ? "Checking records…" : "Ask"}
          </Button>
          <span className="min-w-[14rem] flex-1 text-xs text-muted">
            Read-only. It does not issue warnings or advise on evacuation.
            Questions are logged.
          </span>
        </div>
      </form>
      <ErrorNote>{reply?.error}</ErrorNote>
      {reply && !a ? (
        <p className="rounded-md border border-line bg-white p-3 text-sm">
          {reply.message ?? "No answer."}
        </p>
      ) : null}
      {a ? (
        <article
          aria-label="Answer"
          className="rounded-md border border-line bg-white p-4"
        >
          <Cited
            title="Observed"
            items={a.observed}
            empty="Nothing observed was cited."
          />
          <Cited
            title="Forecast"
            items={a.forecast}
            empty="No forecast was cited."
          />
          <Plain
            title="Assumptions"
            items={a.assumptions}
            empty="None stated."
          />
          <Plain title="Not known" items={a.not_known} empty="None stated." />
          <p className="border-t border-line pt-3 text-xs text-muted">
            {a.data_notes.join(" ")} Generated {a.generated_at}.
          </p>
        </article>
      ) : null}
    </div>
  );
}
