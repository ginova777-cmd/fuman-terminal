const CACHE_VERSION = "fuman-terminal-sw-split-cb-view-20260609-48";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_ASSETS = [
  "/styles.css?v=split-cb-view-20260609-48",
  "/terminal-core.js?v=split-cb-view-20260609-48",
  "/terminal-modules.js?v=split-cb-view-20260609-48",
  "/terminal-sector-map.js?v=split-cb-view-20260609-48",
  "/terminal-strategy-config.js?v=split-cb-view-20260609-48",
  "/terminal-market-config.js?v=split-cb-view-20260609-48",
  "/terminal-ui-config.js?v=split-cb-view-20260609-48",
  "/terminal-runtime-config.js?v=split-cb-view-20260609-48",
  "/terminal-tuning-config.js?v=split-cb-view-20260609-48",
  "/terminal-worker.js?v=split-cb-view-20260609-48",
  "/terminal.js?v=split-cb-view-20260609-48",
  "/terminal-app.js?v=split-cb-view-20260609-48",
  "/terminal-realtime-radar.css?v=split-cb-view-20260609-48",
  "/terminal-intraday-radar.css?v=split-cb-view-20260609-48",
  "/terminal-utility.css?v=split-cb-view-20260609-48",
  "/refresh.html?v=split-cb-view-20260609-48",
  "/assets/logo.webp",
  "/favicon.ico",
];

const DATA_PATTERNS = [
  /\/data\/.*summary\.json/i,
  /\/data\/.*-slim\.json/i,
  /\/data\/.*-top\.json/i,
  /\/data\/.*-index\.json/i,
  /\/data\/.*-latest\.json/i,
  /\/data\/.*-page-\d+\.json/i,
  /\/data\/market-summary\.json/i,
  /\/data\/mobile-home-summary\.json/i,
  /\/data\/terminal-home-bundle\.json/i,
  /\/data\/data-status-index\.json/i,
  /\/data\/data-manifest\.json/i,
  /\/data\/stocks-slim\.json/i,
  /\/data\/stocks-index\.json/i,
  /\/data\/strategy-match-index\.json/i,
  /\/data\/strategy4-zone-b-page-\d+\.json/i,
  /\/data\/health-summary\.json/i,
];

const NETWORK_FIRST_DATA_PATTERNS = [
  /\/data\/data-manifest\.json/i,
  /\/data\/data-status-index\.json/i,
  /\/data\/open-buy-latest\.json/i,
  /\/data\/strategy4-summary\.json/i,
];

const PREFETCH_DATA_ASSETS = [
  "/data/data-manifest.json",
  "/data/terminal-home-bundle.json",
  "/data/mobile-home-summary.json",
  "/data/market-summary.json",
  "/data/health-summary.json",
  "/data/strategy4-score-top.json",
  "/data/data-status-index.json",
  "/data/stocks-quotes-mobile-top.json",
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
      .then(() => prefetchDataAssets())
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("fuman-terminal-sw-") && (!key.startsWith(CACHE_VERSION) || key.endsWith("-data")))
        .map((key) => caches.delete(key))))
      .then(() => prefetchDataAssets())
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

function isNetworkFirstDataRequest(url) {
  return NETWORK_FIRST_DATA_PATTERNS.some((pattern) => pattern.test(url.pathname));
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

async function prefetchDataAssets() {
  const cache = await caches.open(DATA_CACHE);
  await Promise.allSettled(PREFETCH_DATA_ASSETS.map(async (pathname) => {
    const request = new Request(pathname, { cache: "reload" });
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
  }));
}

async function dataStaleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
        const url = new URL(request.url);
        await cache.put(new Request(url.pathname), response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  return cached || refresh;
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


async function networkFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    throw error;
  }
}


self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "PREFETCH_DATA") event.waitUntil(prefetchDataAssets());
  if (event.data && event.data.type === "CLEAR_DATA_CACHE") event.waitUntil(caches.delete(DATA_CACHE).then(() => prefetchDataAssets()));
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
  if (url.pathname === "/terminal-app.js") {
    event.respondWith(networkFirstStatic(request));
    return;
  }
  if (["script", "style"].includes(request.destination)) {
    event.respondWith(networkFirstStatic(request));
    return;
  }
  if (["image", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }

});












