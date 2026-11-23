export const CONSENT_VERSION = "demo-2026-11-draft";
export const CONSENT_TEXT =
  "I agree that HydroSight may use these details to contact me about this request. Details are kept only for that purpose.";

export interface DemoInput {
  name: string;
  email: string;
  organisation: string;
  role_title: string;
  country: string;
  interest: string;
  message: string;
  consent: boolean;
  website: string; // honeypot: real people leave it empty
}

export type DemoCheck =
  | { ok: true; value: Omit<DemoInput, "website"> }
  | { ok: false; error: string; bot?: boolean };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function checkDemoInput(raw: Record<string, unknown>): DemoCheck {
  if (s(raw.website) !== "") return { ok: false, error: "rejected", bot: true };
  const v = {
    name: s(raw.name),
    email: s(raw.email),
    organisation: s(raw.organisation),
    role_title: s(raw.role_title),
    country: s(raw.country),
    interest: s(raw.interest),
    message: s(raw.message),
    consent: raw.consent === true,
  };
  if (v.name.length < 2 || v.name.length > 120)
    return { ok: false, error: "Enter your name." };
  if (!EMAIL.test(v.email) || v.email.length > 254)
    return { ok: false, error: "Enter a valid email address." };
  if (v.organisation.length < 2 || v.organisation.length > 160)
    return { ok: false, error: "Enter your organisation." };
  if (v.role_title.length > 120)
    return { ok: false, error: "Role is too long (120 characters at most)." };
  if (v.country.length > 80)
    return { ok: false, error: "Country is too long (80 characters at most)." };
  if (v.interest.length > 200)
    return {
      ok: false,
      error: "Interest is too long (200 characters at most).",
    };
  if (v.message.length > 2000)
    return {
      ok: false,
      error: "Message is too long (2000 characters at most).",
    };
  if (!v.consent)
    return {
      ok: false,
      error: "Tick the box so we may contact you about this request.",
    };
  return { ok: true, value: v };
}
