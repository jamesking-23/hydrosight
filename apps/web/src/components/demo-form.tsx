"use client";

import { useState } from "react";
import { Button, ErrorNote, Field, inputCls } from "@/components/ui";
import { CONSENT_TEXT } from "@/lib/demo-request";

export function DemoForm() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      email: f.get("email"),
      organisation: f.get("organisation"),
      role_title: f.get("role_title"),
      country: f.get("country"),
      interest: f.get("interest"),
      message: f.get("message"),
      consent: f.get("consent") === "on",
      website: f.get("website"),
    };
    try {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) setErr(j.error ?? "Your request could not be sent.");
      else setDone(true);
    } catch {
      setErr(
        "Could not reach HydroSight. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div
        role="status"
        className="rounded-md border border-leaf/50 bg-leaf/5 p-5"
      >
        <p className="font-semibold">Request received.</p>
        <p className="mt-1 text-muted">
          It is saved and waiting for the HydroSight team to read. No
          confirmation email is sent, because email delivery is not set up yet,
          so there is nothing to look for in your inbox.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Your name"
          name="name"
          required
          autoComplete="name"
          maxLength={120}
        />
        <Field
          label="Work email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={254}
        />
        <Field
          label="Organisation"
          name="organisation"
          required
          autoComplete="organization"
          maxLength={160}
        />
        <Field label="Your role" name="role_title" maxLength={120} />
        <Field
          label="Country"
          name="country"
          autoComplete="country-name"
          maxLength={80}
        />
        <Field label="What you want to see" name="interest" maxLength={200} />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">
          Anything we should know
        </span>
        <textarea
          name="message"
          rows={4}
          maxLength={2000}
          className={inputCls}
        />
      </label>
      {/* Honeypot: hidden from people and assistive tech. */}
      <div
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
      >
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>{CONSENT_TEXT}</span>
      </label>
      <ErrorNote>{err}</ErrorNote>
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}
