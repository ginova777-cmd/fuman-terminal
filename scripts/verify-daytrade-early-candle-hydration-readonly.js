const fs = require("fs");
const path = require("path");
// This verifier inspects the dedicated daytrade collector cache, not shared v1.
process.env.FUGLE_COLLECTOR_ROLE = process.env.FUGLE_COLLECTOR_ROLE || "daytrade";
const { FUGLE_WS_CANDLES_FILE, readJson } = require("../lib/fugle-websocket-quotes");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = ""] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const tradeDate = String(args["trade-date"] || "").trim();
const symbol = String(args.symbol || "").replace(/\D/g, "").slice(0, 4);
const checkpoint = String(args.checkpoint || "09:01");

function taipeiDateFrom(value) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function checkpointMs(date, hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return NaN;
  return Date.parse(date + "T" + match[1] + ":" + match[2] + ":59+08:00");
}

const compactDate = tradeDate.replace(/\D/g, "");
const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", "daytrade-early-candle-hydration-" + compactDate + ".json");
const receipt = fs.existsSync(receiptPath) ? readJson(receiptPath, {}) : null;
const cache = readJson(FUGLE_WS_CANDLES_FILE, {});
const allCandles = Array.isArray(cache.candles) ? cache.candles : [];
const symbolCandles = symbol
  ? allCandles.filter((row) => String(row.code || row.symbol || "").replace(/\D/g, "").slice(0, 4) === symbol && taipeiDateFrom(row.candleTime || row.date) === tradeDate)
  : [];
const cutoffMs = checkpointMs(tradeDate, checkpoint);
const candleAtCheckpoint = symbolCandles.some((row) => {
  const ms = Date.parse(String(row.candleTime || row.date || ""));
  return Number.isFinite(ms) && ms <= cutoffMs;
});
const failures = [];
if (!tradeDate) failures.push("trade_date_missing");
if (!symbol) failures.push("symbol_missing");
if (!receipt) failures.push("early_candle_hydration_receipt_missing");
if (receipt && receipt.trade_date !== tradeDate) failures.push("early_candle_hydration_receipt_date_mismatch");
if (receipt && receipt.priority_manifest_same_day !== true) failures.push("early_candle_priority_manifest_not_same_day");
if (receipt && symbol && !new Set(receipt.candle_symbols || []).has(symbol)) failures.push("symbol_not_in_early_candle_queue");
if (symbol && !candleAtCheckpoint) failures.push("no_formal_1m_candle_by_" + checkpoint);

console.log(JSON.stringify({
  ok: failures.length === 0,
  contract: "daytrade_early_candle_hydration_readonly_v1",
  trade_date: tradeDate,
  symbol,
  checkpoint,
  receipt_path: receiptPath,
  receipt_exists: Boolean(receipt),
  receipt: receipt ? {
    captured_at: receipt.captured_at || null,
    phase: receipt.phase || null,
    priority_manifest_same_day: receipt.priority_manifest_same_day === true,
    priority_manifest_trade_date: receipt.priority_manifest_trade_date || null,
    candle_symbol_count: Number(receipt.candle_symbol_count || 0),
    symbol_in_candle_queue: symbol ? new Set(receipt.candle_symbols || []).has(symbol) : null,
  } : null,
  formal_candle_count: symbolCandles.length,
  first_candle_time: symbolCandles[0] ? (symbolCandles[0].candleTime || symbolCandles[0].date || null) : null,
  last_candle_time: symbolCandles.length ? (symbolCandles[symbolCandles.length - 1].candleTime || symbolCandles[symbolCandles.length - 1].date || null) : null,
  formal_candle_by_checkpoint: candleAtCheckpoint,
  formal_candidate_count: 0,
  failed_checks: failures,
  first_blocker: failures[0] || null,
  read_only: true,
}, null, 2));
process.exitCode = failures.length ? 1 : 0;
