const CACHE_VERSION = "fuman-terminal-sw-20260530-5";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=mobile-market-tabs-20260529",
  "/terminal-core.js?v=speed-modules-20260530-5",
  "/terminal-modules.js?v=speed-modules-20260530-5",
  "/terminal-worker.js?v=speed-modules-20260530-5",
  "/terminal.js?v=speed-modules-20260530-5",
  "/assets/logo.png",
  "/favicon.ico",
];

const DATA_PATTERNS = [
  /\/data\/.*summary\.json/i,
  /\/data\/.*-slim\.json/i,
  /\/data\/market-summary\.json/i,
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isSameOriginGet(request)) return;
  const url = new URL(request.url);
  if (isLiveRequest(url)) return;
  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (["document", "script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
