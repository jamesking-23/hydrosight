import { describe, expect, it } from "vitest";
import {
  classifyResponse,
  createMemoryStore,
  describeSignals,
  enqueue,
  fitWithin,
  flushQueue,
  hexToBytes,
  base64ToHex,
  validateDraft,
  type QueuedReport,
  type ReportDraft,
  type SendOutcome,
} from "@/lib/community";

const NOW = Date.parse("2026-11-21T10:00:00Z");
const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  orgId: "o1",
  orgSlug: "demo",
  kind: "flooding",
  description: "",
  waterDepthCm: null,
  lon: 32.58,
  lat: 0.31,
  accuracyM: 12,
  observedAt: "2026-11-21T09:55:00Z",
  consent: true,
  anonymous: true,
  photoBase64: null,
  ...over,
});

describe("validateDraft (HS-COM-011)", () => {
  it("accepts a complete report", () => expect(validateDraft(draft(), NOW)).toEqual([]));
  it("requires consent, a kind, an area and a location", () => {
    expect(validateDraft(draft({ consent: false }), NOW)).toContain("consent");
    expect(validateDraft(draft({ kind: "" }), NOW)).toContain("kind");
    expect(validateDraft(draft({ orgSlug: "" }), NOW)).toContain("area");
    expect(validateDraft(draft({ lat: null }), NOW)).toContain("location");
    expect(validateDraft(draft({ lon: 181 }), NOW)).toContain("location");
  });
  it("rejects future and too-old observation times, but allows an offline report from days ago", () => {
    expect(validateDraft(draft({ observedAt: "2026-11-21T11:00:00Z" }), NOW)).toContain("time");
    expect(validateDraft(draft({ observedAt: "2026-11-01T00:00:00Z" }), NOW)).toContain("time");
    expect(validateDraft(draft({ observedAt: "2026-11-19T10:00:00Z" }), NOW)).toEqual([]);
    expect(validateDraft(draft({ observedAt: "nonsense" }), NOW)).toContain("time");
  });
  it("limits depth and description", () => {
    expect(validateDraft(draft({ waterDepthCm: -1 }), NOW)).toContain("depth");
    expect(validateDraft(draft({ waterDepthCm: 5000 }), NOW)).toContain("depth");
    expect(validateDraft(draft({ description: "x".repeat(1001) }), NOW)).toContain("description");
  });
});

describe("classifyResponse", () => {
  it("sends, retries or rejects", () => {
    expect(classifyResponse(201, "")).toEqual({ kind: "sent" });
    expect(classifyResponse(0, "")).toMatchObject({ kind: "retry" });
    expect(classifyResponse(429, "too many reports")).toEqual({ kind: "retry", reason: "too many reports" });
    expect(classifyResponse(503, "")).toMatchObject({ kind: "retry" });
    expect(classifyResponse(422, "observed_at is in the future")).toEqual({
      kind: "rejected",
      reason: "observed_at is in the future",
    });
    expect(classifyResponse(403, "")).toMatchObject({ kind: "rejected" });
  });
});

describe("offline queue (HS-COM-012)", () => {
  it("keeps what was observed when it was observed, and gives each report its own id", async () => {
    const store = createMemoryStore();
    const a = await enqueue(store, draft(), 1);
    const b = await enqueue(store, draft(), 2);
    expect(a.clientId).not.toEqual(b.clientId);
    expect(a.draft.observedAt).toBe("2026-11-21T09:55:00Z");
  });

  it("sends everything in order once back online and empties the queue", async () => {
    const store = createMemoryStore();
    await enqueue(store, draft({ description: "second" }), 2);
    await enqueue(store, draft({ description: "first" }), 1);
    const order: string[] = [];
    const res = await flushQueue(store, async (i) => {
      order.push(i.draft.description);
      return { kind: "sent" };
    });
    expect(order).toEqual(["first", "second"]);
    expect(res).toEqual({ sent: 2, retry: 0, rejected: 0 });
    expect(await store.all()).toEqual([]);
  });

  it("stops at the first network failure and keeps every unsent report", async () => {
    const store = createMemoryStore();
    for (let i = 1; i <= 3; i++) await enqueue(store, draft({ description: `r${i}` }), i);
    let calls = 0;
    const res = await flushQueue(store, async () => {
      calls += 1;
      return calls === 1 ? { kind: "sent" } : { kind: "retry", reason: "offline" };
    });
    expect(res).toEqual({ sent: 1, retry: 1, rejected: 0 });
    expect(calls).toBe(2);
    const left = await store.all();
    expect(left).toHaveLength(2);
    expect(left.every((i) => i.state === "pending")).toBe(true);
  });

  it("treats a thrown network error as retry, not as loss", async () => {
    const store = createMemoryStore();
    await enqueue(store, draft());
    const res = await flushQueue(store, async () => {
      throw new Error("Failed to fetch");
    });
    expect(res.retry).toBe(1);
    expect(await store.all()).toHaveLength(1);
  });

  it("keeps a refused report as failed with the reason and carries on with the others", async () => {
    const store = createMemoryStore();
    await enqueue(store, draft({ description: "bad" }), 1);
    await enqueue(store, draft({ description: "good" }), 2);
    const res = await flushQueue(store, async (i): Promise<SendOutcome> =>
      i.draft.description === "bad" ? { kind: "rejected", reason: "not accepted here" } : { kind: "sent" },
    );
    expect(res).toEqual({ sent: 1, retry: 0, rejected: 1 });
    const left: QueuedReport[] = await store.all();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ state: "failed", failure: "not accepted here" });
    // a failed report is not retried by the next flush
    const again = await flushQueue(store, async () => ({ kind: "sent" }));
    expect(again).toEqual({ sent: 0, retry: 0, rejected: 0 });
  });

  it("sending twice with the same client id is safe because the id never changes", async () => {
    const store = createMemoryStore();
    const item = await enqueue(store, draft());
    const seen: string[] = [];
    await flushQueue(store, async (i) => {
      seen.push(i.clientId);
      return { kind: "retry", reason: "offline" };
    });
    await flushQueue(store, async (i) => {
      seen.push(i.clientId);
      return { kind: "sent" };
    });
    expect(seen).toEqual([item.clientId, item.clientId]);
  });
});

describe("images and display helpers", () => {
  it("fits within the longest edge without enlarging", () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(600, 400, 1280)).toEqual({ width: 600, height: 400 });
    expect(fitWithin(1, 5000, 1280)).toEqual({ width: 1, height: 1280 });
  });
  it("round-trips bytes through the hex form PostgREST uses", () => {
    const hex = base64ToHex(btoa("Hi!"));
    expect(hex).toBe("\\x486921");
    expect(Array.from(hexToBytes(hex))).toEqual([72, 105, 33]);
  });
  it("describes trust signals as plain facts, not a score", () => {
    const lines = describeSignals({
      signed_in: false,
      has_photo: true,
      location_accuracy_m: 14.6,
      corroborating_reports: 2,
      reporter_validated_reports: null,
    });
    expect(lines).toEqual(["anonymous", "has a photo", "location accurate to about 15 m", "2 other nearby reports"]);
    expect(lines.join(" ")).not.toMatch(/score|trusted|reliable/i);
  });
});
