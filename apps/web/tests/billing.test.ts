import { describe, expect, it } from "vitest";
import { checkDemoInput } from "@/lib/demo-request";
import {
  featureGate,
  gateMessage,
  limitText,
  type Entitlements,
} from "@/lib/entitlements";
import { money, parseLines } from "@/lib/invoice-format";
import { paymentProviderFromEnv } from "@/lib/payments";
import { HOME_NOT_YET, HOME_WORKS, NAV, PAGES } from "@/lib/site-content";

const managed = (o: Partial<Entitlements> = {}): Entitlements => ({
  managed: true,
  in_force: true,
  features: ["map", "monitoring"],
  ...o,
});

describe("entitlements display rule", () => {
  it("does not gate an organisation with no plan", () => {
    expect(
      featureGate({ managed: false, in_force: true }, "assistant"),
    ).toEqual({ allowed: true });
  });
  it("blocks a feature that the plan lacks", () => {
    expect(featureGate(managed(), "assistant")).toEqual({
      allowed: false,
      reason: "not_in_plan",
    });
    expect(featureGate(managed(), "map")).toEqual({ allowed: true });
  });
  it("blocks everything when the plan is not in force, even included features", () => {
    expect(featureGate(managed({ in_force: false }), "map")).toEqual({
      allowed: false,
      reason: "plan_inactive",
    });
  });
  it("explains the block and says data is kept", () => {
    const m = gateMessage(
      { allowed: false, reason: "plan_inactive" },
      "analytics",
    );
    expect(m).toMatch(/not active/);
    expect(m).toMatch(/kept/);
    expect(gateMessage({ allowed: true }, "map")).toBeNull();
  });
  it("describes limits", () => {
    expect(limitText({ limit: 5, unlimited: false, used: 2 })).toBe(
      "2 of 5 used",
    );
    expect(limitText({ limit: null, unlimited: true, used: 9 })).toBe(
      "9 used, no limit",
    );
    expect(limitText({ limit: 0, unlimited: false, used: 0 })).toBe(
      "0 of 0 used",
    );
  });
});

describe("payment provider selection", () => {
  it("has no live provider: anything but manual is 'none'", () => {
    expect(paymentProviderFromEnv({}).name).toBe("none");
    expect(
      paymentProviderFromEnv({ PAYMENT_PROVIDER: "flutterwave" }).name,
    ).toBe("none");
    expect(paymentProviderFromEnv({ PAYMENT_PROVIDER: "manual" }).name).toBe(
      "manual",
    );
  });
  it("never reports a verified provider", () => {
    for (const v of [undefined, "manual", "pesapal"]) {
      expect(paymentProviderFromEnv({ PAYMENT_PROVIDER: v }).verified).toBe(
        false,
      );
    }
  });
  it("starts no online payment and parses no webhook", async () => {
    const req = {
      invoiceNumber: "HS-2026-000001",
      amount: "10.00",
      currency: "UGX",
      method: "mobile_money" as const,
    };
    expect((await paymentProviderFromEnv({}).start(req)).kind).toBe(
      "not_available",
    );
    const manual = await paymentProviderFromEnv({
      PAYMENT_PROVIDER: "manual",
    }).start(req);
    expect(manual.kind).toBe("manual");
    if (manual.kind === "manual")
      expect(manual.instructions).toMatch(/HS-2026-000001/);
    expect(
      await paymentProviderFromEnv({}).parseWebhook(new Headers(), "{}"),
    ).toBeNull();
  });
});

describe("demo request validation", () => {
  const ok = {
    name: "Jane Doe",
    email: "jane@example.org",
    organisation: "Kasese District",
    consent: true,
    website: "",
  };
  it("accepts a valid request", () => {
    const r = checkDemoInput(ok);
    expect(r.ok).toBe(true);
  });
  it("needs consent", () => {
    expect(checkDemoInput({ ...ok, consent: false })).toMatchObject({
      ok: false,
    });
  });
  it("rejects bad email, short name, long message", () => {
    expect(checkDemoInput({ ...ok, email: "nope" })).toMatchObject({
      ok: false,
    });
    expect(checkDemoInput({ ...ok, name: "J" })).toMatchObject({ ok: false });
    expect(checkDemoInput({ ...ok, message: "x".repeat(2001) })).toMatchObject({
      ok: false,
    });
  });
  it("flags the honeypot as a bot", () => {
    expect(checkDemoInput({ ...ok, website: "http://spam" })).toMatchObject({
      ok: false,
      bot: true,
    });
  });
  it("ignores non-string input safely", () => {
    expect(
      checkDemoInput({
        name: 5,
        email: null,
        organisation: {},
        consent: "true",
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("invoice lines", () => {
  it("parses description | amount rows", () => {
    expect(parseLines("Platform, January | 1,000\nSetup|250.50")).toEqual({
      ok: true,
      lines: [
        { description: "Platform, January", amount: 1000 },
        { description: "Setup", amount: 250.5 },
      ],
    });
  });
  it("rejects missing amounts, negatives and empty input", () => {
    expect(parseLines("")).toMatchObject({ ok: false });
    expect(parseLines("No amount")).toMatchObject({ ok: false });
    expect(parseLines("Thing | -5")).toMatchObject({ ok: false });
    expect(parseLines("Thing | abc")).toMatchObject({ ok: false });
  });
  it("formats money without recalculating", () => {
    expect(money("1180", "UGX")).toBe("UGX 1,180.00");
  });
});

describe("public site copy makes no unverifiable claims", () => {
  const all = [
    ...PAGES.flatMap((p) => [
      p.title,
      p.lead,
      ...p.sections.flatMap((s) => [
        s.heading,
        s.body ?? "",
        ...(s.points ?? []),
      ]),
    ]),
    ...HOME_WORKS,
    ...HOME_NOT_YET,
  ].join("\n");
  it("has no percentages, guarantees or accuracy/lead-time claims", () => {
    expect(all).not.toMatch(/\d\s?%/);
    expect(all).not.toMatch(/guarantee/i);
    expect(all).not.toMatch(
      /\b\d+\s?(minutes|hours|days)\b.*\b(lead|ahead|warning)/i,
    );
    expect(all).not.toMatch(/\b(accurate|accuracy|real-time|real time)\b/i);
  });
  it("has no prices or currency amounts", () => {
    expect(all).not.toMatch(/\b(UGX|USD|KES|TZS|EUR)\b\s?\d/);
    expect(all).not.toMatch(/[$€£]\s?\d/);
  });
  it("never calls HydroSight a prototype and names no customers or partners", () => {
    expect(all).not.toMatch(/prototype/i);
    expect(all).not.toMatch(
      /trusted by|our customers include|in partnership with/i,
    );
  });
  it("lists every public page in the navigation", () => {
    for (const p of PAGES.filter((x) => x.slug !== "contact")) {
      expect(NAV.some((n) => n.href === `/${p.slug}`)).toBe(true);
    }
  });
});
