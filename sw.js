const CACHE_NAME = "bitbus-static-v20260904-14";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/schedule-data.js",
  "/manifest.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png",
  "/assets/favicon-32.png",
  "/assets/qr-forward.png",
  "/assets/qr-reverse.png",
  "/lib/schedule.js",
  "/lib/time.js",
  "/lib/availability.js",
  "/lib/traffic.js",
  "/lib/duration-profiles.js",
  "/lib/install-guide.js",
  "/lib/qq-guide.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // 动态 API 一律放行（不走缓存），保证余座/实时路况实时更新，页面刷新即可见
  const reqUrl = new URL(req.url);
  if (reqUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
        return resp;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp.ok && new URL(req.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      }).catch(() => {
        if (req.destination === "document") return caches.match("/index.html");
        return caches.match(req, { ignoreSearch: true });
      });
    })
  );
});
