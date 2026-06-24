const market = require("./market");
const stocks = require("./stocks");
const terminalHome = require("./terminal-home");
const openBuyLatest = require("./open-buy-latest");
const strategy3Latest = require("./strategy3-latest");
const strategy4Latest = require("./strategy4-latest");
const strategy5Latest = require("./strategy5-latest");
const latestSignals = require("./latest-signals");
const realtimeRadarLatest = require("./realtime-radar-latest");
const institutionLatest = require("./institution-latest");
const cbDetectLatest = require("./cb-detect-latest");
const warrantFlowLatest = require("./warrant-flow-latest");
const { readDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { buildWatchlistMatchIndex } = require("../lib/watchlist-match-index-builder");

function createCaptureResponse(resolve, label) {
  let settled = false;
  const done = (statusCode, payload, headers = {}) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload, headers, label });
  };
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload, this.headers);
      return this;
    },
  };
}

function buildEndpoint(label, query = {}) {
  const url = new URL(label, "https://fuman.local");
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
}

function compactQuery(limit) {
  return {
    canvas: "1",
    compact: "1",
    shell: "1",
    limit: String(limit),
  };
}

function callJson(label, handler, request, query = {}, timeoutMs = 5500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const endpoint = buildEndpoint(label, query);
    const endpointUrl = new URL(endpoint, "https://fuman.local");
    const mergedQuery = {
      ...(request.query || {}),
      ...Object.fromEntries(endpointUrl.searchParams.entries()),
      fastBundle: "1",
      snapshotBuild: "1",
    };
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: {
          ok: false,
          error: "fast_bundle_timeout",
          endpoint,
          timeoutMs,
        },
        headers: {},
        label: endpoint,
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    };
    const capture = createCaptureResponse(finish, endpoint);
    const req = {
      ...request,
      method: "GET",
      url: buildEndpoint(endpoint, { fastBundle: "1", snapshotBuild: "1" }),
      query: mergedQuery,
    };
    Promise.resolve(handler(req, capture)).catch((error) => {
      finish({
        statusCode: 500,
        payload: {
          ok: false,
          error: "fast_bundle_handler_failed",
          endpoint,
          message: error?.message || String(error),
        },
        headers: {},
        label: endpoint,
      });
    });
  });
}

function summarize(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, count: 0 };
  const rows = Array.isArray(payload.matches) ? payload.matches
    : Array.isArray(payload.rows) ? payload.rows
      : Array.isArray(payload.records) ? payload.records
        : Array.isArray(payload.events) ? payload.events
          : [];
  return {
    ok: payload.ok !== false,
    count: Number(payload.count ?? payload.total ?? rows.length) || 0,
    runId: payload.runId || payload.transport?.runId || "",
    updatedAt: payload.updatedAt || payload.generatedAt || payload.finishedAt || "",
    source: payload.source || payload.cacheSource || payload.transport?.source || "",
  };
}

function publicEndpointMap(results) {
  const map = {};
  for (const [endpoint, result] of Object.entries(results)) {
    if (Number(result.statusCode || 0) >= 500) continue;
    if (result.payload && typeof result.payload === "object" && result.payload.ok === false) continue;
    map[endpoint] = result.payload;
  }
  return map;
}

function isSoftSnapshotEndpoint(endpoint) {
  return String(endpoint || "").startsWith("/api/open-buy-latest")
    || String(endpoint || "").startsWith("/api/warrant-flow-latest")
    || String(endpoint || "").startsWith("/api/cb-detect-latest");
}

function buildSoftSnapshotFallback(endpoint, result, via) {
  const isOpenBuy = String(endpoint || "").startsWith("/api/open-buy-latest");
  const isWarrant = String(endpoint || "").startsWith("/api/warrant-flow-latest");
  const source = isOpenBuy
    ? "supabase:strategy1_open_buy_results"
    : isWarrant
      ? "supabase:warrant_flow_scan_results"
      : "supabase:cb_detect_cache";
  const reason = result?.payload?.detail
    || result?.payload?.error
    || result?.payload?.reason
    || "snapshot-soft-fallback";
  return {
    ok: true,
    source,
    cacheSource: "snapshot-soft-fallback",
    complete: false,
    qualityStatus: "waiting_snapshot",
    runId: "",
    usedDate: "",
    tradeDate: "",
    sourceDate: "",
    count: 0,
    returnedCount: 0,
    rows: [],
    matches: [],
    volumeMatches: [],
    singleSignals: [],
    updatedAt: new Date().toISOString(),
    reason,
    transport: {
      source: "fast-bundle",
      gate: "snapshot-soft-fallback",
      endpoint,
      originalStatusCode: result?.statusCode || 0,
      via,
      fetchedAt: new Date().toISOString(),
    },
  };
}

function applySoftSnapshotFallbacks(results, endpoints, via) {
  for (const [endpoint, result] of Object.entries(results)) {
    if (endpoints[endpoint] || !isSoftSnapshotEndpoint(endpoint)) continue;
    if (Number(result.statusCode || 0) >= 400 || result.payload?.ok === false) {
      endpoints[endpoint] = buildSoftSnapshotFallback(endpoint, result, via);
    }
  }
}

function isMiss(item) {
  if (isSoftSnapshotEndpoint(item.label)) return false;
  return Number(item.statusCode || 0) >= 500 || item.payload?.ok === false;
}

function liveFallbackEnabled(request) {
  if (request.query?.allowLiveFallback === "1") return true;
  return process.env.DESKTOP_FAST_BUNDLE_ALLOW_LIVE_FALLBACK === "1"
    || process.env.FUMAN_DESKTOP_FAST_BUNDLE_ALLOW_LIVE_FALLBACK === "1";
}

function snapshotMissPayload(reason = "snapshot_missing_or_stale") {
  const updatedAt = new Date().toISOString();
  return {
    ok: true,
    partial: true,
    source: "terminal-fast-bundle",
    cacheSource: "snapshot-only-miss",
    snapshotOnly: true,
    snapshotHit: false,
    snapshotFresh: false,
    reason,
    updatedAt,
    elapsedMs: 0,
    endpoints: {},
    summary: {},
    misses: ["desktop_route_snapshot"],
    timings: {},
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "public, max-age=3, stale-while-revalidate=12");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=3, stale-while-revalidate=12");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const wantsLive = request.query?.live === "1"
    || request.query?.refresh === "1"
    || request.query?.force === "1";
  if (!wantsLive) {
    const snapshot = await readDesktopRouteSnapshot({ timeoutMs: 3000 });
    if (snapshot?.payload?.endpoints) {
      const payload = {
        ...snapshot.payload,
        ok: snapshot.payload.ok !== false,
        source: "terminal-fast-bundle",
        cacheSource: "supabase:desktop_route_snapshot",
        partial: Boolean(snapshot.payload.partial),
        misses: Array.isArray(snapshot.payload.misses) ? snapshot.payload.misses : [],
        snapshotHit: true,
      };
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      response.status(200).json(payload);
      return;
    }
    if (!liveFallbackEnabled(request)) {
      response.setHeader("X-Fuman-Fast-Bundle-Mode", "snapshot-only");
      if (request.method === "HEAD") {
        response.status(204).end("");
        return;
      }
      response.status(200).json(snapshotMissPayload());
      return;
    }
  }

  const startedAt = Date.now();
  const tasks = [
    ["/api/terminal-home", terminalHome, {}, 3000],
    ["/api/market", market, compactQuery(24), 4200],
    ["/api/stocks", stocks, { limit: "120", compact: "1", shell: "1" }, 3000],
    ["/api/open-buy-latest", openBuyLatest, compactQuery(60), 2300],
    ["/api/strategy3-latest", strategy3Latest, compactQuery(60), 2300],
    ["/api/strategy4-latest", strategy4Latest, compactQuery(70), 2500],
    ["/api/strategy5-latest", strategy5Latest, compactQuery(70), 2300],
    ["/api/latest-signals?strategy=strategy4", latestSignals, { strategy: "strategy4", compact: "1", shell: "1", limit: "70" }, 2300],
    ["/api/realtime-radar-latest", realtimeRadarLatest, { compact: "1", shell: "1", limit: "50" }, 2100],
    ["/api/institution-latest", institutionLatest, compactQuery(60), 2200],
    ["/api/cb-detect-latest", cbDetectLatest, compactQuery(60), 2200],
    ["/api/warrant-flow-latest", warrantFlowLatest, compactQuery(60), 7000],
  ];

  const rows = await Promise.all(tasks.map(([endpoint, handlerFn, query, timeout]) => (
    callJson(endpoint, handlerFn, request, query, timeout)
  )));
  const results = Object.fromEntries(rows.map((item) => [item.label, item]));
  const endpoints = publicEndpointMap(results);
  applySoftSnapshotFallbacks(results, endpoints, "api/terminal-fast-bundle");
  endpoints["/api/watchlist-match-index?compact=1&shell=1&limit=80"] = buildWatchlistMatchIndex(endpoints, {
    cacheSource: "api/terminal-fast-bundle",
    via: "api/terminal-fast-bundle",
  });
  const summary = Object.fromEntries(Object.entries(endpoints).map(([endpoint, payload]) => [endpoint, summarize(payload)]));
  const elapsedMs = Date.now() - startedAt;
  const misses = rows
    .filter(isMiss)
    .map((item) => item.label);
  const payload = {
    ok: true,
    partial: misses.length > 0,
    source: "terminal-fast-bundle",
    cacheSource: "api/terminal-fast-bundle",
    updatedAt: new Date().toISOString(),
    elapsedMs,
    endpoints,
    summary,
    misses,
    timings: Object.fromEntries(rows.map((item) => [item.label, item.elapsedMs || 0])),
  };

  if (request.method === "HEAD") {
    response.status(200).end("");
    return;
  }
  response.status(200).json(payload);
};
