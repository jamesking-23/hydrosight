/** Community reporting logic that does not touch the browser, so it can be tested directly:
 *  validation, the offline queue, how server answers are classified, and image sizing. */

export const CONSENT_VERSION = "community-report-2026-11";

export const REPORT_KINDS = [
  "flooding",
  "water_level",
  "blocked_drainage",
  "damaged_infrastructure",
  "dangerous_road",
  "other",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportDraft {
  orgId: string;
  orgSlug: string;
  kind: ReportKind | "";
  description: string;
  waterDepthCm: number | null;
  lon: number | null;
  lat: number | null;
  accuracyM: number | null;
  observedAt: string; // ISO time the person saw it, not the time it is sent
  consent: boolean;
  anonymous: boolean;
  photoBase64: string | null;
}

export type ReportProblem =
  | "area"
  | "kind"
  | "location"
  | "consent"
  | "time"
  | "depth"
  | "description";

const MAX_AGE_MS = 14 * 24 * 3600 * 1000; // matches the database rule
const FUTURE_SLACK_MS = 5 * 60 * 1000;

export function validateDraft(d: ReportDraft, now: number = Date.now()): ReportProblem[] {
  const problems: ReportProblem[] = [];
  if (!d.orgSlug) problems.push("area");
  if (!d.kind) problems.push("kind");
  if (
    d.lon === null ||
    d.lat === null ||
    !Number.isFinite(d.lon) ||
    !Number.isFinite(d.lat) ||
    Math.abs(d.lon) > 180 ||
    Math.abs(d.lat) > 90
  ) {
    problems.push("location");
  }
  if (!d.consent) problems.push("consent");
  const t = Date.parse(d.observedAt);
  if (Number.isNaN(t) || t > now + FUTURE_SLACK_MS || t < now - MAX_AGE_MS) problems.push("time");
  if (d.waterDepthCm !== null && (!Number.isFinite(d.waterDepthCm) || d.waterDepthCm < 0 || d.waterDepthCm > 1000)) {
    problems.push("depth");
  }
  if (d.description.length > 1000) problems.push("description");
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------------------------

export interface QueuedReport {
  clientId: string; // made once on the device: a retry can never create a second report
  draft: ReportDraft;
  createdAt: number;
  attempts: number;
  state: "pending" | "failed";
  failure?: string;
}

export interface QueueStore {
  all(): Promise<QueuedReport[]>;
  put(item: QueuedReport): Promise<void>;
  remove(clientId: string): Promise<void>;
}

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "retry"; reason: string }
  | { kind: "rejected"; reason: string };

export type Sender = (item: QueuedReport) => Promise<SendOutcome>;

/** Turns a server answer into what the queue should do. Anything that may succeed later (no
 *  network, server trouble, rate cap) is retried; anything the server refused for the content is
 *  kept and shown to the person, never retried forever and never silently dropped. */
export function classifyResponse(status: number, detail: string): SendOutcome {
  if (status === 200 || status === 201) return { kind: "sent" };
  if (status === 0 || status === 429 || status >= 500) {
    return { kind: "retry", reason: detail || `server answered ${status}` };
  }
  return { kind: "rejected", reason: detail || `server answered ${status}` };
}

export function newClientId(): string {
  return crypto.randomUUID();
}

export async function enqueue(store: QueueStore, draft: ReportDraft, now: number = Date.now()): Promise<QueuedReport> {
  const item: QueuedReport = { clientId: newClientId(), draft, createdAt: now, attempts: 0, state: "pending" };
  await store.put(item);
  return item;
}

export interface FlushResult {
  sent: number;
  retry: number;
  rejected: number;
}

/** Sends the oldest first. On a retryable failure it stops (the network is probably down) and
 *  keeps the item; a refused item is marked failed and the rest continue. */
export async function flushQueue(store: QueueStore, send: Sender): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, retry: 0, rejected: 0 };
  const items = (await store.all()).filter((i) => i.state === "pending").sort((a, b) => a.createdAt - b.createdAt);
  for (const item of items) {
    let outcome: SendOutcome;
    try {
      outcome = await send(item);
    } catch (e) {
      outcome = { kind: "retry", reason: e instanceof Error ? e.message : "network error" };
    }
    if (outcome.kind === "sent") {
      await store.remove(item.clientId);
      result.sent += 1;
    } else if (outcome.kind === "rejected") {
      await store.put({ ...item, attempts: item.attempts + 1, state: "failed", failure: outcome.reason });
      result.rejected += 1;
    } else {
      await store.put({ ...item, attempts: item.attempts + 1, failure: outcome.reason });
      result.retry += 1;
      break;
    }
  }
  return result;
}

export function createMemoryStore(initial: QueuedReport[] = []): QueueStore {
  const map = new Map(initial.map((i) => [i.clientId, i]));
  return {
    all: async () => [...map.values()],
    put: async (i) => void map.set(i.clientId, i),
    remove: async (id) => void map.delete(id),
  };
}

// ---------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------

/** Size an image to fit inside max x max, never enlarging it. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Quality steps tried until the photo is small enough for a weak mobile connection. */
export const QUALITY_STEPS = [0.7, 0.6, 0.5, 0.4, 0.3] as const;
export const PHOTO_TARGET_BYTES = 350_000;

// ---------------------------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------------------------

/** Trust SIGNALS from the database, shown as plain facts. They are not a score or a verdict. */
export function describeSignals(s: {
  signed_in?: boolean;
  has_photo?: boolean;
  location_accuracy_m?: number | null;
  corroborating_reports?: number;
  reporter_validated_reports?: number | null;
}): string[] {
  const out: string[] = [];
  if (s.signed_in) out.push("from a signed-in account");
  else out.push("anonymous");
  if (s.has_photo) out.push("has a photo");
  if (typeof s.location_accuracy_m === "number") out.push(`location accurate to about ${Math.round(s.location_accuracy_m)} m`);
  if (s.corroborating_reports) {
    out.push(`${s.corroborating_reports} other nearby report${s.corroborating_reports === 1 ? "" : "s"}`);
  }
  if (s.reporter_validated_reports) {
    out.push(`reporter has ${s.reporter_validated_reports} earlier report${s.reporter_validated_reports === 1 ? "" : "s"} confirmed by a moderator`);
  }
  return out;
}

/** PostgREST returns bytea as a "\x..." hex string; turn it into bytes for display. */
export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let hex = "\\x";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}
