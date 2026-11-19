import { AuthForm } from "@/components/auth-form";
import { NotConfigured, Shell } from "@/components/shell";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function Signup({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <Shell title="Create account">
      {isSupabaseConfigured ? <AuthForm mode="signup" next={next ?? null} /> : <NotConfigured />}
    </Shell>
  );
}
