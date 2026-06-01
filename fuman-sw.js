const CACHE_VERSION = "fuman-terminal-sw-20260601-05";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_ASSETS = [
  "/styles.css?v=realtime-radar-date-20260601-02",
  "/terminal-core.js?v=realtime-radar-date-20260601-02",
  "/terminal-modules.js?v=realtime-radar-date-20260601-02",
  "/terminal-sector-map.js?v=realtime-radar-date-20260601-02",
  "/terminal-strategy-config.js?v=realtime-radar-date-20260601-02",
  "/terminal-market-config.js?v=realtime-radar-date-20260601-02",
  "/terminal-ui-config.js?v=realtime-radar-date-20260601-02",
  "/terminal-runtime-config.js?v=realtime-radar-date-20260601-02",
  "/terminal-tuning-config.js?v=realtime-radar-date-20260601-02",
  "/terminal-worker.js?v=realtime-radar-date-20260601-02",
  "/terminal.js?v=realtime-radar-date-20260601-02",
  "/terminal-realtime-radar.css?v=realtime-radar-date-20260601-02",
  "/terminal-intraday-radar.css?v=realtime-radar-date-20260601-02",
  "/terminal-utility.css?v=realtime-radar-date-20260601-02",
  "/assets/logo.webp",
  "/assets/login-bg-fuman-lite.webp",
  "/favicon.ico",
];

const DATA_PATTERNS = [
  /\/data\/.*summary\.json/i,
  /\/data\/.*-slim\.json/i,
  /\/data\/.*-top\.json/i,
  /\/data\/market-summary\.json/i,
  /\/data\/mobile-home-summary\.json/i,
  /\/data\/health-summary\.json/i,
];

const LIVE_PATTERNS = [
  /\/api\/realtime/i,
  /\/api\/scan-/i,
  /\/data\/strategy2-intraday-latest\.json/i,
  /\/data\/realtime-radar-latest\.json/i,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("fuman-terminal-sw-") && !key.startsWith(CACHE_VERSION))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isSameOriginGet(request) {
  return request.method === "GET" && new URL(request.url).origin === self.location.origin;
}

function isDataRequest(url) {
  return DATA_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

function isLiveRequest(url) {
  return LIVE_PATTERNS.some((pattern) => pattern.test(url.pathname));
}

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || refresh;
}


self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isSameOriginGet(request)) return;
  const url = new URL(request.url);
  if (isLiveRequest(url)) return;
  if (request.mode === "navigate" || request.destination === "document" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => caches.match(request, { ignoreSearch: false })));
    return;
  }
  if (url.pathname === "/fuman-sw.js") {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
