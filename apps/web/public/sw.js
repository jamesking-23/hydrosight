// HydroSight community app worker.
// It only keeps the app SHELL so the page opens without a connection. It never caches reports,
// warnings, sign-in or API answers: stale warnings must never look current. Reports typed while
// offline are kept by the app itself (IndexedDB) and sent when the connection returns.
const SHELL = "hydrosight-shell-v1";
const SHELL_URLS = ["/community", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // API and Supabase: network only
  if (req.mode === "navigate" && url.pathname === "/community") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(SHELL).then((c) => c.put("/community", copy));
          return res;
        })
        .catch(() => caches.match("/community").then((hit) => hit ?? Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            void caches.open(SHELL).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
