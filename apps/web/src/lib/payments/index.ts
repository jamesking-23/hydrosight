import { manualProvider, notConfiguredProvider } from "./manual";
import type { PaymentProvider } from "./types";

export type {
  PaymentEvent,
  PaymentProvider,
  PaymentRequest,
  PaymentStart,
} from "./types";

/**
 * Chosen by PAYMENT_PROVIDER. Only "manual" and "none" exist. Any other value is refused (falls back
 * to "none") rather than guessed, so a typo can never switch on a provider that was not verified.
 */
export function paymentProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): PaymentProvider {
  return env.PAYMENT_PROVIDER === "manual"
    ? manualProvider
    : notConfiguredProvider;
}
