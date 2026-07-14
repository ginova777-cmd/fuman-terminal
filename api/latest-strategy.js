const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { attachRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const ALLOWED_KEYS = new Set(["strategy2", "strategy3", "strategy4", "strategy5"]);
const DIRECT_AUTHORITATIVE_KEYS = new Set(["strategy2"]);
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

function queryUrl(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `/api/latest-strategy${search ? `?${search}` : ""}`;
}

async function captureHandler(handler, request = {}, query = {}) {
  const response = createCaptureResponse();
  await handler({
    method: "GET",
    headers: request.headers || {},
    fumanInternalVerify: request.fumanInternalVerify === true,
    query,
    url: queryUrl(query),
  }, response);
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

async function fetchDirectPayload(key, request) {
  if (!STRATEGY_HANDLERS[key]) return null;
  return captureHandler(STRATEGY_HANDLERS[key](), request, request.query || {});
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
    const directPayload = DIRECT_AUTHORITATIVE_KEYS.has(key) ? await fetchDirectPayload(key, request) : null;
    let row = null;
    try {
      row = await fetchStatusRow(key);
    } catch (error) {
      if (!directPayload) throw error;
    }
    if (!row && !directPayload) {
      response.status(404).json({ ok: false, error: "strategy_not_found", strategyKey: key });
      return;
    }
    let payload = directPayload || row?.payload || null;
    if (!payload && STRATEGY_HANDLERS[key]) {
      payload = await fetchDirectPayload(key, request);
    }
    const payloadRunId = payload?.runId || payload?.transport?.runId || "";
    const payloadUpdatedAt = payload?.updatedAt || payload?.generatedAt || "";
    const payloadDate = payload?.date || payload?.usedDate || "";
    const transport = {
      source: DIRECT_AUTHORITATIVE_KEYS.has(key) ? "supabase-direct" : "supabase",
      rpc: row ? "get_latest_strategy_payload" : "",
      gate: DIRECT_AUTHORITATIVE_KEYS.has(key) ? "direct-latest-run" : "strategy_cache_status",
      fetchedAt: new Date().toISOString(),
    };
    if (payload?.transport) {
      transport.payloadSource = payload.transport.source || payload.cacheSource || "";
      transport.payloadGate = payload.transport.gate || "";
      transport.payloadRunId = payloadRunId;
      transport.payloadVia = payload.transport.via || "";
    }
    const body = {
      ok: row?.scan_status !== "failed" && payload?.cacheSource !== "static-fallback" && payload?.ok !== false,
      strategyKey: row?.strategy_key || key,
      label: row?.label || key,
      usedDate: payloadDate || row?.used_date || "",
      updatedAt: payloadUpdatedAt || row?.updated_at || "",
      scanStatus: row?.scan_status || (payload?.ok === false ? "failed" : "complete"),
      scanned: Number(payload?.scanned ?? row?.scanned ?? 0),
      total: Number(payload?.total ?? row?.total ?? 0),
      count: Number(payload?.count ?? row?.match_count ?? payloadCount(payload)),
      source: DIRECT_AUTHORITATIVE_KEYS.has(key) ? (payload?.cacheSource || "supabase-direct") : row?.source,
      log: row?.log || "",
      error: payload?.error || row?.error || "",
      runId: payloadRunId,
      date: payloadDate,
      complete: payload?.complete === true,
      qualityStatus: payload?.qualityStatus || "",
      cacheSource: payload?.cacheSource || "",
      payload,
      transport,
    };
    response.status(200).json(attachRunTimeSourceEvidence(body));
  } catch (error) {
    response.status(502).json({ ok: false, error: error?.message || String(error), strategyKey: key });
  }
};
