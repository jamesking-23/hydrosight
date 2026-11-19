// Public by design (they ship to the browser). The publishable key grants only what RLS allows.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const isSupabaseConfigured = SUPABASE_URL !== "" && SUPABASE_KEY !== "";
