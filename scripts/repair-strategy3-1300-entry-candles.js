const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback = "") => {
  const item = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};

const APPLY = args.has("--apply");
const TRADE_DATE = valueArg("--trade-date", "");
const RUN_ID = valueArg("--run-id", "");
const MAX_SYMBOLS = Math.max(1, Number(valueArg("--max-symbols", "120")) || 120);
const DELAY_MS = Math.max(0, Number(valueArg("--delay-ms", "250")) || 0);

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function secret(name) {
  if (process.env[name]) return process.env[name];
  const file = name === "FUGLE_API_KEY" ? "fugle-api-key.txt" : "supabase-service-role-key.txt";
  return readSecret(path.join(RUNTIME_DIR, "secrets", file));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  const text = cleanText(value);
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

function normalizeSymbol(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 4);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function supabaseGet(resource, query, key) {
  return await requestJson(`${SUPABASE_URL}/rest/v1/${resource}?${query}`, { headers: headers(key) }) || [];
}

async function supabaseUpsert(resource, rows, conflict, key) {
  if (!rows.length) return 0;
  await requestJson(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal", "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  return rows.length;
}

async function latestStrategy3Run(scanDate, key) {
  const rows = await supabaseGet("strategy3_scan_runs", [
    "select=run_id,scan_date,status,complete,result_count,updated_at",
    "strategy=eq.strategy3",
    "status=eq.complete",
    "complete=eq.true",
    `scan_date=eq.${encodeURIComponent(scanDate)}`,
    "order=updated_at.desc",
    "limit=1",
  ].join("&"), key);
  return rows[0] || null;
}

async function strategy3Symbols(runId, key) {
  const rows = await supabaseGet("strategy3_scan_results", [
    "select=code,name,rank",
    "strategy=eq.strategy3",
    `run_id=eq.${encodeURIComponent(runId)}`,
    "order=rank.asc",
    `limit=${MAX_SYMBOLS}`,
  ].join("&"), key);
  return rows.map((row) => ({ symbol: normalizeSymbol(row.code), name: cleanText(row.name), rank: Number(row.rank || 0) })).filter((row) => /^\d{4}$/.test(row.symbol));
}

async function fugleCandles(symbol, apiKey) {
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${encodeURIComponent(symbol)}?timeframe=1`;
  const result = await requestJson(url, { headers: { "X-API-KEY": apiKey, Accept: "application/json" } });
  return Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
}

function taipeiMinute(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(parsed);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function taipeiDate(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function candleTime(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function selectEntryCandle(symbol, candles, tradeDate) {
  const candidates = candles
    .map((raw) => {
      const time = candleTime(raw.date || raw.candleTime || raw.time);
      return {
        symbol,
        candle_time: time,
        trade_date: taipeiDate(time),
        minute: taipeiMinute(time),
        open: cleanNumber(raw.open),
        high: cleanNumber(raw.high),
        low: cleanNumber(raw.low),
        close: cleanNumber(raw.close),
        volume: cleanNumber(raw.volume) ?? 0,
      };
    })
    .filter((row) => row.trade_date === tradeDate && row.close > 0 && row.minute >= 12 * 60 + 50 && row.minute <= 13 * 60)
    .sort((a, b) => b.minute - a.minute);
  return candidates[0] || null;
}

function repairRow(candle) {
  return {
    symbol: candle.symbol,
    market: "",
    candle_time: candle.candle_time,
    trade_date: candle.trade_date,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    source: "strategy3_scorecard_entry_repair:fugle_rest",
    source_channel: "rest",
    candle_origin: "rest_candle",
    synthetic: false,
    volume_strategy_usable: true,
    websocket_row: false,
    rest_repair_row: true,
    intraday_odd_lot: false,
    updated_at: new Date().toISOString(),
    payload: {
      reason_code: "strategy3_1300_entry_price_repair",
      source_channel: "rest",
      candle_origin: "rest_candle",
      synthetic: false,
      volume_strategy_usable: true,
    },
  };
}

async function main() {
  const tradeDate = normalizeDate(TRADE_DATE);
  if (!tradeDate) throw new Error("missing --trade-date=YYYY-MM-DD");
  const serviceKey = secret("SUPABASE_SERVICE_ROLE_KEY");
  const fugleKey = secret("FUGLE_API_KEY");
  if (!serviceKey) throw new Error("missing Supabase service role key");
  if (!fugleKey) throw new Error("missing Fugle API key");

  const run = RUN_ID ? { run_id: RUN_ID } : await latestStrategy3Run(tradeDate, serviceKey);
  if (!run?.run_id) throw new Error(`strategy3 complete run not found for ${tradeDate}`);
  const symbols = await strategy3Symbols(run.run_id, serviceKey);
  const repaired = [];
  const missing = [];
  const failed = [];

  for (const item of symbols) {
    try {
      const entry = selectEntryCandle(item.symbol, await fugleCandles(item.symbol, fugleKey), tradeDate);
      if (entry) repaired.push(repairRow(entry));
      else missing.push(item.symbol);
    } catch (error) {
      failed.push({ symbol: item.symbol, error: error.message || String(error) });
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  const written = APPLY ? await supabaseUpsert("fugle_daytrade_intraday_1m", repaired, "symbol,candle_time", serviceKey) : 0;
  const receipt = {
    ok: missing.length === 0 && failed.length === 0 && repaired.length === symbols.length,
    apply: APPLY,
    tradeDate,
    runId: run.run_id,
    expectedSymbols: symbols.length,
    repaired: repaired.length,
    written,
    missing,
    failed,
    sample: repaired.slice(0, 10).map((row) => ({ symbol: row.symbol, candle_time: row.candle_time, close: row.close })),
    checkedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.ok) process.exit(2);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2));
  process.exit(1);
});
