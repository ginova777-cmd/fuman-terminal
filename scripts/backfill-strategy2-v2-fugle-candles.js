"use strict";

// Controlled recovery only: copies today's real Fugle WebSocket candles into the
// formal mirror. It never creates Strategy2 candidates, LINE messages, or /88 rows.
process.env.FUGLE_COLLECTOR_ROLE = "daytrade";
const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { readFugleWebSocketCandles } = require("../lib/fugle-websocket-quotes");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_NAME = "fugle_daytrade_source";
const APPLY = process.argv.includes("--apply");
const BARS_PER_SYMBOL = Math.max(35, Math.min(120, Number(process.env.STRATEGY2_V2_BACKFILL_BARS_PER_SYMBOL || 35)));

function taipeiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function config() {
  return {
    url: terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, ""),
    key: terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR }),
  };
}

async function getRows(source, resource, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${source.url}/rest/v1/${resource}?${query.toString()}`, {
    headers: { apikey: source.key, Authorization: `Bearer ${source.key}`, Accept: "application/json", Range: "0-99999" },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : [];
}

async function upsertRows(source, rows) {
  let written = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const response = await fetch(`${source.url}/rest/v1/fugle_daytrade_intraday_1m?on_conflict=symbol%2Ccandle_time`, {
      method: "POST",
      headers: {
        apikey: source.key,
        Authorization: `Bearer ${source.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows.slice(index, index + 500)),
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`fugle_daytrade_intraday_1m upsert HTTP ${response.status}: ${text.slice(0, 240)}`);
    written += Math.min(500, rows.length - index);
  }
  return written;
}

(async () => {
  const source = config();
  if (!source.url || !source.key) throw new Error("strategy2_v2_backfill_supabase_credentials_missing");
  const tradeDate = taipeiDate();
  const motherRows = await getRows(source, "v_fugle_daytrade_mother_pool", {
    select: "trade_date,symbol,market,price,total_volume,source_name,updated_at",
    trade_date: `eq.${tradeDate}`,
    source_name: `eq.${SOURCE_NAME}`,
    order: "mother_pool_score.desc",
    limit: "1000",
  });
  const symbols = [...new Set(motherRows
    .filter((row) => row.source_name === SOURCE_NAME && /^(TSE|OTC)$/i.test(String(row.market || "")) && number(row.price) >= 50 && number(row.total_volume) > 0)
    .map((row) => normalizeCode(row.symbol))
    .filter((symbol) => /^\d{4}$/.test(symbol)))];
  const cache = readFugleWebSocketCandles({ maxAgeMs: 24 * 60 * 60 * 1000 });
  const allowed = new Set(symbols);
  const bySymbol = new Map();
  for (const candle of cache.candles.values()) {
    const symbol = normalizeCode(candle.symbol || candle.code);
    const candleTime = String(candle.candleTime || candle.date || "");
    if (!allowed.has(symbol) || !candleTime || taipeiDate(new Date(candleTime)) !== tradeDate || number(candle.close) <= 0) continue;
    const rows = bySymbol.get(symbol) || [];
    rows.push({
      symbol,
      market: candle.market || "",
      candle_time: candleTime,
      trade_date: candle.tradeDate || tradeDate,
      open: number(candle.open), high: number(candle.high), low: number(candle.low), close: number(candle.close), volume: number(candle.volume),
      source: "fugle_daytrade_writer:websocket_candles",
      updated_at: candle.candleSeenAt || cache.payload?.updatedAt || new Date().toISOString(),
      payload: { ...(candle.payload || {}), cacheUpdatedAt: cache.payload?.updatedAt || "", source: "fugle-websocket-candles-cache", recovery: "strategy2-v2-diagnostic-backfill" },
    });
    bySymbol.set(symbol, rows);
  }
  const rows = [];
  const readySymbols = [];
  const dataGaps = [];
  for (const symbol of symbols) {
    const candles = (bySymbol.get(symbol) || []).sort((a, b) => Date.parse(b.candle_time) - Date.parse(a.candle_time));
    if (candles.length >= BARS_PER_SYMBOL) readySymbols.push(symbol);
    else dataGaps.push({ symbol, candleCount: candles.length, reason: "formal_1m_below_ma35_readiness" });
    rows.push(...candles.slice(0, BARS_PER_SYMBOL));
  }
  let written = 0;
  if (APPLY && rows.length) written = await upsertRows(source, rows);
  const report = {
    ok: rows.length > 0,
    diagnosticOnly: true,
    apply: APPLY,
    strategyContract: "strategy2-live-v2-fugle-mother-pool-1m",
    source: "fugle_websocket_candles_cache_to_fugle_daytrade_intraday_1m",
    tradeDate,
    checkedAt: new Date().toISOString(),
    motherPoolSymbols: symbols.length,
    cacheSymbols: bySymbol.size,
    readySymbols: readySymbols.length,
    dataGapCount: dataGaps.length,
    rowsPrepared: rows.length,
    rowsWritten: written,
    barsPerSymbol: BARS_PER_SYMBOL,
    dataGaps,
    formalCandidateCreated: false,
    scorecardWritten: false,
  };
  writeJson(path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy2-v2-fugle-backfill-${tradeDate.replace(/-/g, "")}.json`), report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, diagnosticOnly: true, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});