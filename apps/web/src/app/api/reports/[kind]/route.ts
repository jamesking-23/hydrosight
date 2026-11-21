import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadAnalyticsReport, loadAssetsReport } from "@/lib/report-data";
import { FORMATS, render, sha256Hex, type Format } from "@/lib/report-format";

export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "") as Format;
  if (kind !== "analytics" && kind !== "assets")
    return fail(404, "Unknown report.");
  if (!(format in FORMATS))
    return fail(400, "format must be csv, xlsx or pdf.");

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return fail(401, "Sign in to download reports.");

  const loaded =
    kind === "analytics"
      ? await loadAnalyticsReport(sb, user.email ?? user.id, {
          station: sp.get("station"),
          from: sp.get("from"),
          to: sp.get("to"),
          warn: sp.get("warn"),
        })
      : await loadAssetsReport(sb, user.email ?? user.id, sp.get("org"));
  if (!loaded.ok) return fail(loaded.status, loaded.error);

  const bytes = await render(loaded.report, format);
  const sha = await sha256Hex(bytes);
  // Fail closed: an export that cannot be logged is not delivered.
  const logged = await sb.rpc("log_report_export", {
    p_org: loaded.orgId,
    p_kind: kind,
    p_format: format,
    p_from: kind === "analytics" && "from" in loaded ? loaded.from : null,
    p_to: kind === "analytics" && "to" in loaded ? loaded.to : null,
    p_sha256: sha,
    p_summary: {
      title: loaded.report.title,
      tables: loaded.report.tables.map((t) => ({
        title: t.title,
        rows: t.rows.length,
      })),
    },
  });
  if (logged.error)
    return fail(
      403,
      "This export could not be recorded, so it was not delivered.",
    );

  const stamp = loaded.report.generatedAt.slice(0, 10);
  const safe =
    loaded.report.scope
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "report";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": FORMATS[format].mime,
      "Content-Disposition": `attachment; filename="hydrosight-${kind}-${safe}-${stamp}.${FORMATS[format].ext}"`,
      "Cache-Control": "no-store",
      "X-Content-SHA256": sha,
    },
  });
}
