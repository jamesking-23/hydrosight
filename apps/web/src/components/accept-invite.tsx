"use client";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { tokenFromHash } from "@/lib/access";
import { createClient } from "@/lib/supabase/browser";

export function AcceptInvite() {
  const router = useRouter();
  // The token travels in the URL fragment, which browsers never send to servers.
  const fromUrl = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => tokenFromHash(window.location.hash),
    () => "",
  );
  const [typed, setTyped] = useState<string | null>(null);
  const token = typed ?? fromUrl;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await createClient().rpc("accept_invitation", { p_token: token.trim() });
    setBusy(false);
    if (err) {
      setError(
        "This invitation is not valid for your account. It may be expired, already used, revoked, or sent to a different email address.",
      );
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={accept} className="max-w-md space-y-4">
      <Field label="Invitation code" value={token} onChange={(e) => setTyped(e.target.value)}
        required placeholder="hsi_…" />
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || token === ""}>Accept invitation</Button>
    </form>
  );
}
