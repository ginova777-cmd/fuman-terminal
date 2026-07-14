const CACHE_VERSION = "fuman-terminal-sw-public-terminal-fast-20260630-31";
const RUNTIME_THEME_CSS_LOADER = "terminal-theme-css-snapshot-first-20260619";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const MARKET_OVERVIEW_RESTORE_ASSET_EPOCH = "market-overview-restore-20260627-02";
const WATCHLIST_SHELL_ASSET_EPOCH = "watchlist-rich-shell-20260711-03";
const WATCHLIST_HOTFIX_BRIDGE_EPOCH = "watchlist-bridge=20260628-06";

const STATIC_ASSETS = [
  "/styles.css?v=public-terminal-fast-20260630-31",
  "/terminal-core.js?v=public-terminal-fast-20260630-31&runtime=desktop-fast-shell-core-20260628-03",
  "/terminal-modules.js?v=public-terminal-fast-20260630-31",
  "/terminal-sector-map.js?v=public-terminal-fast-20260630-31",
  "/terminal-strategy-config.js?v=public-terminal-fast-20260630-31",
  "/terminal-market-config.js?v=public-terminal-fast-20260630-31",
  "/terminal-ui-config.js?v=public-terminal-fast-20260630-31",
  "/terminal-runtime-config.js?v=public-terminal-fast-20260630-31",
  "/terminal-tuning-config.js?v=public-terminal-fast-20260630-31",
  "/terminal-worker.js?v=public-terminal-fast-20260630-31",
  "/terminal.js?v=public-terminal-fast-20260630-31",
  "/terminal-app.js?v=public-terminal-fast-20260630-31",
  "/terminal-entitlement-guard.js?v=public-terminal-fast-20260630-31",
  "/terminal-market-ai-live-watchdog.js?v=public-terminal-fast-20260630-31",
  "/terminal-ai-risk-guard.js?v=public-terminal-fast-20260630-31",
  `/terminal-market-overview-restore.css?v=${MARKET_OVERVIEW_RESTORE_ASSET_EPOCH}`,
  `/terminal-market-overview-restore.js?v=${MARKET_OVERVIEW_RESTORE_ASSET_EPOCH}`,
  "/terminal-member-module.js?v=public-terminal-fast-20260630-31",
  "/terminal-market-snapshot-module.js?v=public-terminal-fast-20260630-31",
  "/terminal-strategy-module.js?v=public-terminal-fast-20260630-31",
  "/terminal-watchlist-shell.js?v=watchlist-rich-shell-20260711-03",
  "/terminal-realtime-radar.css?v=radar-ledger-20260630-02",
  "/terminal-watchlist-shell.js?v=public-terminal-fast-20260630-31",
  "/terminal-chip-snapshot-module.js?v=public-terminal-fast-20260630-31",
  "/terminal-chip-flow.js?v=public-terminal-fast-20260630-31",
  "/terminal-warrant-flow.js?v=public-terminal-fast-20260630-31",
  "/terminal-watchlist-module.js?v=public-terminal-fast-20260630-31",
  "/terminal-intraday-radar.css?v=public-terminal-fast-20260630-31",
  "/terminal-utility.css?v=public-terminal-fast-20260630-31",
  "/refresh.html?v=public-terminal-fast-20260630-31",
  "/assets/logo.webp",
  "/favicon.ico",
];

// Legacy static data patterns are cache hygiene only. Formal mobile data must
// come from /api/mobile-boot and /api/mobile-fragment, never from /data/*.json.
const LEGACY_STATIC_DATA_PATTERNS = [
  /\/api\/terminal-fast-bundle/i,
  /\/data\/mobile-boot\.json/i,
  /\/data\/mobile-analysis\/[^/]+\.json/i,
];

const NETWORK_FIRST_DATA_PATTERNS = [];

const PREFETCH_CORE_DATA_ASSETS = [
  "/api/terminal-fast-bundle",
  "/api/mobile-boot",
];

const PREFETCH_LOW_POWER_DATA_ASSETS = [
  "/api/mobile-boot",
];

const PREFETCH_DATA_ASSETS = [
  ...PREFETCH_CORE_DATA_ASSETS,
  "/api/terminal-home",
  "/api/market-ai-live",
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
  /\/api\/mobile-boot/i,
  /\/api\/mobile-fragment/i,
  /\/api\/terminal-home/i,
  /\/api\/market-ai-live/i,
  /\/api\/market-ai-panel-live/i,
  /\/api\/latest-signals/i,
  /\/api\/refresh/i,
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
      .then(() => purgeOldMarketOverviewAssets())
      .then(() => purgeOldWatchlistAssets())
      .then(() => prefetchCoreDataAssets())
      .then(() => self.clients.claim())
  );
});

function isSameOriginGet(request) {
  return request.method === "GET" && new URL(request.url).origin === self.location.origin;
}

function isDataRequest(url) {
  return LEGACY_STATIC_DATA_PATTERNS.some((pattern) => pattern.test(url.pathname));
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

async function purgeOldMarketOverviewAssets() {
  const cache = await caches.open(STATIC_CACHE);
  const requests = await cache.keys();
  await Promise.allSettled(requests.map((request) => {
    const url = new URL(request.url);
    if (!/^\/terminal-market-overview-restore\.(?:js|css)$/i.test(url.pathname)) return undefined;
    if (url.search.includes(MARKET_OVERVIEW_RESTORE_ASSET_EPOCH)) return undefined;
    return cache.delete(request);
  }));
}

async function purgeOldWatchlistAssets() {
  const cache = await caches.open(STATIC_CACHE);
  const requests = await cache.keys();
  await Promise.allSettled(requests.map((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/terminal-watchlist-shell.js" && !url.search.includes(WATCHLIST_SHELL_ASSET_EPOCH) && !url.search.includes("public-terminal-fast-20260630-31")) return cache.delete(request);
    if (url.pathname === "/terminal-hotfix.js" && !url.search.includes(WATCHLIST_HOTFIX_BRIDGE_EPOCH)) return cache.delete(request);
    return undefined;
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
  if (event.data && event.data.type === "CLEAR_MARKET_OVERVIEW_CACHE") event.waitUntil(purgeOldMarketOverviewAssets());
  if (event.data && event.data.type === "CLEAR_WATCHLIST_CACHE") event.waitUntil(purgeOldWatchlistAssets());
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






















