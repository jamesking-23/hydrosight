import { AcceptInvite } from "@/components/accept-invite";
import { Shell } from "@/components/shell";

export default function Invite() {
  return (
    <Shell title="Accept an invitation">
      <p className="mb-4 max-w-prose text-muted">
        You must be signed in with the same email address the invitation was sent to.
      </p>
      <AcceptInvite />
    </Shell>
  );
}
