import type { Block, Provider, ProviderReply } from "./types";

/**
 * Claude Messages API over fetch. UNVERIFIED against the live API: no API key was available when this
 * was written, so only the request/response shape from the public documentation is implemented.
 * The model name has no default: the owner chooses it (ASSISTANT_MODEL).
 */
export function anthropicProvider(opts: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Provider {
  const f = opts.fetchImpl ?? fetch;
  return {
    name: "anthropic",
    model: opts.model,
    async step({ system, messages, tools, maxTokens }): Promise<ProviderReply> {
      const res = await f("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: Math.min(maxTokens, 2000),
          system,
          messages,
          tools,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok)
        throw new Error(`model request failed with status ${res.status}`);
      const j = (await res.json()) as {
        content?: Block[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        content: j.content ?? [],
        usage: {
          input: j.usage?.input_tokens ?? 0,
          output: j.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
