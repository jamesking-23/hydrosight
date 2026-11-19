"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { sanitizeNext } from "@/lib/access";
import { createClient } from "@/lib/supabase/browser";

type Enrol = { factorId: string; qr: string; secret: string };

export function MfaPanel({ next }: { next: string | null }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState("");
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase.auth.mfa.listFactors();
      if (err) {
        setError(err.message);
      } else {
        const verified = data.totp.find((f) => f.status === "verified");
        if (verified) setFactorId(verified.id);
        else {
          // Drop abandoned, unverified enrolments so a fresh QR code can be created.
          for (const f of data.all.filter((f) => f.status === "unverified")) {
            await supabase.auth.mfa.unenroll({ factorId: f.id });
          }
          const res = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "HydroSight" });
          if (res.error) setError(res.error.message);
          else {
            setFactorId(res.data.id);
            setEnrol({ factorId: res.data.id, qr: res.data.totp.qr_code, secret: res.data.totp.secret });
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (err) {
      setError(err.message);
      return;
    }
    router.push(sanitizeNext(next));
    router.refresh();
  }

  if (loading) return <p role="status">Loading two-factor options…</p>;
  return (
    <form onSubmit={verify} className="max-w-sm space-y-4">
      {enrol ? (
        <div className="space-y-2">
          <p>
            Scan this QR code with an authenticator app (Google Authenticator, Authy, Microsoft
            Authenticator), then enter the 6-digit code.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt="Two-factor QR code" width={192} height={192} className="bg-white p-2" />
          <p className="text-xs text-[var(--text-muted)]">
            Cannot scan? Enter this key manually: <code className="break-all">{enrol.secret}</code>
          </p>
        </div>
      ) : (
        <p>Enter the 6-digit code from your authenticator app.</p>
      )}
      <Field label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
        required value={code} onChange={(e) => setCode(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={!factorId}>Verify</Button>
    </form>
  );
}
