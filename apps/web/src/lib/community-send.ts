"use client";
import { CONSENT_VERSION, base64ToHex, classifyResponse, type QueuedReport, type SendOutcome } from "@/lib/community";
import { createClient } from "@/lib/supabase/browser";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** Sends one queued report. A signed-in person who did not choose "anonymous" goes through their
 *  account (so they can withdraw it later); everyone else goes through the public API. Either way
 *  the same client id is used, so a retry can never create a second report. */
export async function sendQueued(item: QueuedReport, signedIn: boolean): Promise<SendOutcome> {
  const d = item.draft;
  if (signedIn && !d.anonymous) {
    const { error } = await createClient().rpc("submit_community_report", {
      p_org: d.orgId,
      p_client_id: item.clientId,
      p_kind: d.kind,
      p_description: d.description || null,
      p_depth_cm: d.waterDepthCm,
      p_lon: d.lon,
      p_lat: d.lat,
      p_accuracy_m: d.accuracyM,
      p_observed_at: d.observedAt,
      p_consent_version: CONSENT_VERSION,
      p_anonymous: false,
      p_photo: d.photoBase64 ? base64ToHex(d.photoBase64) : null,
      p_photo_type: d.photoBase64 ? "image/jpeg" : null,
    } as never);
    if (!error) return { kind: "sent" };
    if (error.code === "42501" || error.code === "22023") {
      return { kind: "rejected", reason: error.message };
    }
    return { kind: "retry", reason: error.message };
  }
  if (!API_URL) return { kind: "rejected", reason: "The reporting service address is not configured." };
  try {
    const res = await fetch(`${API_URL}/v1/community/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org: d.orgSlug,
        client_id: item.clientId,
        kind: d.kind,
        description: d.description || null,
        water_depth_cm: d.waterDepthCm,
        lon: d.lon,
        lat: d.lat,
        accuracy_m: d.accuracyM,
        observed_at: d.observedAt,
        consent_version: CONSENT_VERSION,
        photo_base64: d.photoBase64,
      }),
    });
    let detail = "";
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : "";
    }
    return classifyResponse(res.status, detail);
  } catch {
    return classifyResponse(0, "no connection");
  }
}
