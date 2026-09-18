"use strict";
const { createHash } = require("node:crypto");
const fs = require("node:fs"), path = require("node:path");
const { resolveVolumeUnit } = require("./daytrade-intraday-5m-volume-unit");
const CONTRACT = "previous_session_native_5m_warmup_only_v1";
const MODE = "previous_session_native_regular_bars_today_signals_only";
const HISTORY_SOURCE = "fugle_stock_historical_candles_timeframe_5";
// Separate, bounded history budget; never retry-storm the shared live data key.
function historyBudget(fetchImpl = fetch, { limit = 20, intervalMs = 3000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let used = 0, stopped = false, chain = Promise.resolve();
  return (...args) => {
    const request = chain.then(async () => {
      if (stopped) throw Error("HISTORY_RATE_LIMIT_CIRCUIT_OPEN");
      if (used >= limit) throw Error("HISTORY_WARMUP_DEFERRED_BUDGET");
      if (used > 0) await sleep(intervalMs);
      used++;
      const response = await fetchImpl(...args);
      if (response.status === 429) stopped = true;
      return response;
    });
    chain = request.catch(() => {});
    return request;
  };
}
const dateAt = value => new Date(Date.parse(value) + 28800000).toISOString().slice(0, 10);
const minuteAt = value => { const d = new Date(Date.parse(value) + 28800000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
function sessionAdjacent(a, b, context = {}) {
  if (!a || !b || !a.confirmation_eligible || !b.confirmation_eligible) return false;
  if (Date.parse(b.bar_start) - Date.parse(a.bar_start) === 300000) return true;
  return context.contract === CONTRACT && context.previousTradeDate < context.tradeDate &&
    a.symbol === b.symbol && a.trade_date === context.previousTradeDate && b.trade_date === context.tradeDate &&
    dateAt(a.bar_start) === context.previousTradeDate && dateAt(b.bar_start) === context.tradeDate &&
    a.source === HISTORY_SOURCE && a.is_synthetic === false && b.is_synthetic === false &&
    a.volume_available === true && b.volume_available === true &&
    minuteAt(a.bar_start) === 800 && minuteAt(b.bar_start) === 540;
}
function previousSession(calendar, tradeDate) {
  const valid = calendar.filter(r => r.market === "TW" && r.is_open === true && r.payload?.smoke_test !== true);
  if (valid.filter(r => r.trade_date === tradeDate).length !== 1) throw Error("CURRENT_SESSION_NOT_VERIFIED");
  const dates = valid.filter(r => r.trade_date < tradeDate).map(r => r.trade_date).sort();
  if (!dates.length) throw Error("PREVIOUS_SESSION_MISSING");
  const date = dates.at(-1);
  if (dates.filter(d => d === date).length !== 1) throw Error("PREVIOUS_SESSION_AMBIGUOUS");
  return date;
}
function normalizeHistory(payload, symbol, previousTradeDate, asOf, currentMetadata) {
  if (payload?.symbol !== symbol || payload.timeframe !== "5" || !Array.isArray(payload.data)) throw Error("HISTORY_IDENTITY_MISMATCH");
  // Historical metadata may omit type/market. Only same-symbol provider metadata may supply it.
  const metadata = { ...currentMetadata, ...payload };
  if (currentMetadata?.symbol !== symbol) throw Error("HISTORY_INSTRUMENT_IDENTITY_MISMATCH");
  if ((payload.type && payload.type !== currentMetadata.type) || (payload.market && payload.market !== currentMetadata.market)) throw Error("HISTORY_INSTRUMENT_MISMATCH");
  const unit = resolveVolumeUnit(metadata);
  if (unit.instrument_type !== "EQUITY" || !["TSE", "OTC", "TIB"].includes(unit.market) || !unit.volume_available) throw Error("HISTORY_UNIT_OR_INSTRUMENT_INVALID");
  const seen = new Set(), bars = [];
  for (const row of payload.data) {
    const start = Date.parse(row.date);
    if (!Number.isFinite(start) || dateAt(row.date) !== previousTradeDate) throw Error("HISTORY_DATE_MISMATCH");
    const minute = minuteAt(row.date);
    // 13:30 auction is not a regular 5-minute interval; never fabricate 13:25.
    if (minute < 540 || minute >= 805) continue;
    if (start % 300000 || start + 300000 > Date.parse(asOf) || seen.has(start)) throw Error("HISTORY_TIME_OR_DUPLICATE_INVALID");
    seen.add(start);
    const nums = [row.open, row.high, row.low, row.close, row.volume];
    if (nums.some(v => typeof v !== "number" || !Number.isFinite(v)) || nums.slice(0, 4).some(v => v <= 0) || row.volume < 0 || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low || row.is_synthetic === true || row.synthetic === true) throw Error("HISTORY_OHLCV_INVALID");
    bars.push({ symbol, trade_date: previousTradeDate, candle_time: new Date(start).toISOString(), bar_start: new Date(start).toISOString(), bar_end: new Date(start + 300000).toISOString(), open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, ...unit, is_synthetic: false, bar_count: 5, bar_kind: "regular_session", bar_complete: true, confirmation_eligible: true, source: HISTORY_SOURCE });
  }
  return { bars: bars.sort((a,b) => Date.parse(a.bar_start) - Date.parse(b.bar_start)), evidence: { contract: CONTRACT, source: HISTORY_SOURCE, source_trade_date: previousTradeDate, source_rows: payload.data.length, accepted_rows: bars.length, raw_sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), historical_signal_publication: false } };
}
async function fetchWarmup({ symbol, previousTradeDate, asOf, currentMetadata, apiKey, cacheDir, fetchImpl = fetch }) {
  if (!/^\d{4}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate)) throw Error("HISTORY_REQUEST_INVALID");
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${encodeURIComponent(symbol)}?from=${previousTradeDate}&to=${previousTradeDate}&timeframe=5&sort=asc`;
  const cacheFile = cacheDir && path.join(cacheDir, previousTradeDate, symbol + ".json");
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      const result = normalizeHistory(cached.payload, symbol, previousTradeDate, asOf, currentMetadata);
      if (cached.source_url === url && cached.raw_sha256 === result.evidence.raw_sha256 && Number.isFinite(Date.parse(cached.fetched_at)) && Date.parse(cached.fetched_at) <= Date.parse(asOf)) {
        result.evidence = { ...result.evidence, source_url: url, fetched_at: cached.fetched_at, cache_hit: true };
        return result;
      }
    } catch { /* Invalid cache is never used as evidence; fetch the authoritative source. */ }
  }
  const response = await fetchImpl(url, { headers: { "X-API-KEY": apiKey }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`HISTORY_HTTP_${response.status}`);
  const payload = await response.json();
  const result = normalizeHistory(payload, symbol, previousTradeDate, asOf, currentMetadata);
  result.evidence.source_url = url;
  result.evidence.fetched_at = new Date().toISOString();
  result.evidence.cache_hit = false;
  if (cacheFile && result.bars.length) {
    const temporary = cacheFile + "." + process.pid + ".tmp";
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ payload, ...result.evidence }));
    fs.renameSync(temporary, cacheFile);
  }
  return result;
}
module.exports = { CONTRACT, MODE, sessionAdjacent, previousSession, normalizeHistory, fetchWarmup, historyBudget };
