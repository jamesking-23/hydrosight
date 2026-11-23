# Payments research (Phase 9)

Status: **no payment provider is chosen or connected.** Nothing here was verified by a live account, sandbox call or contract. HydroSight makes no payment claim on screen; invoices are paid by arrangement and recorded by the owner.

## What was read (2026-11-22)
| Provider | What its own pages say | Not stated / UNVERIFIED |
|---|---|---|
| Flutterwave (developer docs, Uganda page) | Uganda mobile-money collection in UGX, networks MTN and Airtel. Flow: charge request, customer authorises on the phone, redirect, `charge.completed` webhook, then verify the transaction before crediting. Required fields: phone number, network, amount, currency, email, transaction reference. A test mode exists. | Fees, limits, settlement times, onboarding documents, whether a Ugandan company is eligible, licence status in Uganda. |
| Pesapal Uganda (business page) | Accepts cards and "Mobile Money", UGX and USD, a per-transaction fee, sign-up through a request-a-demo page. | Which mobile networks, fee amounts, onboarding documents, API terms. |
| MTN MoMo developer portal | The page fetched returned no usable content. | Sandbox versus production access, go-live requirements, whether a business can integrate directly. |
| Airtel Money (API) | Only third-party guides were found and not read. | Everything. |
| Bank of Uganda payment-provider list | The document fetched returned no usable content. | Which providers are licensed. |

## What the owner must decide or confirm before any provider is connected
1. The legal entity that will receive money, and what the provider requires to open an account.
2. Fees, settlement currency and time, and refund or chargeback rules, from the provider's own written terms.
3. That the provider is licensed to operate in Uganda (check the central bank's published list directly).
4. Whether customers want to pay online at all, or by bank transfer or mobile money by arrangement.

## Design that is ready
`apps/web/src/lib/payments/` defines a `PaymentProvider` interface (start a payment, parse a webhook). Two implementations exist: `none` (default) and `manual` (instructions only). `PAYMENT_PROVIDER` can only select `manual`; any other value falls back to `none`, so a typo cannot switch on an unverified provider. A real adapter must verify webhook signatures and re-check the amount with the provider before it may mark anything paid (the database already requires a method and reference for `paid`).
