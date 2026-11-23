import { NextResponse, type NextRequest } from "next/server";
import { CONSENT_VERSION, checkDemoInput } from "@/lib/demo-request";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Public demo-request intake. Stores the request in the database (no IP or device data is kept).
 * Notification to the owner is NOT sent: no email provider is verified, so the request waits in the
 * platform inbox. The response says exactly that.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send the form as JSON." }, 400);
  }
  const c = checkDemoInput(body);
  if (!c.ok) {
    // A filled honeypot gets the same answer as success so a bot learns nothing.
    if (c.bot) return json({ ok: true, received: true });
    return json({ error: c.error }, 400);
  }
  const sb = await createClient();
  const v = c.value;
  const { error } = await sb.rpc("submit_demo_request", {
    p_name: v.name,
    p_email: v.email,
    p_organisation: v.organisation,
    p_role_title: v.role_title,
    p_country: v.country,
    p_interest: v.interest,
    p_message: v.message,
    p_consent: v.consent,
    p_consent_version: CONSENT_VERSION,
  });
  if (error) {
    if (error.code === "54000")
      return json(
        { error: "Too many requests right now. Try again in an hour." },
        429,
      );
    return json(
      { error: "Your request could not be saved. Try again shortly." },
      500,
    );
  }
  return json({ ok: true, received: true });
}
