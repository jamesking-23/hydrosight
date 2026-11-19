"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, GhostButton, inputCls } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

/** Shows a secret exactly once; it cannot be retrieved again (only a hash is stored). */
function SecretOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  return (
    <div role="status" className="mt-3 rounded border border-teal/40 bg-teal/5 rounded-md p-3 text-sm">
      <p className="mb-1 font-semibold">{label} (shown once, copy it now):</p>
      <code className="block break-all">{value}</code>
      <GhostButton className="mt-2" onClick={onDone}>I have copied it</GhostButton>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError("");
    const { error: err } = await fn();
    setBusy(false);
    if (err) setError(err.message);
    else router.refresh();
    return !err;
  }
  return { error, busy, run, setError };
}

export function InviteForm({ orgId, roles }: { orgId: string; roles: { key: string; label: string }[] }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0]?.key ?? "");
  const [secret, setSecret] = useState("");
  const { error, busy, setError } = useAction();
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    setError("");
    const { data, error: err } = await createClient().rpc("create_invitation", {
      p_org: orgId, p_email: email, p_role: role,
    });
    setWorking(false);
    if (err) setError(err.message);
    else {
      const link = `${window.location.origin}/invite#token=${data as string}`;
      setSecret(link);
      setEmail("");
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Email to invite" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="block">
        <span className="mb-1 block text-sm">Role</span>
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={working || busy}>Create invitation</Button>
      {secret ? <SecretOnce label="Invitation link" value={secret} onDone={() => setSecret("")} /> : null}
      <p className="text-xs text-muted">
        Email delivery is not set up yet. Share the link with the invitee yourself.
        The invitee must sign in with exactly this email address.
      </p>
    </form>
  );
}

export function RevokeButton({ kind, id }: { kind: "invitation" | "api_key"; id: string }) {
  const { error, busy, run } = useAction();
  const fn = kind === "invitation" ? "revoke_invitation" : "revoke_api_key";
  return (
    <>
      <GhostButton disabled={busy} onClick={() => run(() => createClient().rpc(fn, { p_id: id }))}>
        Revoke
      </GhostButton>
      {error ? <span role="alert" className="ml-2 text-sm">{error}</span> : null}
    </>
  );
}

export function ApiKeyForm({ orgId, scopes }: { orgId: string; scopes: string[] }) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: err } = await createClient().rpc("create_api_key", {
      p_org: orgId, p_name: name, p_scopes: chosen,
    });
    setBusy(false);
    if (err) setError(err.message);
    else {
      setSecret(data as string);
      setName("");
      setChosen([]);
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Key name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <fieldset>
        <legend className="mb-1 text-sm">Scopes (read-only and drafting powers only; never approve/publish/admin)</legend>
        <div className="flex flex-wrap gap-3">
          {scopes.map((s) => (
            <label key={s} className="text-sm">
              <input type="checkbox" className="mr-1" checked={chosen.includes(s)}
                onChange={(e) => setChosen(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || chosen.length === 0}>Create API key</Button>
      {secret ? <SecretOnce label="API key" value={secret} onDone={() => setSecret("")} /> : null}
    </form>
  );
}

export function MemberActions({ id, status }: { id: string; status: string }) {
  const { error, busy, run } = useAction();
  const supabase = createClient();
  return (
    <span className="space-x-2">
      <GhostButton disabled={busy}
        onClick={() => run(() => supabase.from("memberships").update({ status: status === "active" ? "suspended" : "active" }).eq("id", id))}>
        {status === "active" ? "Suspend" : "Reactivate"}
      </GhostButton>
      <GhostButton disabled={busy}
        onClick={() => { if (window.confirm("Remove this member from the organisation?")) run(() => supabase.from("memberships").delete().eq("id", id)); }}>
        Remove
      </GhostButton>
      {error ? <span role="alert" className="text-sm">{error}</span> : null}
    </span>
  );
}
