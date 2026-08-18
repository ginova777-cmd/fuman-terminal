"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("./server-supabase-key");
const { normalizeCode, normalizeCodes, normalizeTradeDate, payloadMainForceRows } = require("./terminal-main-force-costs");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const TABLE = process.env.FUMAN_DAILY_KLINE_TABLE || "strategy4_daily_ohlcv_view";
const FIBONACCI_RANGE_MULTIPLIER = 1.382;

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function rounded(value) { return Math.round(number(value) * 100) / 100; }
function calculateThreeGate(row) {
  const previousHigh = number(row?.high), previousLow = number(row?.low), referenceDate = normalizeTradeDate(row?.trade_date), code = normalizeCode(row?.symbol);
  if (!code || !referenceDate || !(previousHigh > 0) || !(previousLow > 0) || previousHigh < previousLow) return null;
  const range = previousHigh - previousLow;
  return { code, referenceDate, previousHigh: rounded(previousHigh), previousLow: rounded(previousLow), upperGate: rounded(previousLow + range * FIBONACCI_RANGE_MULTIPLIER), middleGate: rounded((previousHigh + previousLow) / 2), lowerGate: rounded(previousHigh - range * FIBONACCI_RANGE_MULTIPLIER), source: `supabase:${TABLE}` };
}
function payloadThreeGateDate(payload = {}) { return normalizeTradeDate(payload.tradeDate || payload.scanDate || payload.usedDate || payload.dataDate || payload.date || payload.sourceDate || ""); }
async function fetchThreeGatePrices({ codes, asOf, runtimeDir = RUNTIME_DIR, fetchImpl = fetch } = {}) {
  const normalizedCodes = normalizeCodes(codes), asOfDate = normalizeTradeDate(asOf);
  if (!normalizedCodes.length || !asOfDate) return { source: `supabase:${TABLE}`, asOfDate, requestedCount: normalizedCodes.length, count: 0, levels: [], missingCodes: normalizedCodes };
  const base = terminalSupabaseUrl({ runtimeDir }), key = terminalSupabaseKey({ runtimeDir });
  if (!base || !key) { const error = new Error("three_gate_source_unavailable"); error.code = "three_gate_source_unavailable"; throw error; }
  const url = new URL(`/rest/v1/${encodeURIComponent(TABLE)}`, base);
  url.searchParams.set("select", "symbol,trade_date,high,low"); url.searchParams.set("symbol", `in.(${normalizedCodes.join(",")})`); url.searchParams.set("trade_date", `lt.${asOfDate}`); url.searchParams.set("order", "trade_date.desc,symbol.asc"); url.searchParams.set("limit", String(Math.min(normalizedCodes.length * 4, 720)));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000); let upstream;
  try { upstream = await fetchImpl(url, { signal: controller.signal, headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }); } finally { clearTimeout(timer); }
  const text = await upstream.text(); let rows = null; try { rows = text ? JSON.parse(text) : null; } catch {}
  if (!upstream.ok || !Array.isArray(rows)) { const error = new Error("three_gate_source_read_failed"); error.code = "three_gate_source_read_failed"; error.detail = String(text || upstream.status).slice(0, 160); throw error; }
  const byCode = new Map(); for (const row of rows) { const level = calculateThreeGate(row); if (level && level.referenceDate < asOfDate && !byCode.has(level.code)) byCode.set(level.code, level); }
  const levels = normalizedCodes.map((code) => byCode.get(code)).filter(Boolean);
  return { source: `supabase:${TABLE}`, asOfDate, requestedCount: normalizedCodes.length, count: levels.length, levels, missingCodes: normalizedCodes.filter((code) => !byCode.has(code)) };
}
async function attachThreeGatePricesToPayload(payload, { asOf } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const rows = payloadMainForceRows(payload), asOfDate = normalizeTradeDate(asOf) || payloadThreeGateDate(payload);
  if (!rows.length || !asOfDate) return payload;
  const codes = [...new Set(rows.map((row) => normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId)).filter(Boolean))]; if (!codes.length) return payload;
  try { const result = await fetchThreeGatePrices({ codes, asOf: asOfDate }), byCode = new Map(result.levels.map((item) => [item.code, item])); rows.forEach((row) => { const code = normalizeCode(row?.code || row?.symbol || row?.stock_id || row?.stockId); if (code) row.terminalThreeGate = byCode.get(code) || null; }); payload.threeGatePriceContract = { contract: "terminal-three-gate-prices-v1", asOfDate, count: result.count, missingCount: result.missingCodes.length, source: result.source, freshnessRule: "previous_formal_daily_ohlcv_only; reference_date_must_be_before_as_of_date" }; }
  catch { rows.forEach((row) => { row.terminalThreeGate = null; }); payload.threeGatePriceContract = { contract: "terminal-three-gate-prices-v1", asOfDate, count: 0, missingCount: codes.length, source: "unavailable", freshnessRule: "previous_formal_daily_ohlcv_only; reference_date_must_be_before_as_of_date" }; }
  return payload;
}
module.exports = { FIBONACCI_RANGE_MULTIPLIER, attachThreeGatePricesToPayload, calculateThreeGate, fetchThreeGatePrices, payloadThreeGateDate };