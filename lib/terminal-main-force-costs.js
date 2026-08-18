"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("./server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const VIEW = "v_terminal_main_force_latest";
const MAX_CODES = 300;
const MAIN_FORCE_FETCH_TIMEOUT_MS = 3000;

function normalizeCode(value) {
  return String(value || "").trim().match(/^\d{4}$/)?.[0] || "";
}

function normalizeCodes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map(normalizeCode).filter(Boolean))].slice(0, MAX_CODES);
}

function taipeiDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeTradeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return "";
}

function normalizeAsOfDate(value) {
  return normalizeTradeDate(value) || taipeiDateKey();
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMainForceRow(row, asOfDate) {
  const code = normalizeCode(row?.symbol);
  const tradeDate = String(row?.trade_date || "").slice(0, 10);
  if (!code || tradeDate !== asOfDate) return null;
  const ready = String(row?.status || "") === "ready" && numeric(row?.main_force_cost_price) != null;
  const matchedAnyStyle = Boolean(row?.overnight_matched || row?.short_swing_matched || row?.daytrade_matched);
  const style = (name) => {
    const matched = row?.[`${name}_matched`] === true;
    const cost = numeric(row?.[`${name}_cost_price`]);
    const netBuy = numeric(row?.[`${name}_net_buy`]);
    return {
      matched,
      costPrice: matched ? cost : null,
      netBuy: matched ? netBuy : null,
      status: !ready ? "data_insufficient" : matched ? "matched" : matchedAnyStyle ? "not_matched" : "unclassified",
    };
  };
  return {
    code,
    tradeDate,
    status: ready ? "ready" : "data_insufficient",
    mainForceCostPrice: ready ? numeric(row.main_force_cost_price) : null,
    mainForceNetBuy: ready ? numeric(row.main_force_net_buy) : null,
    mainForceBranchCount: ready ? Number(row.main_force_branch_count || 0) : 0,
    topBranches: Array.isArray(row?.top_branches) ? row.top_branches : [],
    overnight: style("overnight"),
    shortSwing: style("short_swing"),
    daytrade: style("daytrade"),
    source: String(row?.source || `supabase:${VIEW}`),
    updatedAt: row?.updated_at || "",
  };
}

function payloadMainForceRows(payload = {}) {
  const seen = new Set();
  const rows = [];
  [payload.rows, payload.matches, payload.results, payload.records, payload.events, payload.formalEvents, payload.observations, payload.displayCandidates].forEach((collection) => {
    if (!Array.isArray(collection)) return;
    collection.forEach((row) => {
      if (!row || typeof row !== "object" || seen.has(row)) return;
      seen.add(row);
      rows.push(row);
    });
  });
  return rows;
}

function payloadMainForceDate(payload = {}) {
  return normalizeTradeDate(payload.tradeDate || payload.scanDate || payload.usedDate || payload.dataDate || payload.date || payload.sourceDate || "");
}

async function attachMainForceCostsToPayload(payload, { asOf } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const rows = payloadMainForceRows(payload);
  const asOfDate = normalizeTradeDate(asOf) || payloadMainForceDate(payload);
  if (!rows.length || !asOfDate) return payload;
  const codes = [...new Set(rows.map((row) => normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId)).filter(Boolean))];
  if (!codes.length) return payload;
  try {
    const result = await fetchMainForceCosts({ codes, asOf: asOfDate });
    const byCode = new Map((result.items || []).map((item) => [item.code, item]));
    rows.forEach((row) => {
      const code = normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId);
      if (code) row.terminalMainForce = byCode.get(code) || null;
    });
    payload.mainForceCostContract = {
      contract: "terminal-main-force-costs-v1",
      asOfDate,
      count: result.count,
      missingCount: result.missingCodes?.length || 0,
      source: result.source,
    };
  } catch {
    rows.forEach((row) => { row.terminalMainForce = null; });
    payload.mainForceCostContract = {
      contract: "terminal-main-force-costs-v1",
      asOfDate,
      count: 0,
      missingCount: codes.length,
      source: "unavailable",
    };
  }
  return payload;
}
async function fetchMainForceCosts({ codes, asOf, runtimeDir = RUNTIME_DIR, fetchImpl = fetch, timeoutMs = MAIN_FORCE_FETCH_TIMEOUT_MS } = {}) {
  const normalizedCodes = normalizeCodes(codes);
  const asOfDate = normalizeAsOfDate(asOf);
  if (!normalizedCodes.length) {
    return {
      source: `supabase:${VIEW}`,
      asOfDate,
      requestedCount: 0,
      count: 0,
      items: [],
      missingCodes: [],
    };
  }
  const base = terminalSupabaseUrl({ runtimeDir });
  const key = terminalSupabaseKey({ runtimeDir });
  if (!base || !key) {
    const error = new Error("main_force_cost_source_unavailable");
    error.code = "main_force_cost_source_unavailable";
    throw error;
  }
  const url = new URL(`/rest/v1/${VIEW}`, base);
  url.searchParams.set("select", "symbol,trade_date,status,source,main_force_cost_price,main_force_net_buy,main_force_branch_count,overnight_matched,overnight_cost_price,overnight_net_buy,short_swing_matched,short_swing_cost_price,short_swing_net_buy,daytrade_matched,daytrade_cost_price,daytrade_net_buy,top_branches,updated_at");
  url.searchParams.set("symbol", `in.(${normalizedCodes.join(",")})`);
  url.searchParams.set("trade_date", `eq.${asOfDate}`);
  url.searchParams.set("order", "symbol.asc");
  url.searchParams.set("limit", String(normalizedCodes.length));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || MAIN_FORCE_FETCH_TIMEOUT_MS));
  let upstream;
  try {
    upstream = await fetchImpl(url, {
      signal: controller.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await upstream.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!upstream.ok || !Array.isArray(body)) {
    const error = new Error("main_force_cost_source_read_failed");
    error.code = "main_force_cost_source_read_failed";
    error.detail = String(text || upstream.status).slice(0, 160);
    throw error;
  }
  const byCode = new Map();
  for (const row of body) {
    const item = normalizeMainForceRow(row, asOfDate);
    if (item) byCode.set(item.code, item);
  }
  const items = normalizedCodes.map((code) => byCode.get(code)).filter(Boolean);
  return {
    source: `supabase:${VIEW}`,
    asOfDate,
    requestedCount: normalizedCodes.length,
    count: items.length,
    items,
    missingCodes: normalizedCodes.filter((code) => !byCode.has(code)),
  };
}

module.exports = {
  attachMainForceCostsToPayload,
  fetchMainForceCosts,
  normalizeAsOfDate,
  normalizeCode,
  normalizeCodes,
  normalizeMainForceRow,
  normalizeTradeDate,
  payloadMainForceDate,
  payloadMainForceRows,
};