import { AuthForm } from "@/components/auth-form";
import { NotConfigured, Shell } from "@/components/shell";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <Shell title="Sign in">
      {isSupabaseConfigured ? <AuthForm mode="login" next={next ?? null} /> : <NotConfigured />}
    </Shell>
  );
}
