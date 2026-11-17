// Readiness: the web app can reach the API. Reports failure explicitly (rule 6: no silent failure).
export const dynamic = "force-dynamic";

export async function GET() {
  const apiUrl = process.env.API_INTERNAL_URL;
  if (!apiUrl) {
    return Response.json({ status: "not_ready", reason: "API_INTERNAL_URL is not set" }, { status: 503 });
  }
  try {
    const res = await fetch(`${apiUrl}/ready`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return Response.json({ status: "not_ready", reason: `api returned ${res.status}` }, { status: 503 });
    }
    return Response.json({ status: "ready", service: "web", api: "ready" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return Response.json({ status: "not_ready", reason: `api unreachable: ${reason}` }, { status: 503 });
  }
}
