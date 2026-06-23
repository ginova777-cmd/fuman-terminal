const openBuyLatest = require("./open-buy-latest");
const latestStrategy = require("./latest-strategy");
const strategy3Latest = require("./strategy3-latest");
const strategy4Latest = require("./strategy4-latest");
const strategy5Latest = require("./strategy5-latest");
const institutionLatest = require("./institution-latest");
const warrantFlowLatest = require("./warrant-flow-latest");

function createCaptureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function callJson(handler, request) {
  const capture = createCaptureResponse();
  await handler({ ...request, method: "GET" }, capture);
  return capture.body && typeof capture.body === "object" ? capture.body : { ok: false, error: "empty_api_payload" };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function rowsOf(payload) {
  return Array.isArray(payload?.matches) ? payload.matches
    : Array.isArray(payload?.events) ? payload.events
    : Array.isArray(payload?.records) ? payload.records
    : Array.isArray(payload?.rows) ? payload.rows
    : [];
}

function countOf(payload) {
  const count = Number(payload?.count ?? rowsOf(payload).length);
  return Number.isFinite(count) ? count : 0;
}

function topRows(payload, limit) {
  return rowsOf(payload).slice(0, limit);
}

function institutionRows(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (payload?.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

function warrantTopRows(payload, limit) {
  return (Array.isArray(payload?.matches) ? payload.matches : rowsOf(payload)).slice(0, limit);
}

function normalizeOpenBuyRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = Array.isArray(payload.signals || row.signals) ? (payload.signals || row.signals) : [];
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.close || row.price),
    price: cleanNumber(payload.price || payload.close || row.price || row.close),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
    volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    score: cleanNumber(payload.score || row.score),
    reason: String(payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
    signals,
  };
}

async function fetchOpenBuyLatest(base) {
  return callJson(openBuyLatest, base || {});
}

function buildStatusEntry(payload, source) {
  return {
    ok: payload?.ok !== false,
    status: payload?.status || payload?.qualityStatus || "",
    source: payload?.source || source,
    date: payload?.date || payload?.usedDate || payload?.scanStamp || payload?.generatedDate || "",
    sourceDate: payload?.sourceDate || "",
    updatedAt: payload?.updatedAt || payload?.generatedAt || "",
    count: countOf(payload),
    runId: payload?.runId || payload?.transport?.runId || "",
    gate: payload?.transport?.gate || "",
    cacheSource: payload?.cacheSource || "",
  };
}

function buildHomePayload(base, parts) {
  const now = new Date().toISOString();
  const openBuy = parts.openBuy || {};
  const strategy2 = parts.strategy2 || {};
  const strategy3 = parts.strategy3 || {};
  const strategy4 = parts.strategy4 || {};
  const strategy5 = parts.strategy5 || {};
  const institution = parts.institution || {};
  const warrant = parts.warrant || {};
  const mobile = {};

  mobile.strategy2 = {
    updatedAt: strategy2.updatedAt || strategy2.generatedAt || mobile.strategy2?.updatedAt || "",
    count: countOf(strategy2),
    top: topRows(strategy2, 8),
    runId: strategy2.runId || strategy2.transport?.runId || "",
    gate: strategy2.transport?.gate || "",
  };
  mobile.chip = {
    ...(mobile.chip || {}),
    updatedAt: institution.updatedAt || institution.generatedAt || mobile.chip?.updatedAt || "",
    count: countOf(institution) || institutionRows(institution).length,
    top: institutionRows(institution).slice(0, 8),
    runId: institution.runId || institution.transport?.runId || "",
    gate: institution.transport?.gate || "",
  };
  mobile.warrant = {
    ...(mobile.warrant || {}),
    updatedAt: warrant.updatedAt || warrant.generatedAt || mobile.warrant?.updatedAt || "",
    count: countOf(warrant),
    top: warrantTopRows(warrant, 8),
    runId: warrant.runId || warrant.transport?.runId || "",
    gate: warrant.transport?.gate || "",
  };

  const statusEntries = {
    "institution-latest.json": buildStatusEntry(institution, "supabase:institution_scan_results"),
    "warrant-flow-latest.json": buildStatusEntry(warrant, "supabase:warrant_flow_scan_results"),
    "open-buy-latest.json": buildStatusEntry(openBuy, "supabase:strategy1_open_buy_results"),
    "strategy2-intraday-latest.json": buildStatusEntry(strategy2, "supabase:strategy2_latest"),
    "strategy3-latest.json": buildStatusEntry(strategy3, "supabase:strategy3_scan_results"),
    "strategy4-latest.json": buildStatusEntry(strategy4, "supabase:strategy4_scan_results"),
    "strategy5-latest.json": buildStatusEntry(strategy5, "supabase:strategy5_scan_results"),
  };

  return {
    ok: true,
    source: "terminal-home-sql-gate",
    cacheSource: "supabase-api",
    updatedAt: now,
    mobile,
    status: {
      ok: true,
      source: "terminal-home-sql-gate-status",
      updatedAt: now,
      entries: statusEntries,
    },
    strategies: {
      openBuy: {
        updatedAt: openBuy.updatedAt || openBuy.generatedAt || "",
        date: openBuy.usedDate || openBuy.date || "",
        count: countOf(openBuy),
        top: topRows(openBuy, 12),
        matches: topRows(openBuy, 60),
        runId: openBuy.runId || openBuy.transport?.runId || "",
        gate: openBuy.transport?.gate || "",
      },
      strategy3: {
        updatedAt: strategy3.updatedAt || strategy3.generatedAt || "",
        date: strategy3.usedDate || strategy3.date || "",
        count: countOf(strategy3),
        top: topRows(strategy3, 12),
        runId: strategy3.runId || strategy3.transport?.runId || "",
        gate: strategy3.transport?.gate || "",
      },
      strategy5: {
        updatedAt: strategy5.updatedAt || strategy5.generatedAt || "",
        date: strategy5.generatedDate || strategy5.usedDate || strategy5.date || "",
        sourceDate: strategy5.sourceDate || strategy5.usedDate || "",
        count: countOf(strategy5),
        top: topRows(strategy5, 12),
        runId: strategy5.runId || strategy5.transport?.runId || "",
        gate: strategy5.transport?.gate || "",
      },
      institution: {
        updatedAt: institution.updatedAt || institution.generatedAt || "",
        date: institution.usedDate || institution.date || "",
        count: countOf(institution) || institutionRows(institution).length,
        top: institutionRows(institution).slice(0, 12),
        runId: institution.runId || institution.transport?.runId || "",
        gate: institution.transport?.gate || "",
      },
      warrant: {
        updatedAt: warrant.updatedAt || warrant.generatedAt || "",
        date: warrant.tradeDate || warrant.sourceDate || warrant.usedDate || "",
        count: countOf(warrant),
        top: warrantTopRows(warrant, 12),
        runId: warrant.runId || warrant.transport?.runId || "",
        gate: warrant.transport?.gate || "",
      },
    },
    strategy4: {
      updatedAt: strategy4.updatedAt || strategy4.generatedAt || "",
      date: strategy4.scanStamp || strategy4.date || "",
      count: countOf(strategy4),
      zones: strategy4.zones || {},
      top: topRows(strategy4, 12),
      runId: strategy4.runId || strategy4.transport?.runId || "",
      gate: strategy4.transport?.gate || "",
      complete: strategy4.complete === true,
    },
    transport: {
      source: "supabase",
      via: "api/terminal-home",
      gate: "sql-run-id-complete",
      fetchedAt: now,
      fallbacks: {},
      runIds: {
        institution: institution.runId || institution.transport?.runId || "",
        warrant: warrant.runId || warrant.transport?.runId || "",
        openBuy: openBuy.runId || openBuy.transport?.runId || "",
        strategy2: strategy2.runId || strategy2.transport?.runId || "",
        strategy3: strategy3.runId || strategy3.transport?.runId || "",
        strategy4: strategy4.runId || strategy4.transport?.runId || "",
        strategy5: strategy5.runId || strategy5.transport?.runId || "",
      },
    },
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const [openBuy, strategy2, strategy3, strategy4, strategy5, institution, warrant] = await Promise.all([
      fetchOpenBuyLatest(),
      callJson(latestStrategy, { ...request, query: { key: strategy2 } }),
      callJson(strategy3Latest, request),
      callJson(strategy4Latest, request),
      callJson(strategy5Latest, request),
      callJson(institutionLatest, request),
      callJson(warrantFlowLatest, request),
    ]);
    response.status(200).json(buildHomePayload(null, { openBuy, strategy2, strategy3, strategy4, strategy5, institution, warrant }));
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: "terminal_home_api_only_unavailable",
      reason: error?.message || String(error),
      cacheSource: "none",
      strategies: {},
      status: { ok: false, entries: {} },
      transport: {
        source: "none",
        via: "api/terminal-home",
        gate: "api-only-no-static-fallback",
        fetchedAt: new Date().toISOString(),
      },
    });
  }
};


