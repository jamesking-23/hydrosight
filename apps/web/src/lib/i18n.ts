import en from "@/messages/en.json";
import lg from "@/messages/lg.json";
import sw from "@/messages/sw.json";

export const LOCALES = ["en", "lg", "sw"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export type Messages = typeof en;
export type MessageKey = keyof Messages;

/**
 * lg (Luganda) and sw (Swahili) keys exist from Phase 0 but values are empty until
 * a human translator supplies them. Empty values fall back to English, and
 * isPendingTranslation() lets the UI flag text as "needs human review".
 */
const catalogues: Record<Locale, Record<string, string>> = { en, lg, sw };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isPendingTranslation(locale: Locale, key: MessageKey): boolean {
  return locale !== DEFAULT_LOCALE && !catalogues[locale][key];
}

export function t(locale: Locale, key: MessageKey): string {
  return catalogues[locale][key] || en[key];
}
