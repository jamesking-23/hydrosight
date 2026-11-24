"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceBadge } from "@/components/source-badge";
import { Button, ErrorNote, GhostButton, inputCls } from "@/components/ui";
import {
  REPORT_KINDS,
  enqueue,
  flushQueue,
  validateDraft,
  type QueuedReport,
  type ReportDraft,
  type ReportProblem,
} from "@/lib/community";
import { API_URL, sendQueued } from "@/lib/community-send";
import { indexedDbStore } from "@/lib/community-store";
import { LOCALES, isPendingTranslation, t, type Locale, type MessageKey } from "@/lib/i18n";
import { compressPhoto } from "@/lib/photo";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/browser";

interface Area {
  id: string;
  slug: string;
  name: string;
  exercise: boolean;
}
interface PublicAlert {
  id: string;
  level: string;
  title: string;
  location: string;
  published_at: string;
  exercise: boolean;
}
interface Resource {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  phone: string | null;
}

type Tab = "report" | "warnings" | "help" | "settings";
const TABS: Tab[] = ["report", "warnings", "help", "settings"];
const LOCALE_NAMES: Record<Locale, string> = { en: "English", lg: "Luganda", sw: "Kiswahili" };

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return ""; // private mode: defaults are fine
  }
}

function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function emptyDraft(area: Area | undefined): ReportDraft {
  return {
    orgId: area?.id ?? "",
    orgSlug: area?.slug ?? "",
    kind: "",
    description: "",
    waterDepthCm: null,
    lon: null,
    lat: null,
    accuracyM: null,
    observedAt: new Date().toISOString(),
    consent: false,
    anonymous: true,
    photoBase64: null,
  };
}

export function CommunityApp() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = readStored("hs-locale");
    return (LOCALES as readonly string[]).includes(saved) ? (saved as Locale) : "en";
  });
  const [tab, setTab] = useState<Tab>("report");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [signedIn, setSignedIn] = useState(false);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaSlug, setAreaSlug] = useState(() => readStored("hs-area"));
  const [loadError, setLoadError] = useState("");
  const [queue, setQueue] = useState<QueuedReport[]>([]);

  const tr = useCallback((key: MessageKey) => t(locale, key), [locale]);
  const area = useMemo(() => areas.find((a) => a.slug === areaSlug), [areas, areaSlug]);

  const refreshQueue = useCallback(async () => setQueue(await indexedDbStore.all()), []);
  const flush = useCallback(async () => {
    await flushQueue(indexedDbStore, (item) => sendQueued(item, signedIn));
    await refreshQueue();
  }, [signedIn, refreshQueue]);

  // One-time setup: online state, sign-in state, installable app worker, sending anything saved.
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void flush();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (isSupabaseConfigured) {
      void createClient().auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    }
    const first = setTimeout(() => void (navigator.onLine ? flush() : refreshQueue()), 0);
    return () => {
      clearTimeout(first);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [flush, refreshQueue]);

  useEffect(() => {
    if (!API_URL) return;
    fetch(`${API_URL}/v1/community/areas`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`service answered ${r.status}`))))
      .then((b: { areas: Area[] }) => {
        setAreas(b.areas);
        setAreaSlug((cur) => (b.areas.some((a) => a.slug === cur) ? cur : (b.areas[0]?.slug ?? "")));
      })
      .catch((e: Error) => setLoadError(navigator.onLine ? e.message : ""));
  }, []);

  function chooseLocale(l: Locale) {
    setLocale(l);
    try {
      localStorage.setItem("hs-locale", l);
    } catch {
      /* ignore */
    }
  }
  function chooseArea(slug: string) {
    setAreaSlug(slug);
    try {
      localStorage.setItem("hs-area", slug);
    } catch {
      /* ignore */
    }
  }

  return (
    <div lang={locale} className="mx-auto max-w-xl px-4 pb-24 pt-4">
      <h1 className="mb-2 text-2xl font-bold">{tr("community.title")}</h1>
      {!online ? (
        <p role="status" className="mb-3 rounded-md border border-src-estimated/50 bg-[#fff6d6] p-2 text-sm">
          {tr("net.offline")}
        </p>
      ) : null}
      <ErrorNote>{loadError || (API_URL ? "" : "The reporting service address is not configured.")}</ErrorNote>
      {areas.length === 0 && !loadError && API_URL ? <p className="text-sm text-muted">{tr("community.area.none")}</p> : null}
      {areas.length > 0 ? (
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-semibold">{tr("community.area")}</span>
          <select className={inputCls} value={areaSlug} onChange={(e) => chooseArea(e.target.value)}>
            {areas.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
                {a.exercise ? ` — ${tr("community.exercise")}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <nav aria-label="Sections" className="mb-5 flex gap-1 rounded-lg border border-line p-1">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className={`min-h-11 flex-1 rounded-md px-2 py-2 text-sm font-semibold ${tab === k ? "bg-ocean text-white" : "hover:bg-[#eef3f8]"}`}
          >
            {tr(`community.tab.${k}` as MessageKey)}
          </button>
        ))}
      </nav>

      {tab === "report" ? (
        <>
          <section className="mb-6 rounded-lg border border-line p-4">
            <h2 className="mb-1 font-bold">{tr("risk.title")}</h2>
            <p className="text-sm text-muted">{tr("risk.none")}</p>
          </section>
          <ReportForm
            key={area?.slug ?? "none"}
            area={area}
            locale={locale}
            signedIn={signedIn}
            online={online}
            onQueued={async () => {
              await refreshQueue();
              if (online) await flush();
            }}
          />
          <QueuePanel locale={locale} queue={queue} onSend={flush} onDiscard={async (id) => {
            await indexedDbStore.remove(id);
            await refreshQueue();
          }} />
        </>
      ) : null}
      {tab === "warnings" ? <Warnings locale={locale} signedIn={signedIn} /> : null}
      {tab === "help" ? <Help locale={locale} slug={areaSlug} /> : null}
      {tab === "settings" ? (
        <section className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">{tr("settings.language")}</span>
            <select className={inputCls} value={locale} onChange={(e) => chooseLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
          {isPendingTranslation(locale, "community.title") ? (
            <p role="note" className="text-sm text-muted">{tr("settings.pending")}</p>
          ) : null}
          <div>
            <h2 className="font-bold">{tr("settings.alerts")}</h2>
            <p className="text-sm text-muted">{tr("settings.alerts.note")}</p>
          </div>
          <p className="text-sm text-muted">{tr("settings.install")}</p>
        </section>
      ) : null}
    </div>
  );
}

function ReportForm({
  area,
  locale,
  signedIn,
  online,
  onQueued,
}: {
  area: Area | undefined;
  locale: Locale;
  signedIn: boolean;
  online: boolean;
  onQueued: () => Promise<void>;
}) {
  const tr = (k: MessageKey) => t(locale, k);
  const [draft, setDraft] = useState<ReportDraft>(() => emptyDraft(area));
  const [when, setWhen] = useState(() => localInputValue(new Date()));
  const [problems, setProblems] = useState<ReportProblem[]>([]);
  const [note, setNote] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [locError, setLocError] = useState("");
  const set = (patch: Partial<ReportDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function useMyLocation() {
    setLocError("");
    if (!navigator.geolocation) return setLocError(tr("report.location.denied"));
    navigator.geolocation.getCurrentPosition(
      (p) => set({ lon: p.coords.longitude, lat: p.coords.latitude, accuracyM: p.coords.accuracy }),
      () => setLocError(tr("report.location.denied")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function onPhoto(file: File | undefined) {
    setPhotoError("");
    if (!file) return;
    try {
      set({ photoBase64: await compressPhoto(file) });
    } catch {
      setPhotoError(tr("report.photo.failed"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote("");
    const ready: ReportDraft = {
      ...draft,
      orgId: area?.id ?? "",
      orgSlug: area?.slug ?? "",
      observedAt: new Date(when).toISOString(),
      anonymous: signedIn ? draft.anonymous : true,
    };
    const found = validateDraft(ready);
    setProblems(found);
    if (found.length > 0) return;
    await enqueue(indexedDbStore, ready); // always saved on the phone first, so nothing is lost
    setDraft(emptyDraft(area));
    setWhen(localInputValue(new Date()));
    setNote(online ? tr("report.sent") : tr("report.saved.offline"));
    await onQueued();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-muted">{tr("report.intro")}</p>
      <div className="flex items-center gap-2">
        <SourceBadge source="community" locale={locale} />
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">{tr("report.kind.label")}</span>
        <select className={inputCls} value={draft.kind} onChange={(e) => set({ kind: e.target.value as ReportDraft["kind"] })}>
          <option value="" />
          {REPORT_KINDS.map((k) => (
            <option key={k} value={k}>
              {tr(`report.kind.${k}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">{tr("report.description")}</span>
        <textarea className={inputCls} rows={3} maxLength={1000} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">{tr("report.depth")}</span>
        <input
          className={inputCls}
          type="number"
          inputMode="decimal"
          min={0}
          max={1000}
          value={draft.waterDepthCm ?? ""}
          onChange={(e) => set({ waterDepthCm: e.target.value === "" ? null : Number(e.target.value) })}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">{tr("report.when")}</span>
        <input className={inputCls} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <GhostButton type="button" onClick={useMyLocation}>{tr("report.location.use")}</GhostButton>
        {draft.lon !== null && draft.lat !== null ? (
          <p role="status" className="text-sm">
            {tr("report.location.have")}
            {draft.accuracyM !== null ? ` (±${Math.round(draft.accuracyM)} m)` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted">{tr("report.location.none")}</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">{tr("report.location.lat")}</span>
            <input className={inputCls} type="number" step="any" value={draft.lat ?? ""} onChange={(e) => set({ lat: e.target.value === "" ? null : Number(e.target.value), accuracyM: null })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">{tr("report.location.lon")}</span>
            <input className={inputCls} type="number" step="any" value={draft.lon ?? ""} onChange={(e) => set({ lon: e.target.value === "" ? null : Number(e.target.value), accuracyM: null })} />
          </label>
        </div>
        <ErrorNote>{locError}</ErrorNote>
      </fieldset>
      <div>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">{tr("report.photo")}</span>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => void onPhoto(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-[#b9cad8] file:bg-white file:px-3 file:py-2 file:font-semibold hover:file:border-ocean" />
        </label>
        <p className="mt-1 text-xs text-muted">{tr("report.photo.note")}</p>
        {draft.photoBase64 ? (
          <p className="mt-1 text-sm">
            {tr("report.photo.added")}{" "}
            <button type="button" className="underline" onClick={() => set({ photoBase64: null })}>{tr("report.photo.remove")}</button>
          </p>
        ) : null}
        <ErrorNote>{photoError}</ErrorNote>
      </div>
      {signedIn ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={draft.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{tr("report.anonymous")}{!draft.anonymous ? ` — ${tr("report.signedin")}` : ""}</span>
        </label>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={draft.consent} onChange={(e) => set({ consent: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0" />
        <span>{tr("report.consent")}</span>
      </label>
      {problems.length > 0 ? (
        <ul role="alert" className="list-disc rounded-md border border-src-synthetic/50 bg-src-synthetic/5 p-3 pl-6 text-sm text-src-synthetic">
          {problems.map((p) => (
            <li key={p}>{tr(`report.problem.${p}` as MessageKey)}</li>
          ))}
        </ul>
      ) : null}
      <Button type="submit" className="w-full">{tr("report.submit")}</Button>
      {note ? <p role="status" className="text-sm font-semibold">{note}</p> : null}
    </form>
  );
}

function QueuePanel({
  locale,
  queue,
  onSend,
  onDiscard,
}: {
  locale: Locale;
  queue: QueuedReport[];
  onSend: () => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  const tr = (k: MessageKey) => t(locale, k);
  if (queue.length === 0) return null;
  return (
    <section className="mt-8 border-t border-line pt-4">
      <h2 className="mb-2 font-bold">{tr("report.queue.title")}</h2>
      <ul className="space-y-2">
        {queue.map((q) => (
          <li key={q.clientId} className="rounded-md border border-line p-3 text-sm">
            <p className="font-semibold">
              {tr(`report.kind.${q.draft.kind || "other"}` as MessageKey)} — {new Date(q.draft.observedAt).toLocaleString()}
            </p>
            {q.state === "failed" ? (
              <p className="text-src-synthetic">
                {tr("report.queue.failed")}: {q.failure}{" "}
                <button className="underline" onClick={() => void onDiscard(q.clientId)}>×</button>
              </p>
            ) : (
              <p className="text-muted">
                {q.failure ? `${q.failure}. ` : ""}
                <button className="underline" onClick={() => void onSend()}>{tr("report.queue.send")}</button>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Warnings({ locale, signedIn }: { locale: Locale; signedIn: boolean }) {
  const tr = (k: MessageKey) => t(locale, k);
  const [alerts, setAlerts] = useState<PublicAlert[] | null>(null);
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState("");

  useEffect(() => {
    if (!API_URL) return;
    fetch(`${API_URL}/v1/cap/alerts`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`service answered ${r.status}`))))
      .then((b: { alerts: PublicAlert[] }) => setAlerts(b.alerts))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function feedback(id: string, stance: "confirm" | "dispute") {
    setError("");
    const { error: err } = await createClient().rpc("give_alert_feedback", { p_alert: id, p_stance: stance, p_note: null } as never);
    if (err) setError(err.message);
    else setThanks(tr("warnings.feedback.thanks"));
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{tr("warnings.title")}</h2>
      <ErrorNote>{error}</ErrorNote>
      {alerts === null && !error ? null : alerts && alerts.length === 0 ? (
        <p className="text-sm text-muted">{tr("warnings.none")}</p>
      ) : (
        <ul className="space-y-3">
          {(alerts ?? []).map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-3">
              <p className="font-bold">{a.title}</p>
              <p className="text-sm text-muted">
                {a.location} · {new Date(a.published_at).toLocaleString()}
                {a.exercise ? ` · ${tr("warnings.exercise")}` : ""}
              </p>
              {signedIn ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <GhostButton onClick={() => void feedback(a.id, "confirm")}>{tr("warnings.confirm")}</GhostButton>
                  <GhostButton onClick={() => void feedback(a.id, "dispute")}>{tr("warnings.dispute")}</GhostButton>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">{tr("warnings.signin")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {thanks ? <p role="status" className="mt-3 text-sm font-semibold">{thanks}</p> : null}
      <p className="mt-3 text-xs text-muted">{tr("warnings.feedback.note")}</p>
    </section>
  );
}

function Help({ locale, slug }: { locale: Locale; slug: string }) {
  const tr = (k: MessageKey) => t(locale, k);
  const [items, setItems] = useState<Resource[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!API_URL || !slug) return;
    fetch(`${API_URL}/v1/community/areas/${encodeURIComponent(slug)}/resources`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`service answered ${r.status}`))))
      .then((b: { resources: Resource[] }) => setItems(b.resources))
      .catch((e: Error) => setError(e.message));
  }, [slug]);
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{tr("help.title")}</h2>
      <ErrorNote>{error}</ErrorNote>
      {items && items.length === 0 ? <p className="text-sm text-muted">{tr("help.none")}</p> : null}
      <ul className="space-y-3">
        {(items ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-line p-3">
            <p className="font-bold">{r.title}</p>
            {r.body ? <p className="text-sm">{r.body}</p> : null}
            {r.phone ? <p className="text-sm"><a className="underline" href={`tel:${r.phone}`}>{r.phone}</a></p> : null}
            <p className="mt-1 text-xs text-muted">{tr("help.checked")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
