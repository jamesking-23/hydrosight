"use client";
import { useRouter } from "next/navigation";
import { GhostButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  return (
    <GhostButton
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </GhostButton>
  );
}
