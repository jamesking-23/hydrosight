import type { PaymentProvider } from "./types";

/** Offline arrangement: the customer pays by agreement and the owner records it against the invoice. */
export const manualProvider: PaymentProvider = {
  name: "manual",
  verified: false,
  async start(req) {
    return {
      kind: "manual",
      instructions: `Online payment is not available. Pay by arrangement with HydroSight and quote invoice ${req.invoiceNumber}. The invoice is marked paid only after the payment is recorded against it.`,
    };
  },
  async parseWebhook() {
    return null;
  },
};

export const notConfiguredProvider: PaymentProvider = {
  name: "none",
  verified: false,
  async start() {
    return {
      kind: "not_available",
      reason: "No payment provider is connected.",
    };
  },
  async parseWebhook() {
    return null;
  },
};
