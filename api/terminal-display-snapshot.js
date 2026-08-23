"use strict";

const {
  readDesktopRouteSnapshot,
  readDesktopRouteSnapshotForRoute,
  endpointPayloadFromSnapshot,
} = require("../lib/desktop-route-snapshot-cache");

const ROUTES = Object.freeze({
  strategy2: { label: "當沖雷達", endpoint: "/api/strategy2-latest" },
  strategy3: { label: "隔日沖", endpoint: "/api/strategy3-latest" },
  strategy4: { label: "波段", endpoint: "/api/strategy4-latest" },
  strategy5: { label: "綜合策略", endpoint: "/api/strategy5-latest" },
  institution: { label: "買賣超", endpoint: "/api/institution-latest" },
});

function routeKey(request) {
  const raw = String(request.query?.route || request.query?.strategy || "").trim().toLowerCase();
  if (raw === "intraday" || raw === "daytrade" || raw === "strategy2") return "strategy2";
  if (raw === "strategy3") return "strategy3";
  if (raw === "swing" || raw === "strategy4") return "strategy4";
  if (raw === "combo" || raw === "strategy5") return "strategy5";
  if (raw === "chip" || raw === "chip-trade" || raw === "institution") return "institution";
  return "strategy3";
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizeRow(row, index) {
  return {
    rank: Number(pick(row, ["rank", "sort", "position"], index + 1)) || index + 1,
    code: String(pick(row, ["code", "symbol", "stock_id", "stockId", "ticker"], "--")),
    name: String(pick(row, ["name", "stock_name", "stockName", "shortName"], "")),
    score: pick(row, ["score", "totalScore", "rank_score", "signalScore", "confidence"], "--"),
    price: pick(row, ["close_price", "close", "entry_price", "price", "lastPrice"], "--"),
    reason: String(pick(row, [
      "reason",
      "triggerReason",
      "trigger_reason",
      "aiSummary",
      "summary",
      "signal_type",
      "strategy",
      "matchedReason",
    ], "正式策略命中")),
  };
}

function normalizePayload(route, payload = {}, source = "snapshot") {
  const rows = rowsFromPayload(payload).map(normalizeRow);
  return {
    ok: true,
    contract: "terminal-display-snapshot-v1",
    route,
    label: ROUTES[route]?.label || route,
    source,
    snapshotHit: Boolean(payload.snapshotHit || source.includes("snapshot")),
    snapshotFresh: payload.snapshotFresh !== false,
    tradeDate: payload.tradeDate || payload.trade_date || payload.dataDate || payload.usedDate || payload.expectedTradeDate || "",
    updatedAt: payload.updatedAt || payload.generatedAt || payload.finishedAt || payload.transport?.fetchedAt || new Date().toISOString(),
    runId: payload.runId || payload.run_id || payload.latestRunId || payload.transport?.runId || "",
    count: Number(payload.count ?? payload.total ?? rows.length) || rows.length,
    rows,
  };
}

async function readRoutePayload(route) {
  const endpoint = ROUTES[route]?.endpoint;
  if (!endpoint) return null;

  const routeSnapshot = await readDesktopRouteSnapshotForRoute(route, { timeoutMs: 3500, allowStale: true });
  const routePayload = endpointPayloadFromSnapshot(routeSnapshot?.payload, `${endpoint}?canvas=1&compact=1&shell=1`);
  if (routePayload) return { payload: routePayload, source: "supabase:desktop_route_snapshot:route" };

  const fullSnapshot = await readDesktopRouteSnapshot({ timeoutMs: 3500, allowStale: true });
  const fullPayload = endpointPayloadFromSnapshot(fullSnapshot?.payload, `${endpoint}?canvas=1&compact=1&shell=1`);
  if (fullPayload) return { payload: fullPayload, source: "supabase:desktop_route_snapshot" };

  return null;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const route = routeKey(request);
  const result = await readRoutePayload(route);
  if (!result?.payload) {
    response.status(200).json({
      ok: true,
      contract: "terminal-display-snapshot-v1",
      route,
      label: ROUTES[route]?.label || route,
      source: "snapshot-miss",
      snapshotHit: false,
      snapshotFresh: false,
      updatedAt: new Date().toISOString(),
      count: 0,
      rows: [],
      reason: "terminal_display_snapshot_unavailable",
    });
    return;
  }

  if (request.method === "HEAD") {
    response.status(200).end("");
    return;
  }

  response.status(200).json(normalizePayload(route, result.payload, result.source));
};

module.exports.__test = { normalizePayload, rowsFromPayload, routeKey };
