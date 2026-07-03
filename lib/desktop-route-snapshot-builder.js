const market = require("../api/market");
const stocks = require("../api/stocks");
const terminalHome = require("../api/terminal-home");
const openBuyLatest = require("../api/open-buy-latest");
const strategy3Latest = require("../api/strategy3-latest");
const strategy4Latest = require("../api/strategy4-latest");
const strategy5Latest = require("../api/strategy5-latest");
const latestSignals = require("../api/latest-signals");
const latestStrategy = require("../api/latest-strategy");
const realtimeRadarLatest = require("../api/realtime-radar-latest");
const heatmap = require("../api/heatmap");
const marketAiLive = require("../api/market-ai-live");
const institutionLatest = require("../api/institution-latest");
const cbDetectLatest = require("../api/cb-detect-latest");
const warrantFlowLatest = require("../api/warrant-flow-latest");
const { readDesktopRouteSnapshot, writeDesktopRouteSnapshot } = require("./desktop-route-snapshot-cache");
const { upsertSnapshot } = require("./supabase-snapshots");
const { buildWatchlistMatchIndex } = require("./watchlist-match-index-builder");

const WATCHLIST_MATCH_INDEX_ENDPOINT = "/api/watchlist-match-index?compact=1&shell=1&limit=80";
const WATCHLIST_WARRANT_COVERAGE_QUERY = { compact: "1", shell: "1", limit: "500", live: "1" };
const SNAPSHOT_WRITE_TIMEOUT_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_WRITE_TIMEOUT_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_WRITE_TIMEOUT_MS || 180000);

function assertWatchlistMatchIndexReady(payload) {
  if (!payload || payload.ok === false) {
    throw new Error("watchlist_match_index_write_blocked:payload_unavailable");
  }
  if (payload.evidenceStatus !== "complete") {
    throw new Error("watchlist_match_index_write_blocked:evidence_incomplete");
  }
  if (payload.unattendedStatus !== "YES") {
    throw new Error("watchlist_match_index_write_blocked:unattended_status_no");
  }
  if (payload.run_quality_at_publish?.publishable !== true) {
    throw new Error("watchlist_match_index_write_blocked:run_quality_degraded");
  }
  if (payload.fallbackUsed) {
    throw new Error("watchlist_match_index_write_blocked:fallback_used");
  }
  if (!payload.strategies?.strategy2) {
    throw new Error("watchlist_match_index_write_blocked:strategy2_source_missing");
  }
  const hasStrategy2Match = Object.values(payload.byCode || {}).some((items) => (
    Array.isArray(items) && items.some((item) => String(item?.key || "").startsWith("strategy2"))
  ));
  if (!hasStrategy2Match) {
    throw new Error("watchlist_match_index_write_blocked:strategy2_matches_missing");
  }
}

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

function liveCompactQuery(limit) {
  return {
    ...compactQuery(limit),
    live: "1",
  };
}

function desktopRouteTasks() {
  return [
    ["/api/terminal-home", terminalHome, { live: "1" }, 18000],
    ["/api/market", market, compactQuery(24), 12000],
    ["/api/stocks", stocks, { limit: "120", compact: "1", shell: "1" }, 22000],
    ["/api/open-buy-latest", openBuyLatest, liveCompactQuery(60), 22000],
    ["/api/strategy3-latest", strategy3Latest, liveCompactQuery(60), 12000],
    ["/api/strategy4-latest", strategy4Latest, liveCompactQuery(70), 12000],
    ["/api/strategy5-latest", strategy5Latest, liveCompactQuery(70), 12000],
    ["/api/latest-strategy?key=strategy2", latestStrategy, { key: "strategy2", compact: "1", shell: "1", limit: "80", live: "1" }, 12000],
    ["/api/latest-signals?strategy=strategy4", latestSignals, { strategy: "strategy4", compact: "1", shell: "1", limit: "70", live: "1" }, 12000],
    ["/api/realtime-radar-latest", realtimeRadarLatest, compactQuery(60), 12000],
    ["/api/heatmap?snapshot=1", heatmap, { snapshot: "1", canvas: "1", compact: "1", shell: "1", limit: "60" }, 12000],
    ["/api/market-ai-live", marketAiLive, { canvas: "1", compact: "1", shell: "1", limit: "40" }, 12000],
    ["/api/institution-latest", institutionLatest, liveCompactQuery(60), 12000],
    ["/api/cb-detect-latest", cbDetectLatest, liveCompactQuery(60), 12000],
    ["/api/warrant-flow-latest", warrantFlowLatest, liveCompactQuery(60), 22000],
  ];
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

function rowsFromPayload(payload) {
  return Array.isArray(payload?.matches) ? payload.matches
    : Array.isArray(payload?.rows) ? payload.rows
      : Array.isArray(payload?.records) ? payload.records
        : Array.isArray(payload?.events) ? payload.events
          : [];
}

function summarize(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, count: 0 };
  const rows = rowsFromPayload(payload);
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
    if (result.payload?.cacheSource === "snapshot-friendly-empty") continue;
    map[endpoint] = result.payload;
  }
  return map;
}

function isSoftSnapshotEndpoint(endpoint) {
  return String(endpoint || "").startsWith("/api/open-buy-latest")
    || String(endpoint || "").startsWith("/api/warrant-flow-latest")
    || String(endpoint || "").startsWith("/api/cb-detect-latest");
}

function isOptionalLiveSnapshotEndpoint(endpoint) {
  return String(endpoint || "").startsWith("/api/realtime-radar-latest")
    || String(endpoint || "").startsWith("/api/heatmap");
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
    if (Number(result.statusCode || 0) >= 400 || result.payload?.ok === false || result.payload?.cacheSource === "snapshot-friendly-empty") {
      endpoints[endpoint] = buildSoftSnapshotFallback(endpoint, result, via);
    }
  }
}

function isMiss(item, endpoints = {}) {
  if (endpoints[item.label]) return false;
  if (isOptionalLiveSnapshotEndpoint(item.label)) return false;
  if (isSoftSnapshotEndpoint(item.label)) {
    return Number(item.statusCode || 0) >= 400
      || item.payload?.ok === false
      || item.payload?.cacheSource === "snapshot-friendly-empty";
  }
  if (item.payload?.cacheSource === "snapshot-friendly-empty") return true;
  return Number(item.statusCode || 0) >= 500 || item.payload?.ok === false;
}

function findEndpointPayload(endpoints, prefix) {
  const entry = Object.entries(endpoints || {}).find(([endpoint]) => String(endpoint || "").startsWith(prefix));
  return {
    endpoint: entry?.[0] || "",
    payload: entry?.[1] && typeof entry[1] === "object" ? entry[1] : null,
  };
}

function rowCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function needsFullWarrantCoverage(payload) {
  if (!payload || typeof payload !== "object" || payload.ok === false) return true;
  const volumeTotal = Number(payload.volumeMatchesTotal ?? payload.volumeCount ?? 0) || 0;
  const singleTotal = Number(payload.singleSignalsTotal ?? payload.singleSignalCount ?? 0) || 0;
  return volumeTotal > rowCount(payload.volumeMatches) || singleTotal > rowCount(payload.singleSignals);
}

async function buildWatchlistSourceEndpoints(endpoints, request) {
  const { endpoint, payload } = findEndpointPayload(endpoints, "/api/warrant-flow-latest");
  if (!needsFullWarrantCoverage(payload)) return endpoints;
  const result = await callJson(
    "/api/warrant-flow-latest",
    warrantFlowLatest,
    request,
    WATCHLIST_WARRANT_COVERAGE_QUERY,
    22000
  );
  if (Number(result.statusCode || 0) >= 400 || result.payload?.ok === false || result.payload?.cacheSource === "snapshot-friendly-empty") {
    return endpoints;
  }
  return {
    ...endpoints,
    [endpoint || buildEndpoint("/api/warrant-flow-latest", compactQuery(60))]: result.payload,
  };
}

async function readPreviousSnapshotPayload() {
  try {
    const previous = await readDesktopRouteSnapshot({
      timeoutMs: 2500,
      allowStale: true,
      maxAgeMs: 2 * 60 * 60 * 1000,
    });
    const payload = previous?.payload && typeof previous.payload === "object" ? previous.payload : null;
    const ageMs = Number(payload?.snapshotAgeMs ?? previous?.payload?.snapshot?.ageMs ?? Infinity);
    if (!payload?.endpoints || !Number.isFinite(ageMs) || ageMs > 2 * 60 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function fillFromPreviousSnapshot(rows, endpoints, previousPayload) {
  const previousEndpoints = previousPayload?.endpoints && typeof previousPayload.endpoints === "object"
    ? previousPayload.endpoints
    : {};
  if (!Object.keys(previousEndpoints).length) return [];
  const filled = [];
  for (const item of rows) {
    if (!isMiss(item, endpoints)) continue;
    const previous = previousEndpoints[item.label];
    if (!previous || typeof previous !== "object" || previous.ok === false) continue;
    if (!isSoftSnapshotEndpoint(item.label) && previous.cacheSource === "snapshot-friendly-empty") continue;
    endpoints[item.label] = {
      ...previous,
      cacheSource: previous.cacheSource || "supabase:desktop_route_snapshot",
      snapshotFallback: true,
      snapshotFallbackReason: item.payload?.error || item.payload?.detail || `status_${item.statusCode || 0}`,
      transport: {
        ...(previous.transport || {}),
        source: previous.transport?.source || "supabase:desktop_route_snapshot",
        fallbackFromPreviousSnapshot: true,
        failedStatusCode: item.statusCode || 0,
        failedEndpoint: item.label,
        fetchedAt: new Date().toISOString(),
      },
    };
    filled.push(item.label);
  }
  return filled;
}

async function runTasksWithConcurrency(tasks, request, concurrency = 3) {
  const safeConcurrency = Math.max(1, Math.min(6, Number(concurrency) || 3));
  const rows = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const [endpoint, handlerFn, query, timeout] = tasks[index];
      rows[index] = await callJson(endpoint, handlerFn, request, query, timeout);
    }
  }
  const workerCount = Math.min(safeConcurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return rows;
}

async function buildDesktopRouteSnapshot(request = {}) {
  const startedAt = Date.now();
  const previousPayload = await readPreviousSnapshotPayload();
  const concurrency = process.env.DESKTOP_ROUTE_SNAPSHOT_CONCURRENCY || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_CONCURRENCY || 2;
  const rows = await runTasksWithConcurrency(desktopRouteTasks(), request, concurrency);
  const results = Object.fromEntries(rows.map((item) => [item.label, item]));
  const endpoints = publicEndpointMap(results);
  const previousFilled = fillFromPreviousSnapshot(rows, endpoints, previousPayload);
  applySoftSnapshotFallbacks(results, endpoints, "lib/desktop-route-snapshot-builder");
  const watchlistSourceEndpoints = await buildWatchlistSourceEndpoints(endpoints, request);
  endpoints[WATCHLIST_MATCH_INDEX_ENDPOINT] = buildWatchlistMatchIndex(watchlistSourceEndpoints, {
    cacheSource: "desktop-route-snapshot-build",
    via: "lib/desktop-route-snapshot-builder",
  });
  const summary = Object.fromEntries(Object.entries(endpoints).map(([endpoint, payload]) => [endpoint, summarize(payload)]));
  const misses = rows
    .filter((item) => isMiss(item, endpoints))
    .map((item) => item.label);
  return {
    ok: true,
    partial: misses.length > 0,
    source: "terminal-fast-bundle",
    cacheSource: "desktop-route-snapshot-build",
    snapshotSource: "desktop_route_snapshot",
    updatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    endpoints,
    summary,
    misses,
    previousFilled,
    timings: Object.fromEntries(rows.map((item) => [item.label, item.elapsedMs || 0])),
  };
}

async function buildAndWriteDesktopRouteSnapshot(request = {}, options = {}) {
  const payload = await buildDesktopRouteSnapshot(request);
  let watchlistPayload = payload.endpoints?.[WATCHLIST_MATCH_INDEX_ENDPOINT];
  let watchlistWrite = null;
  try {
    assertWatchlistMatchIndexReady(watchlistPayload);
  } catch (error) {
    const reason = error?.message || String(error);
    if (payload.endpoints) delete payload.endpoints[WATCHLIST_MATCH_INDEX_ENDPOINT];
    if (payload.summary) delete payload.summary[WATCHLIST_MATCH_INDEX_ENDPOINT];
    payload.watchlistMatchIndexWrite = {
      ok: true,
      skipped: true,
      degraded: true,
      reason,
    };
    watchlistPayload = null;
    watchlistWrite = payload.watchlistMatchIndexWrite;
  }
  if (payload.partial && request?.query?.allowPartial !== "1") {
    const previous = await readPreviousSnapshotPayload();
    if (previous && previous.partial === false && Object.keys(previous.endpoints || {}).length >= Object.keys(payload.endpoints || {}).length) {
      return {
        payload: {
          ...previous,
          staleRefreshSkipped: true,
          skippedPartialRefresh: {
            at: new Date().toISOString(),
            misses: payload.misses || [],
            endpointCount: Object.keys(payload.endpoints || {}).length,
          },
        },
        write: {
          ok: true,
          skipped: true,
          reason: "skip_partial_over_complete_snapshot",
          misses: payload.misses || [],
        },
      };
    }
  }
  const write = await writeDesktopRouteSnapshot(payload, {
    reason: options.reason || "desktop-route-precomputed-bundle",
    timeoutMs: options.timeoutMs || SNAPSHOT_WRITE_TIMEOUT_MS,
  });
  if (watchlistPayload) {
    watchlistWrite = await upsertSnapshot("watchlist_match_index", watchlistPayload, {
      source: "desktop-route-snapshot-build",
      snapshotId: watchlistPayload?.runId || "",
      reason: options.reason || "desktop-route-precomputed-bundle",
      timeoutMs: options.timeoutMs || SNAPSHOT_WRITE_TIMEOUT_MS,
    });
  }
  return { payload, write, watchlistWrite };
}

module.exports = {
  buildDesktopRouteSnapshot,
  buildAndWriteDesktopRouteSnapshot,
  desktopRouteTasks,
  WATCHLIST_MATCH_INDEX_ENDPOINT,
};
