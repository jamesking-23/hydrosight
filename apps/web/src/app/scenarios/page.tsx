import { ScenarioApp } from "@/components/scenario-app";
import { Shell } from "@/components/shell";
import { loadAccess } from "@/lib/load-access";

export const dynamic = "force-dynamic";

export default async function Scenarios() {
  const a = await loadAccess("/scenarios");
  return (
    <Shell title="Flood scenarios" signedInAs={a.user.email ?? undefined} wide>
      <ScenarioApp />
    </Shell>
  );
}
