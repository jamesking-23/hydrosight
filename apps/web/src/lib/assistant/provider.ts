import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import type { Provider } from "./types";

type Env = Record<string, string | undefined>;

/** Chooses the model provider from deployment settings. Returns null when it is not fully configured. */
export function providerFromEnv(
  env: Env,
  fetchImpl?: typeof fetch,
): Provider | null {
  const which = env.ASSISTANT_PROVIDER ?? "";
  const model = env.ASSISTANT_MODEL ?? "";
  if (!model) return null;
  if (which === "gemini" && env.GEMINI_API_KEY)
    return geminiProvider({ apiKey: env.GEMINI_API_KEY, model, fetchImpl });
  if (which === "anthropic" && env.ANTHROPIC_API_KEY)
    return anthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model,
      fetchImpl,
    });
  return null;
}
