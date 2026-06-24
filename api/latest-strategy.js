const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const ALLOWED_KEYS = new Set(["strategy1", "strategy2", "strategy3", "strategy4", "strategy5"]);
const STRATEGY_HANDLERS = {
  strategy2: () => require("./strategy2-latest"),
  strategy3: () => require("./strategy3-latest"),
  strategy4: () => require("./strategy4-latest"),
  strategy5: () => require("./strategy5-latest"),
};

function createCaptureResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function captureHandlerResponse(handler, request = {}, query = {}) {
  const response = createCaptureResponse();
  const mergedQuery = { ...(request.query || {}), ...query };
  const search = new URLSearchParams(mergedQuery);
  await handler({
    ...request,
    method: "GET",
    url: `/api/latest-strategy?${search.toString()}`,
    query: mergedQuery,
  }, response);
  return response;
}

async function captureHandler(handler, request = {}, query = {}) {
  const response = await captureHandlerResponse(handler, request, query);
  return response.body;
}

function payloadRows(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function payloadCount(payload = {}) {
  const count = Number(payload.count ?? payload.matchCount ?? payload.entryCount);
  return Number.isFinite(count) ? count : payloadRows(payload).length;
}

async function fetchStatusRow(key) {
  const rpcUrl = `${SUPABASE_URL}/rest/v1/rpc/get_latest_strategy_payload?p_strategy_key=${encodeURIComponent(key)}`;
  const rpcResponse = await fetch(rpcUrl, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await rpcResponse.text();
  if (!rpcResponse.ok) throw new Error(`rpc HTTP ${rpcResponse.status} ${text.slice(0, 180)}`.trim());
  const rows = JSON.parse(text);
  return Array.isArray(rows) ? rows[0] : null;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const key = String(request.query?.key || request.query?.strategy || "").trim();
  if (!ALLOWED_KEYS.has(key)) {
    response.status(400).json({ ok: false, error: "invalid_strategy_key", allowed: [...ALLOWED_KEYS] });
    return;
  }

  try {
    if (key === "strategy2") {
      const strategy2Response = await captureHandlerResponse(STRATEGY_HANDLERS.strategy2(), request, {
        live: request.query?.live || "1",
      });
      const strategy2 = strategy2Response.body || {};
      response.status(strategy2Response.statusCode || 200).json({
        ok: strategy2?.ok !== false,
        strategyKey: "strategy2",
        label: "策略2 當沖雷達",
        usedDate: strategy2?.date || "",
        updatedAt: strategy2?.updatedAt || strategy2?.generatedAt || "",
        scanStatus: strategy2?.complete === false ? "incomplete" : "complete",
        scanned: strategy2?.scanned ?? strategy2?.total ?? "",
        total: strategy2?.total ?? strategy2?.totalCount ?? "",
        count: Number(strategy2?.count ?? strategy2?.matchCount ?? payloadCount(strategy2)),
        source: "api/strategy2-latest",
        payload: strategy2,
        transport: {
          source: "supabase",
          gate: strategy2?.transport?.gate || "strategy2-live-handler",
          payloadSource: strategy2?.transport?.source || strategy2?.cacheSource || "",
          payloadGate: strategy2?.transport?.gate || "",
          payloadRunId: strategy2?.transport?.runId || strategy2?.runId || "",
          payloadVia: strategy2?.transport?.via || "api/strategy2-latest",
          live: true,
          fetchedAt: new Date().toISOString(),
        },
      });
      return;
    }
    const row = await fetchStatusRow(key);
    if (!row) {
      response.status(404).json({ ok: false, error: "strategy_not_found", strategyKey: key });
      return;
    }
    let payload = row.payload || null;
    if (!payload && STRATEGY_HANDLERS[key]) {
      payload = await captureHandler(STRATEGY_HANDLERS[key](), request);
    }
    const transport = {
      source: "supabase",
      rpc: "get_latest_strategy_payload",
      gate: "strategy_cache_status",
      fetchedAt: new Date().toISOString(),
    };
    if (payload?.transport) {
      transport.payloadSource = payload.transport.source || payload.cacheSource || "";
      transport.payloadGate = payload.transport.gate || "";
      transport.payloadRunId = payload.transport.runId || payload.runId || "";
      transport.payloadVia = payload.transport.via || "";
    }
    response.status(200).json({
      ok: row.scan_status !== "failed" && payload?.cacheSource !== "static-fallback",
      strategyKey: row.strategy_key,
      label: row.label,
      usedDate: row.used_date,
      updatedAt: row.updated_at,
      scanStatus: row.scan_status,
      scanned: row.scanned,
      total: row.total,
      count: Number(row.match_count ?? payloadCount(payload)),
      source: row.source,
      log: row.log,
      error: row.error,
      payload,
      transport,
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: error?.message || String(error), strategyKey: key });
  }
};
