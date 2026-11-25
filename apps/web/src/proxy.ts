import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  SUPABASE_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

const PROTECTED = [
  "/dashboard",
  "/org",
  "/mfa",
  "/invite",
  "/map",
  "/alerts",
  "/rules",
  "/monitor",
  "/devices",
  "/moderation",
  "/forecasts",
  "/analytics",
  "/assets",
  "/assistant",
  "/scenarios",
  "/billing",
  "/platform",
];

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
// This is a convenience only: every real permission check happens in the database (RLS).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list)
          response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (
    !data?.claims &&
    PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand|health|ready|favicon.ico).*)"],
};
