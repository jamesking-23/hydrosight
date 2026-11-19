import { MfaPanel } from "@/components/mfa-panel";
import { Shell } from "@/components/shell";

export default async function Mfa({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <Shell title="Two-factor verification">
      <p className="mb-4 max-w-prose text-muted">
        Your role can approve, publish or administer. HydroSight requires a verified second factor
        for these roles; without it the system grants you no access.
      </p>
      <MfaPanel next={next ?? null} />
    </Shell>
  );
}
