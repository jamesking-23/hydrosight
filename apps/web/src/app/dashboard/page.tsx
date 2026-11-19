import Link from "next/link";
import { Card, ErrorNote } from "@/components/ui";
import { Shell } from "@/components/shell";
import { loadAccess } from "@/lib/load-access";

export default async function Dashboard() {
  const a = await loadAccess("/dashboard");
  const { data: orgs, error: orgError } = await a.supabase.from("organizations").select("id, name");
  const label = new Map(a.roleDefs.map((r) => [r.key, r.label]));
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const active = a.memberships.filter((m) => m.status === "active");

  return (
    <Shell title="Your organisations" signedInAs={a.user.email ?? undefined}>
      <ErrorNote>{a.loadError?.message ?? orgError?.message}</ErrorNote>
      {active.length === 0 && !a.loadError ? (
        <Card title="No organisation yet">
          <p className="mb-3">
            An account on its own gives no access. Ask an organisation administrator for an
            invitation, then{" "}
            <Link className="underline" href="/invite">
              accept it here
            </Link>
            .
          </p>
        </Card>
      ) : null}
      <ul className="space-y-3">
        {active.map((m) => (
          <li key={m.id} className="rounded border border-ocean p-4">
            <p className="font-semibold">{orgName.get(m.org_id) ?? "Organisation"}</p>
            <p className="text-sm text-[var(--text-muted)]">
              Role: {label.get(m.role_key) ?? m.role_key}
            </p>
            <Link className="mt-2 inline-block underline" href={`/org/${m.org_id}`}>
              Open
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        <Link className="underline" href="/invite">
          Have an invitation code?
        </Link>
      </p>
    </Shell>
  );
}
