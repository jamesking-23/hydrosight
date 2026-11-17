// Liveness: the web process is up. Does not check dependencies (see /ready).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "web" });
}
