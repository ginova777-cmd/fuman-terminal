"use strict";

const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const CACHE = path.join(RUNTIME, "cache", "intraday");
const URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const APPLY = process.argv.includes("--apply");

function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function secret(name) { return String(process.env[name] || readText(path.join(RUNTIME, "secrets", name.toLowerCase().replace(/_/g, "-") + ".txt"))).trim(); }
function parseCache(name) {
  for (const file of [path.join(CACHE, name), path.join(CACHE, name + ".bak")]) {
    try { return JSON.parse(readText(file)); } catch { /* retry stable backup */ }
  }
  throw new Error(`cache_unreadable:${name}`);
}
function tradeDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
function iso(value) { const time = Date.parse(String(value || "")); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
async function upsert(table, rows, conflict) {
  const key = secret("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("service_role_key_missing");
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 200) {
    const response = await fetch(`${URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(offset, offset + 200)),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${table}_HTTP_${response.status}:${(await response.text()).slice(0, 240)}`);
    written += Math.min(200, rows.length - offset);
  }
  return written;
}

async function main() {
  const now = new Date();
  const date = tradeDate(now);
  const calendar = await isTwseTradingDay(now, { stateDir: path.join(RUNTIME, "state") });
  if (!calendar.isTradingDay) return console.log(JSON.stringify({ ok: true, skipped: true, reason: "market_calendar_non_trading_day", trade_date: date }));
  const quoteCache = parseCache("fugle-daytrade-ws-quotes-v2.json");
  const candleCache = parseCache("fugle-daytrade-ws-candles-v2.json");
  const cutoff = Date.now() - 180000;
  const quotes = (quoteCache.quotes || []).filter((q) => Date.parse(q.quoteSeenAt || q.exchangeTime || q.receivedAt) >= cutoff).map((q) => ({
    symbol: String(q.code || q.symbol || ""), trade_date: date, name: q.name || String(q.code || ""), market: q.market || "",
    quote_seen_at: iso(q.quoteSeenAt || q.exchangeTime || q.receivedAt), updated_at: iso(q.receivedAt || q.quoteSeenAt), last_trade_time: iso(q.exchangeTime || q.quoteSeenAt),
    price: num(q.formalLastPrice ?? q.close), open_price: num(q.open), high_price: num(q.high), low_price: num(q.low), previous_close: num(q.prevClose),
    change_percent: num(q.percent), total_volume: num(q.tradeVolume), trade_value: num(q.tradeValue), bid_price: num(q.bidPrice), bid_volume: num(q.bidSize),
    ask_price: num(q.askPrice), ask_volume: num(q.askSize), cumulative_bid_volume: num(q.cumulativeBidVolume), cumulative_ask_volume: num(q.cumulativeAskVolume),
    source: "fugle_websocket_fast_sync", payload: { quoteSource: q.quoteSource, exchangeTime: q.exchangeTime, fastSync: true },
  })).filter((q) => /^\d{4}$/.test(q.symbol) && q.quote_seen_at);
  const candles = (candleCache.candles || []).filter((c) => c.tradeDate === date && Date.parse(c.candleSeenAt || candleCache.updatedAt) >= cutoff).map((c) => ({
    symbol: String(c.symbol || c.code || ""), market: c.market || "", trade_date: date, candle_time: iso(c.candleTime || c.date),
    open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume), updated_at: iso(c.candleSeenAt || candleCache.updatedAt),
    source: "fugle_daytrade_fast_sync:websocket_candles", synthetic: false, volume_strategy_usable: c.volumeStrategyUsable !== false,
    payload: { ...(c.payload || {}), fastSync: true, cacheUpdatedAt: candleCache.updatedAt },
  })).filter((c) => /^\d{4}$/.test(c.symbol) && c.candle_time && c.close !== null);
  const result = { ok: true, mode: APPLY ? "apply" : "dry_run", trade_date: date, checked_at: now.toISOString(), quote_rows: quotes.length, candle_rows: candles.length, quote_cache_updated_at: quoteCache.updatedAt, candle_cache_updated_at: candleCache.updatedAt };
  if (APPLY) {
    result.quotes_written = await upsert("fugle_daytrade_quotes_live", quotes, "symbol");
    result.candles_written = await upsert("fugle_daytrade_intraday_1m", candles, "symbol,candle_time");
    const stateFile = path.join(RUNTIME, "state", "daytrade-fast-supabase-sync.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...result, completed_at: new Date().toISOString() }, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(result));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
