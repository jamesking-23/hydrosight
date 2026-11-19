import { describe, expect, it } from "vitest";
import { isPendingTranslation, t, type MessageKey } from "@/lib/i18n";
import en from "@/messages/en.json";
import lg from "@/messages/lg.json";
import sw from "@/messages/sw.json";

describe("i18n scaffold (HS-I18N-001)", () => {
  it("has the same keys in en, lg and sw", () => {
    expect(Object.keys(lg).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort());
  });

  it("falls back to English and flags untranslated text for human review", () => {
    const key: MessageKey = "maturity.unvalidated";
    expect(t("lg", key)).toBe(en[key]);
    expect(isPendingTranslation("lg", key)).toBe(true);
    expect(isPendingTranslation("en", key)).toBe(false);
  });
});
