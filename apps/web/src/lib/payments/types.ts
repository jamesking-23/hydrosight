/**
 * Payment-provider boundary. HydroSight has NO live payment provider connected (see
 * docs/PAYMENTS_RESEARCH.md: provider choice, onboarding and fees are UNVERIFIED).
 * Code outside lib/payments only talks to this interface, so a verified provider can be added
 * later without touching invoices or screens.
 */
export interface PaymentRequest {
  invoiceNumber: string;
  amount: string; // decimal string exactly as on the invoice; never recalculated
  currency: string;
  payerEmail?: string;
  payerPhone?: string;
  method: "mobile_money" | "card" | "bank_transfer";
}

export type PaymentStart =
  | { kind: "not_available"; reason: string }
  | { kind: "manual"; instructions: string }
  | { kind: "redirect"; url: string; providerReference: string };

export interface PaymentEvent {
  providerReference: string;
  invoiceNumber: string;
  status: "succeeded" | "failed" | "pending";
  amount: string;
  currency: string;
}

export interface PaymentProvider {
  /** Machine name; "none" and "manual" are the only ones that exist today. */
  readonly name: string;
  /** True only for a provider whose account, fees and requirements have been verified by the owner. */
  readonly verified: boolean;
  start(req: PaymentRequest): Promise<PaymentStart>;
  /** Must verify the signature and re-check the amount with the provider before returning an event. */
  parseWebhook(headers: Headers, rawBody: string): Promise<PaymentEvent | null>;
}
