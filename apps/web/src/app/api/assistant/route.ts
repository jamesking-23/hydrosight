import { NextResponse, type NextRequest } from "next/server";
import { runAssistant } from "@/lib/assistant/engine";
import { providerFromEnv } from "@/lib/assistant/provider";
import { supabaseData } from "@/lib/assistant/supabase-data";
import type { TurnResult } from "@/lib/assistant/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const REASONS: Record<string, string> = {
  advice_not_permitted:
    "The draft answer contained a warning, evacuation advice or a safety statement. This assistant does not give those; alerts are issued only by approved people.",
  no_structured_answer: "The assistant could not produce a checked answer.",
  step_limit_reached: "The assistant could not finish within its step limit.",
  turn_token_budget_reached:
    "This question used up its token budget before an answer was ready.",
};
function explain(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith("answer_not_grounded"))
    return "The draft answer cited records that no tool returned, so it was not shown.";
  if (reason.startsWith("provider_error"))
    return "The language model could not be reached.";
  return REASONS[reason] ?? "The question could not be answered.";
}

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return json({ error: "Sign in to use the assistant." }, 401);

  let body: { org?: unknown; question?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON with org and question." }, 400);
  }
  const org =
    typeof body.org === "string" && UUID.test(body.org) ? body.org : null;
  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  if (!org) return json({ error: "Choose an organisation." }, 400);
  if (question.length < 3 || question.length > 2000)
    return json({ error: "Ask a question of 3 to 2000 characters." }, 400);

  const begin = await sb.rpc("assistant_begin", { p_org: org });
  if (begin.error)
    return json(
      {
        error: "You do not have access to the assistant in this organisation.",
      },
      403,
    );
  const b = begin.data as {
    allowed: boolean;
    reason?: string;
    max_tokens_per_turn?: number;
  };

  const log = async (
    status: string,
    reason: string | null,
    r?: TurnResult,
    provider?: string,
    model?: string,
  ) =>
    sb.rpc("log_assistant_turn", {
      p_org: org,
      p_question: question,
      p_status: status,
      p_refusal_reason: reason,
      p_answer: r?.answer ?? null,
      p_tool_calls: r?.tool_calls ?? [],
      p_tokens_in: r?.tokens_in ?? 0,
      p_tokens_out: r?.tokens_out ?? 0,
      p_provider: provider ?? null,
      p_model: model ?? null,
      p_flags: r?.flags ?? {},
    });

  if (!b.allowed) {
    const capped = b.reason === "daily_cap_reached";
    await log(capped ? "capped" : "not_configured", b.reason ?? "not_enabled");
    return json(
      {
        status: capped ? "capped" : "not_enabled",
        message: capped
          ? "This organisation has reached its daily assistant limit. It resets at 00:00 UTC."
          : "The assistant is switched off for this organisation. An organisation admin can switch it on and set a daily limit.",
      },
      capped ? 429 : 409,
    );
  }

  const provider = providerFromEnv(process.env);
  if (!provider) {
    await log("not_configured", "model_not_configured");
    return json(
      {
        status: "not_configured",
        message:
          "The language model is not configured on this deployment (ASSISTANT_PROVIDER, ASSISTANT_MODEL and the matching API key).",
      },
      503,
    );
  }

  const result = await runAssistant({
    provider,
    data: supabaseData(sb),
    orgId: org,
    question,
    now: Date.now(),
    maxTokens: b.max_tokens_per_turn ?? 4000,
  });
  const logged = await log(
    result.status,
    result.refusal_reason,
    result,
    provider.name,
    provider.model,
  );
  // Fail closed: an answer that cannot be recorded is not delivered.
  if (logged.error)
    return json(
      { error: "The answer could not be recorded, so it was not delivered." },
      500,
    );
  return json({
    status: result.status,
    answer: result.answer,
    message: explain(result.refusal_reason),
    turn_id: logged.data,
  });
}
