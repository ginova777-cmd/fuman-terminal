const CACHE_VERSION = "fuman-terminal-sw-desktop-api-only-strategy5-instantpane-20260619-05";
const RUNTIME_THEME_CSS_LOADER = "terminal-theme-css-snapshot-first-20260619";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_ASSETS = [
  "/styles.css?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-core.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-modules.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-sector-map.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-strategy-config.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-market-config.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-ui-config.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-runtime-config.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-tuning-config.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-worker.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-app.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-ai-risk-guard.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-chip-flow.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-warrant-flow.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-watchlist-module.js?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-realtime-radar.css?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-intraday-radar.css?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/terminal-utility.css?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/refresh.html?v=desktop-api-only-strategy5-instantpane-20260619-05",
  "/assets/logo.webp",
  "/favicon.ico",
];

const DATA_PATTERNS = [
  /\/data\/.*summary\.json/i,
  /\/data\/.*-slim\.json/i,
  /\/data\/.*-top\.json/i,
  /\/data\/.*-index\.json/i,
  /\/data\/.*-latest\.json/i,
  /\/data\/mobile-ai-latest\.html/i,
  /\/data\/mobile-ai-lite\.html/i,
  /\/data\/mobile-ai-ultra\.html/i,
  /\/data\/mobile-analysis\/[^/]+\.json/i,
  /\/data\/.*-page-\d+\.json/i,
  /\/data\/market-summary\.json/i,
  /\/data\/mobile-home-summary\.json/i,
  /\/data\/mobile-boot\.json/i,
  /\/data\/terminal-home-bundle\.json/i,
  /\/data\/data-status-index\.json/i,
  /\/data\/data-manifest\.json/i,
  /\/data\/mobile-digest\.json/i,
  /\/data\/mobile-ai-latest\.html/i,
  /\/data\/mobile-ai-lite\.html/i,
  /\/data\/mobile-ai-ultra\.html/i,
  /\/data\/live-freshness-ok\.json/i,
  /\/data\/stocks-slim\.json/i,
  /\/data\/stocks-index\.json/i,
  /\/data\/strategy-match-index\.json/i,
  /\/data\/health-summary\.json/i,
];

const NETWORK_FIRST_DATA_PATTERNS = [
  /\/data\/data-manifest\.json/i,
  /\/data\/data-status-index\.json/i,
  /\/data\/mobile-boot\.json/i,
  /\/data\/mobile-analysis\/[^/]+\.json/i,
  /\/data\/open-buy-latest\.json/i,
];

const PREFETCH_CORE_DATA_ASSETS = [
  "/data/mobile-boot.json",
  "/data/data-manifest.json",
  "/data/mobile-digest.json",
  "/data/mobile-ai-ultra.html",
];

const PREFETCH_LOW_POWER_DATA_ASSETS = [
  "/data/mobile-boot.json",
  "/data/mobile-digest.json",
  "/data/mobile-ai-ultra.html",
];

const PREFETCH_DATA_ASSETS = [
  ...PREFETCH_CORE_DATA_ASSETS,
  "/data/mobile-terminal-latest.json",
  "/data/market-ai-panel-latest.json",
  "/data/market-ai-breadth-latest.json",
  "/data/live-freshness-ok.json",
  "/data/terminal-home-bundle.json",
  "/data/mobile-home-summary.json",
  "/data/market-summary.json",
  "/data/health-summary.json",
  "/data/data-status-index.json",
  "/data/stocks-quotes-mobile-top.json",
];

const LIVE_PATTERNS = [
  /\/api\/realtime/i,
  /\/api\/scan-/i,
  /\/api\/open-buy-latest/i,
  /\/api\/strategy2-latest/i,
  /\/api\/strategy3-latest/i,
  /\/api\/strategy4-latest/i,
  /\/api\/strategy5-latest/i,
  /\/api\/institution-latest/i,
  /\/api\/warrant-flow-latest/i,
  /\/api\/cb-detect-latest/i,
  /\/api\/latest-signals/i,
  /\/api\/refresh/i,
  /\/data\/strategy2-intraday-latest\.json/i,
  /\/data\/realtime-radar-latest\.json/i,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
      .then(() => prefetchCoreDataAssets())
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("fuman-terminal-sw-") && (!key.startsWith(CACHE_VERSION) || key.endsWith("-data")))
        .map((key) => caches.delete(key))))
      .then(() => prefetchCoreDataAssets())
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

function isStrategy4StaticDataRequest(url) {
  return /^\/data\/strategy4(?:-|$).*\.json$/i.test(url.pathname);
}

function isOpenBuyStaticDataRequest(url) {
  return /^\/data\/open-buy(?:-|$).*\.json$/i.test(url.pathname);
}

function isDesktopApiOnlyStaticDataRequest(url) {
  return /^\/data\/(?:strategy2-intraday|strategy3|strategy5|institution|warrant-flow|warrant-priority|warrant-single-signal|cb-detect)(?:-|$).*\.json$/i.test(url.pathname);
}

function strategy4StaticDisabledResponse() {
  return new Response(JSON.stringify({
    ok: false,
    error: "strategy4_static_disabled",
    message: "Strategy4 desktop is API-only. Use /api/strategy4-latest.",
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate, max-age=0",
    },
  });
}

function openBuyStaticDisabledResponse() {
  return new Response(JSON.stringify({
    ok: false,
    error: "open_buy_static_disabled",
    message: "Strategy1 desktop is API-only. Use /api/open-buy-latest.",
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate, max-age=0",
    },
  });
}

function desktopApiOnlyStaticDisabledResponse(pathname) {
  return new Response(JSON.stringify({
    ok: false,
    error: "desktop_static_disabled",
    message: `Desktop terminal is API-only. Static data path is disabled: ${pathname}`,
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate, max-age=0",
    },
  });
}

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
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

async function prefetchDataAssets() {
  return prefetchAssetList(PREFETCH_DATA_ASSETS);
}

async function prefetchCoreDataAssets() {
  return prefetchAssetList(PREFETCH_CORE_DATA_ASSETS);
}

async function prefetchLowPowerDataAssets() {
  return prefetchAssetList(PREFETCH_LOW_POWER_DATA_ASSETS);
}

async function prefetchAssetList(assets) {
  const cache = await caches.open(DATA_CACHE);
  await Promise.allSettled(assets.map(async (pathname) => {
    if (/^\/data\/strategy4(?:-|$).*\.json$/i.test(pathname)) return;
    if (/^\/data\/open-buy(?:-|$).*\.json$/i.test(pathname)) return;
    if (/^\/data\/(?:strategy2-intraday|strategy3|strategy5|institution|warrant-flow|warrant-priority|warrant-single-signal|cb-detect)(?:-|$).*\.json$/i.test(pathname)) return;
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
  if (event.data && event.data.type === "PREFETCH_DATA_LOW_POWER") event.waitUntil(prefetchLowPowerDataAssets());
  if (event.data && event.data.type === "CLEAR_DATA_CACHE") event.waitUntil(caches.delete(DATA_CACHE).then(() => prefetchCoreDataAssets()));
  if (event.data && event.data.type === "CLEAR_DATA_CACHE_LOW_POWER") event.waitUntil(caches.delete(DATA_CACHE).then(() => prefetchLowPowerDataAssets()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isSameOriginGet(request)) return;
  const url = new URL(request.url);
  if (isLiveRequest(url)) return;
  if (isStrategy4StaticDataRequest(url)) {
    event.respondWith(strategy4StaticDisabledResponse());
    return;
  }
  if (isOpenBuyStaticDataRequest(url)) {
    event.respondWith(openBuyStaticDisabledResponse());
    return;
  }
  if (isDesktopApiOnlyStaticDataRequest(url)) {
    event.respondWith(desktopApiOnlyStaticDisabledResponse(url.pathname));
    return;
  }
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
  if (url.pathname === "/terminal-ai-risk-guard.js") {
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



















