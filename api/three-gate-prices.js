"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const TABLE = process.env.FUMAN_DAILY_KLINE_TABLE || "strategy4_daily_ohlcv_view";
const MAX_CODES = 300;
const FIBONACCI_RANGE_MULTIPLIER = 1.382;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function code(value) {
  return String(value || "").trim().match(/^\d{4}$/)?.[0] || "";
}

function date(value) {
  const match = String(value || "").match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function codesFromRequest(request) {
  const raw = [request.query?.codes, request.query?.code].filter(Boolean).join(",");
  return [...new Set(raw.split(",").map(code).filter(Boolean))].slice(0, MAX_CODES);
}

function rounded(value) {
  return Math.round(number(value) * 100) / 100;
}

function calculateThreeGate(row) {
  const high = number(row?.high);
  const low = number(row?.low);
  const referenceDate = date(row?.trade_date);
  if (!referenceDate || !(high > 0) || !(low > 0) || high < low) return null;
  const range = high - low;
  return {
    code: code(row?.symbol),
    referenceDate,
    previousHigh: rounded(high),
    previousLow: rounded(low),
    upperGate: rounded(low + range * FIBONACCI_RANGE_MULTIPLIER),
    middleGate: rounded((high + low) / 2),
    lowerGate: rounded(high - range * FIBONACCI_RANGE_MULTIPLIER),
  };
}

module.exports = async (request, response) => {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  const codes = codesFromRequest(request);
  if (!codes.length) {
    response.status(400).json({ ok: false, error: "invalid_stock_codes" });
    return;
  }
  const asOfDate = date(request.query?.asOf || request.query?.tradeDate || request.query?.date);
  const base = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!base || !key) {
    response.status(503).json({ ok: false, error: "three_gate_source_unavailable" });
    return;
  }

  try {
    const url = new URL(`/rest/v1/${encodeURIComponent(TABLE)}`, base);
    url.searchParams.set("select", "symbol,trade_date,high,low");
    url.searchParams.set("symbol", `in.(${codes.join(",")})`);
    if (asOfDate) url.searchParams.set("trade_date", `lt.${asOfDate}`);
    url.searchParams.set("order", "trade_date.desc,symbol.asc");
    url.searchParams.set("limit", String(Math.min(codes.length * 4, 720)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let upstream;
    try {
      upstream = await fetch(url, {
        signal: controller.signal,
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await upstream.text();
    let rows = null;
    try { rows = text ? JSON.parse(text) : null; } catch {}
    if (!upstream.ok || !Array.isArray(rows)) {
      response.status(502).json({ ok: false, error: "three_gate_source_read_failed", detail: String(text || upstream.status).slice(0, 160) });
      return;
    }
    const levelsByCode = new Map();
    for (const row of rows) {
      const level = calculateThreeGate(row);
      if (level && !levelsByCode.has(level.code)) levelsByCode.set(level.code, level);
    }
    const levels = codes.map((item) => levelsByCode.get(item)).filter(Boolean);
    response.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
    response.status(200).json({
      ok: true,
      contract: "terminal-three-gate-prices-v1",
      source: `supabase:${TABLE}`,
      asOfDate,
      multiplier: FIBONACCI_RANGE_MULTIPLIER,
      formula: {
        upperGate: "previous_low + (previous_high - previous_low) * 1.382",
        middleGate: "(previous_high + previous_low) / 2",
        lowerGate: "previous_high - (previous_high - previous_low) * 1.382",
      },
      requestedCount: codes.length,
      count: levels.length,
      missingCodes: codes.filter((item) => !levelsByCode.has(item)),
      levels,
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: "three_gate_fetch_failed", detail: String(error?.message || error).slice(0, 160) });
  }
};

module.exports.calculateThreeGate = calculateThreeGate;