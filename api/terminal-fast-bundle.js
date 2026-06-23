const market = require("./market");
const stocks = require("./stocks");
const terminalHome = require("./terminal-home");
const watchlistMatchIndex = require("./watchlist-match-index");
const openBuyLatest = require("./open-buy-latest");
const strategy2Latest = require("./strategy2-latest");
const strategy3Latest = require("./strategy3-latest");
const strategy4Latest = require("./strategy4-latest");
const strategy5Latest = require("./strategy5-latest");
const latestSignals = require("./latest-signals");
const realtimeRadarLatest = require("./realtime-radar-latest");
const institutionLatest = require("./institution-latest");
const cbDetectLatest = require("./cb-detect-latest");
const warrantFlowLatest = require("./warrant-flow-latest");

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

function callJson(label, handler, request, query = {}, timeoutMs = 5500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: {
          ok: false,
          error: "fast_bundle_timeout",
          endpoint: label,
          timeoutMs,
        },
        headers: {},
        label,
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    };
    const capture = createCaptureResponse(finish, label);
    const req = {
      ...request,
      method: "GET",
      query: {
        ...(request.query || {}),
        ...query,
        fastBundle: "1",
      },
    };
    Promise.resolve(handler(req, capture)).catch((error) => {
      finish({
        statusCode: 500,
        payload: {
          ok: false,
          error: "fast_bundle_handler_failed",
          endpoint: label,
          message: error?.message || String(error),
        },
        headers: {},
        label,
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

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "public, max-age=3, stale-while-revalidate=12");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=3, stale-while-revalidate=12");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const startedAt = Date.now();
  const tasks = [
    ["/api/terminal-home", terminalHome, {}, 2600],
    ["/api/market", market, {}, 2200],
    ["/api/stocks", stocks, {}, 2400],
    ["/api/watchlist-match-index", watchlistMatchIndex, {}, 2400],
    ["/api/open-buy-latest", openBuyLatest, {}, 2600],
    ["/api/strategy2-latest", strategy2Latest, {}, 2600],
    ["/api/strategy3-latest", strategy3Latest, {}, 2600],
    ["/api/strategy4-latest", strategy4Latest, {}, 2800],
    ["/api/strategy5-latest", strategy5Latest, {}, 2600],
    ["/api/latest-signals?strategy=strategy4", latestSignals, { strategy: "strategy4" }, 2600],
    ["/api/realtime-radar-latest", realtimeRadarLatest, {}, 2200],
    ["/api/institution-latest", institutionLatest, {}, 2400],
    ["/api/cb-detect-latest", cbDetectLatest, {}, 2400],
    ["/api/warrant-flow-latest", warrantFlowLatest, {}, 2800],
  ];

  const rows = await Promise.all(tasks.map(([endpoint, handlerFn, query, timeout]) => (
    callJson(endpoint, handlerFn, request, query, timeout)
  )));
  const results = Object.fromEntries(rows.map((item) => [item.label, item]));
  const endpoints = publicEndpointMap(results);
  const summary = Object.fromEntries(Object.entries(endpoints).map(([endpoint, payload]) => [endpoint, summarize(payload)]));
  const elapsedMs = Date.now() - startedAt;
  const misses = rows
    .filter((item) => Number(item.statusCode || 0) >= 500 || item.payload?.ok === false)
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
