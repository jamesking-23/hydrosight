import type { AssistantAnswer, CitedItem, ToolRecord } from "./types";

const MAX_ITEMS = 12;
const MAX_TEXT = 500;

/** The assistant never gives warnings, evacuation advice or "it is safe" statements. Conservative on purpose. */
const ADVICE: RegExp[] = [
  /\bevacuat/i,
  /\b(issue|send|publish|declare|trigger|approve)\b.{0,40}\b(warning|alert|evacuation)/i,
  /\byou (should|must|need to|ought to) (leave|move|go|relocate|evacuate|flee|stay)/i,
  /\b(take shelter|higher ground|move to safety|get out)\b/i,
  /\b(is|are|remains?) (completely |totally |now )?safe\b/i,
  /\bno (flood )?(risk|danger|threat)\b/i,
  /\bsafe to (stay|remain|travel|cross|return)\b/i,
];

export function violatesAdviceRule(text: string): boolean {
  return ADVICE.some((r) => r.test(text));
}

type Raw = Record<string, unknown>;
export type Validation =
  | { ok: true; answer: AssistantAnswer }
  | { ok: false; reason: string; advice?: boolean };

const isObj = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function cited(
  list: unknown,
  label: string,
  allowedKinds: string[],
  seen: Map<string, ToolRecord>,
): { items: CitedItem[] } | { reason: string } {
  if (!Array.isArray(list)) return { reason: `${label} must be a list.` };
  if (list.length > MAX_ITEMS)
    return { reason: `${label} has more than ${MAX_ITEMS} items.` };
  const items: CitedItem[] = [];
  for (const it of list) {
    if (!isObj(it) || typeof it.text !== "string" || !Array.isArray(it.cites))
      return { reason: `Each ${label} item needs text and cites.` };
    if (it.text.trim() === "" || it.text.length > MAX_TEXT)
      return { reason: `${label} text must be 1 to ${MAX_TEXT} characters.` };
    if (it.cites.length === 0)
      return {
        reason: `Every ${label} item must cite at least one record returned by a tool.`,
      };
    const cites: CitedItem["cites"] = [];
    for (const c of it.cites) {
      const r = typeof c === "string" ? seen.get(c) : undefined;
      if (!r)
        return {
          reason: `Citation ${String(c)} was not returned by any tool in this turn.`,
        };
      if (!allowedKinds.includes(r.kind))
        return {
          reason: `${label} may not cite a ${r.kind} record (${r.ref}).`,
        };
      cites.push({ ref: r.ref, as_of: r.as_of, stale: r.stale });
    }
    items.push({ text: it.text.trim(), cites });
  }
  return { items };
}

function plain(
  list: unknown,
  label: string,
): { items: string[] } | { reason: string } {
  if (!Array.isArray(list)) return { reason: `${label} must be a list.` };
  if (list.length > MAX_ITEMS)
    return { reason: `${label} has more than ${MAX_ITEMS} items.` };
  const items: string[] = [];
  for (const it of list) {
    if (typeof it !== "string" || it.trim() === "" || it.length > MAX_TEXT)
      return {
        reason: `${label} items must be text of 1 to ${MAX_TEXT} characters.`,
      };
    items.push(it.trim());
  }
  return { items };
}

/**
 * Checks the model's structured answer against the records the tools actually returned.
 * Citations are resolved here, so timestamps shown to the reader come from the records, not the model.
 */
export function validateAnswer(
  raw: unknown,
  seen: Map<string, ToolRecord>,
  nowIso: string,
): Validation {
  if (!isObj(raw))
    return {
      ok: false,
      reason:
        "The answer must be an object with observed, forecast, assumptions and not_known.",
    };
  const observed = cited(
    raw.observed,
    "observed",
    ["station", "sensor", "reading", "device", "alert", "asset", "report"],
    seen,
  );
  if ("reason" in observed) return { ok: false, reason: observed.reason };
  const forecast = cited(raw.forecast, "forecast", ["prediction"], seen);
  if ("reason" in forecast) return { ok: false, reason: forecast.reason };
  const assumptions = plain(raw.assumptions, "assumptions");
  if ("reason" in assumptions) return { ok: false, reason: assumptions.reason };
  const notKnown = plain(raw.not_known, "not_known");
  if ("reason" in notKnown) return { ok: false, reason: notKnown.reason };

  const all = [
    ...observed.items.map((i) => i.text),
    ...forecast.items.map((i) => i.text),
    ...assumptions.items,
    ...notKnown.items,
  ];
  if (all.some(violatesAdviceRule)) {
    return {
      ok: false,
      reason:
        "The answer contained a warning, evacuation advice or a safety statement, which this assistant does not give.",
      advice: true,
    };
  }
  if (
    observed.items.length === 0 &&
    forecast.items.length === 0 &&
    notKnown.items.length === 0
  ) {
    return {
      ok: false,
      reason:
        "Say what is not known when there is nothing observed or forecast.",
    };
  }

  const notes: string[] = [];
  const cites = [...observed.items, ...forecast.items].flatMap((i) => i.cites);
  const staleRefs = [
    ...new Set(cites.filter((c) => c.stale === true).map((c) => c.ref)),
  ];
  if (staleRefs.length)
    notes.push(
      `Stale or offline source data is cited: ${staleRefs.join(", ")}.`,
    );
  if (cites.some((c) => c.as_of === null))
    notes.push("Some cited records carry no observation time.");
  if (forecast.items.length)
    notes.push("Forecasts are unvalidated model outputs, not warnings.");
  notes.push(
    "Record contents are as stored at the time shown; nothing here has been validated by a person.",
  );
  return {
    ok: true,
    answer: {
      observed: observed.items,
      forecast: forecast.items,
      assumptions: assumptions.items,
      not_known: notKnown.items,
      data_notes: notes,
      generated_at: nowIso,
    },
  };
}

export const SUBMIT_ANSWER_TOOL = {
  name: "submit_answer",
  description:
    "Submit the final answer. Every observed item cites reading/sensor/device/alert/asset/station/report refs; every forecast item cites prediction refs. Refs must be copied exactly from tool results.",
  input_schema: {
    type: "object",
    properties: {
      observed: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            cites: { type: "array", items: { type: "string" } },
          },
          required: ["text", "cites"],
        },
      },
      forecast: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            cites: { type: "array", items: { type: "string" } },
          },
          required: ["text", "cites"],
        },
      },
      assumptions: { type: "array", items: { type: "string" } },
      not_known: { type: "array", items: { type: "string" } },
    },
    required: ["observed", "forecast", "assumptions", "not_known"],
    additionalProperties: false,
  },
};
