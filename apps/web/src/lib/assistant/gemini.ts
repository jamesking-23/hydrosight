import type { Block, Message, Provider, ProviderReply, ToolDef } from "./types";

/**
 * Gemini generateContent over fetch (key in the x-goog-api-key header, never in the URL).
 * Built from Google's public function-calling documentation; the live call has to be confirmed
 * with the owner's key. Model parts are kept verbatim ("raw") and sent back unchanged because
 * Gemini 3 requires thought signatures to be returned with function calls.
 */
type Part = Record<string, unknown>;

/** Gemini accepts a subset of OpenAPI schema. Drop keywords it may reject; the server validates arguments anyway. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "additionalProperties" || k === "minimum" || k === "maximum")
        continue;
      out[k] = geminiSchema(v);
    }
    return out;
  }
  return schema;
}

function toolNames(messages: Message[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content)
      if (b.type === "tool_use") names.set(b.id, b.name);
  }
  return names;
}

export function toContents(
  messages: Message[],
): { role: string; parts: Part[] }[] {
  const names = toolNames(messages);
  return messages.map((m) => {
    if (typeof m.content === "string")
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      };
    const parts: Part[] = [];
    for (const b of m.content) {
      if (b.type === "text")
        parts.push((b.raw as Part | undefined) ?? { text: b.text });
      else if (b.type === "tool_use")
        parts.push(
          (b.raw as Part | undefined) ?? {
            functionCall: { id: b.id, name: b.name, args: b.input },
          },
        );
      else {
        let body: unknown = b.content;
        try {
          body = JSON.parse(b.content);
        } catch {
          /* keep as text */
        }
        parts.push({
          functionResponse: {
            id: b.tool_use_id,
            name: names.get(b.tool_use_id) ?? "unknown",
            response: b.is_error ? { error: body } : { result: body },
          },
        });
      }
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

export function fromParts(parts: Part[]): Block[] {
  const out: Block[] = [];
  let n = 0;
  for (const p of parts) {
    if (p.thought === true) continue;
    const fc = p.functionCall as
      | { id?: string; name?: string; args?: Record<string, unknown> }
      | undefined;
    if (fc?.name) {
      const id = fc.id ?? `call_${n++}`;
      out.push({
        type: "tool_use",
        id,
        name: fc.name,
        input: fc.args ?? {},
        raw: fc.id ? p : { ...p, functionCall: { ...fc, id } },
      });
    } else if (typeof p.text === "string") {
      out.push({ type: "text", text: p.text, raw: p });
    }
  }
  return out;
}

export function geminiProvider(opts: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Provider {
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "gemini",
    model: opts.model,
    async step({
      system,
      messages,
      tools,
      maxTokens,
    }: {
      system: string;
      messages: Message[];
      tools: ToolDef[];
      maxTokens: number;
    }): Promise<ProviderReply> {
      const res = await f(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": opts.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: toContents(messages),
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: geminiSchema(t.input_schema),
                })),
              },
            ],
            generationConfig: { maxOutputTokens: Math.min(maxTokens, 4000) },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (!res.ok)
        throw new Error(`model request failed with status ${res.status}`);
      const j = (await res.json()) as {
        candidates?: { content?: { parts?: Part[] } }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
        };
      };
      const parts = j.candidates?.[0]?.content?.parts;
      if (!parts)
        throw new Error("model returned no content (possibly blocked)");
      const u = j.usageMetadata ?? {};
      return {
        content: fromParts(parts),
        usage: {
          input: u.promptTokenCount ?? 0,
          output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}
