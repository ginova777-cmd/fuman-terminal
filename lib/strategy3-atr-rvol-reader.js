"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("./server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DAILY_TABLE = process.env.STRATEGY3_DAILY_OHLCV_TABLE || "strategy4_daily_ohlcv_view";
const INTRADAY_TABLE = process.env.STRATEGY3_INTRADAY_1M_TABLE || "fugle_daytrade_intraday_1m";
const ATR_PERIOD = 14;
const RVOL_SESSIONS = 5;
const MIN_RVOL_SESSIONS = 2;
const SESSION_END_MINUTE = 13 * 60;
const TAIL_START_MINUTE = 12 * 60 + 45;

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function round(value, digits = 4) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }
function dateDaysAgo(tradeDate, days) { const value = new Date(`${tradeDate}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - days); return value.toISOString().slice(0, 10); }
function taipeiParts(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function volumeBetween(rows, start, end) {
  return rows.filter((row) => row.minute >= start && row.minute <= end).reduce((sum, row) => sum + (number(row.volume) || 0), 0);
}

function calculateAtrRvolEvidence({ dailyRows = [], intradayRows = [], tradeDate, poolRow = {} }) {
  const usable = intradayRows.filter((row) => row?.synthetic !== true && row?.volume_strategy_usable !== false).map((row) => {
    const parts = taipeiParts(row?.candle_time);
    return parts ? { ...row, date: parts.date, minute: parts.minute } : null;
  }).filter(Boolean);
  const byDate = new Map();
  for (const row of usable) { const list = byDate.get(row.date) || []; list.push(row); byDate.set(row.date, list); }
  const historicalDates = [...byDate.keys()].filter((date) => date < tradeDate).sort().slice(-RVOL_SESSIONS);
  const todayRows = byDate.get(tradeDate) || [];
  const sessionVolume = volumeBetween(todayRows, 9 * 60, SESSION_END_MINUTE);
  const tailVolume = volumeBetween(todayRows, TAIL_START_MINUTE, SESSION_END_MINUTE);
  const historicalSessionVolumes = historicalDates.map((date) => volumeBetween(byDate.get(date) || [], 9 * 60, SESSION_END_MINUTE));
  const historicalTailVolumes = historicalDates.map((date) => volumeBetween(byDate.get(date) || [], TAIL_START_MINUTE, SESSION_END_MINUTE));
  const sessionBase = mean(historicalSessionVolumes);
  const tailBase = mean(historicalTailVolumes);

  const history = dailyRows.map((row) => ({
    date: String(row?.trade_date || "").slice(0, 10), open: number(row?.open), high: number(row?.high), low: number(row?.low), close: number(row?.close),
  })).filter((row) => row.date && row.date < tradeDate && [row.open, row.high, row.low, row.close].every(Number.isFinite)).sort((a, b) => a.date.localeCompare(b.date));
  const trueRanges = history.map((row, index) => {
    if (index === 0) return null;
    const previousClose = history[index - 1].close;
    return Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
  }).filter(Number.isFinite).slice(-ATR_PERIOD);
  const atr14 = trueRanges.length === ATR_PERIOD ? mean(trueRanges) : null;
  const open = number(poolRow.open_price);
  const high = number(poolRow.high_price);
  const low = number(poolRow.low_price);
  const close = number(poolRow.price);
  const previousClose = number(poolRow.previous_close);
  const currentTrueRange = [high, low, previousClose].every(Number.isFinite)
    ? Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)) : null;
  const closeLocation = [high, low, close].every(Number.isFinite) && high > low ? (close - low) / (high - low) : null;
  const sessionRvol = sessionBase > 0 ? sessionVolume / sessionBase : null;
  const tailRvol = tailBase > 0 ? tailVolume / tailBase : null;
  const trAtrRatio = atr14 > 0 && Number.isFinite(currentTrueRange) ? currentTrueRange / atr14 : null;
  const rvolHistoryReady = historicalDates.length >= MIN_RVOL_SESSIONS;
  const historyReady = rvolHistoryReady && trueRanges.length === ATR_PERIOD;
  const baselineConfidence = historicalDates.length >= RVOL_SESSIONS ? "standard" : rvolHistoryReady ? "low_sample" : "insufficient";
  const checks = {
    rvol_history_min_2_sessions: rvolHistoryReady,
    atr_history_14_periods: trueRanges.length === ATR_PERIOD,
    close_location_ge_075: closeLocation >= 0.75,
    session_rvol_ge_15: sessionRvol >= 1.5,
    tail_rvol_ge_15: tailRvol >= 1.5,
    tr_atr_ratio_08_22: trAtrRatio >= 0.8 && trAtrRatio <= 2.2,
  };
  return {
    ok: historyReady && Object.values(checks).every(Boolean), source_ready: historyReady,
    reason: !historyReady ? "atr_rvol_history_data_gap" : Object.values(checks).every(Boolean) ? "" : "atr_rvol_tail_momentum_not_confirmed",
    atr14: round(atr14), current_true_range: round(currentTrueRange), tr_atr_ratio: round(trAtrRatio),
    close_location: round(closeLocation), session_volume_to_1300: sessionVolume, session_rvol_5d: round(sessionRvol),
    tail_volume_1245_1300: tailVolume, tail_rvol_5d: round(tailRvol), comparable_history_dates: historicalDates,
    rvol_baseline_session_count: historicalDates.length, rvol_baseline_confidence: baselineConfidence,
    checks, formula: "close_location>=0.75;session_RVOL_baseline>=1.5;tail_RVOL_baseline>=1.5;0.8<=TR/ATR14<=2.2;RVOL_history_sessions>=2",
    sources: { intraday: `supabase:${INTRADAY_TABLE}:same_time_1m`, daily: `supabase:${DAILY_TABLE}:ATR14` },
  };
}

async function restRows(url, key, table, params, timeout = 45000) {
  const target = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params || {})) target.searchParams.set(name, String(value));
  const response = await fetch(target, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}_http_${response.status}:${text.slice(0, 180)}`);
  const parsed = JSON.parse(text || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function mapConcurrent(values, limit, callback) {
  const output = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (cursor < values.length) { const index = cursor++; output[index] = await callback(values[index]); } }));
  return output;
}

async function readStrategy3AtrRvol({ symbols, tradeDate, poolBySymbol }) {
  const url = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!url || !key) throw new Error("strategy3_atr_rvol_source_credentials_missing");
  const pairs = await mapConcurrent(symbols, 4, async (symbol) => {
    try {
      const [dailyRows, intradayRowsDesc] = await Promise.all([
        restRows(url, key, DAILY_TABLE, { select: "symbol,trade_date,open,high,low,close", symbol: `eq.${symbol}`, trade_date: `gte.${dateDaysAgo(tradeDate, 60)}`, order: "trade_date.asc", limit: 60 }),
        restRows(url, key, INTRADAY_TABLE, { select: "symbol,trade_date,candle_time,volume,synthetic,volume_strategy_usable", symbol: `eq.${symbol}`, trade_date: `gte.${dateDaysAgo(tradeDate, 28)}`, order: "candle_time.desc", limit: 5000 }, 60000),
      ]);
      return [symbol, calculateAtrRvolEvidence({ dailyRows, intradayRows: intradayRowsDesc.reverse(), tradeDate, poolRow: poolBySymbol.get(symbol) || {} })];
    } catch (error) {
      return [symbol, { ok: false, source_ready: false, reason: `atr_rvol_source_read_failed:${String(error?.message || error)}` }];
    }
  });
  return new Map(pairs);
}

module.exports = { readStrategy3AtrRvol, calculateAtrRvolEvidence, ATR_PERIOD, RVOL_SESSIONS, MIN_RVOL_SESSIONS, DAILY_TABLE, INTRADAY_TABLE };
