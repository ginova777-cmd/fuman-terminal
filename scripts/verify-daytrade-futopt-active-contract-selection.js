const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const tickerFiles = [
  path.join(RUNTIME, "cache", "intraday", "fugle-futopt-tickers.json"),
  "C:/fuman-terminal/ops/public-slot/runtime/public-slot-futopt-tickers-cache.json",
];
const stockFiles = [
  path.join(RUNTIME, "data", "stocks-slim.json"),
  "C:/fuman-terminal/data/stocks-slim.json",
];
const requestedDate = (process.argv.find((value) => value.startsWith("--trade-date=")) || "").split("=")[1];
const tradeDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "")
  ? requestedDate
  : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function normalizeCode(value) {
  const code = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(code) ? code : "";
}
function cleanStockName(value) {
  return String(value || "").trim().replace(/期貨\d*$/u, "").replace(/\s+/g, "");
}
function endTime(value) {
  const parsed = Date.parse(`${String(value || "").slice(0, 10)}T00:00:00+08:00`);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

const tickerFile = tickerFiles.find((file) => Array.isArray(readJson(file)?.data) && readJson(file).data.length) || "";
const stockFile = stockFiles.find((file) => {
  const payload = readJson(file);
  return Array.isArray(payload) || Array.isArray(payload?.stocks) || Array.isArray(payload?.data);
}) || "";
const tickers = readJson(tickerFile)?.data || [];
const stockPayload = readJson(stockFile);
const stocks = Array.isArray(stockPayload) ? stockPayload : stockPayload?.stocks || stockPayload?.data || [];
const byName = new Map();
for (const stock of stocks) {
  const code = normalizeCode(stock.code || stock.symbol);
  const name = cleanStockName(stock.name);
  if (code && name && !byName.has(name)) byName.set(name, code);
}

const cutoff = endTime(tradeDate);
const nearestByUnderlying = new Map();
let expiredRejected = 0;
let mappedRows = 0;
for (const ticker of tickers) {
  if (String(ticker.contractType || "") !== "S") continue;
  const underlying = byName.get(cleanStockName(ticker.name));
  if (!underlying) continue;
  mappedRows += 1;
  const expiry = endTime(ticker.endDate);
  if (expiry < cutoff) { expiredRejected += 1; continue; }
  const current = nearestByUnderlying.get(underlying);
  if (!current || expiry < endTime(current.endDate)) nearestByUnderlying.set(underlying, ticker);
}

const selected = [...nearestByUnderlying.entries()].map(([symbol, ticker]) => ({
  symbol,
  future_symbol: ticker.symbol || "",
  end_date: ticker.endDate || "",
  name: ticker.name || "",
}));
const failed = [];
if (!tickerFile) failed.push("futopt_ticker_cache_missing");
if (!stockFile) failed.push("stocks_lookup_missing");
if (selected.length < 20) failed.push("active_mapped_stock_futures_below_20");
console.log(JSON.stringify({
  ok: failed.length === 0,
  contract: "daytrade_futopt_active_contract_selection_readonly_v1",
  trade_date: tradeDate,
  ticker_cache: tickerFile || null,
  stock_lookup: stockFile || null,
  ticker_rows: tickers.length,
  mapped_stock_future_rows: mappedRows,
  expired_contracts_rejected: expiredRejected,
  active_mapped_stock_futures: selected.length,
  sample: selected.slice(0, 20),
  failed_checks: failed,
  first_blocker: failed[0] || null,
  read_only: true,
}, null, 2));
