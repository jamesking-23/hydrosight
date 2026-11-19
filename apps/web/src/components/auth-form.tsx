"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { sanitizeNext } from "@/lib/access";
import { createClient } from "@/lib/supabase/browser";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const target = sanitizeNext(next);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();
    if (mode === "login") {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
      else {
        router.push(target);
        router.refresh();
      }
    } else {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
        },
      });
      if (err) setError(err.message);
      else if (data.session) {
        router.push(target);
        router.refresh();
      } else {
        setInfo("Check your email and follow the confirmation link, then sign in.");
      }
    }
    setBusy(false);
  }

  const other = mode === "login" ? "/signup" : "/login";
  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      <Field label="Email" type="email" autoComplete="email" required value={email}
        onChange={(e) => setEmail(e.target.value)} />
      <Field label="Password" type="password" required minLength={mode === "signup" ? 10 : 1}
        autoComplete={mode === "login" ? "current-password" : "new-password"} value={password}
        onChange={(e) => setPassword(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      {info ? <p role="status" className="rounded border border-teal p-3 text-sm">{info}</p> : null}
      <Button type="submit" disabled={busy}>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-sm text-[var(--text-muted)]">
        {mode === "login" ? "No account? " : "Already registered? "}
        <Link className="underline" href={`${other}?next=${encodeURIComponent(target)}`}>
          {mode === "login" ? "Create one" : "Sign in"}
        </Link>
      </p>
      {mode === "signup" ? (
        <p className="text-xs text-[var(--text-muted)]">
          An account alone gives no access. You need an invitation from an organisation
          administrator.
        </p>
      ) : null}
    </form>
  );
}
