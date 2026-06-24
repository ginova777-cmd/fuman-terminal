const fs = require("fs");
const path = require("path");
const stocksHandler = require("../api/stocks");
const { ROOT, dataPath } = require("./runtime-paths");

const syncRoot = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal";
const MIN_STOCK_COUNT = Number(process.env.STOCKS_SLIM_MIN_COUNT || 1500);

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
}

function writeToAll(rel, payload) {
  for (const root of [...new Set([ROOT, path.dirname(path.dirname(dataPath("x"))), syncRoot])]) {
    writeJson(path.join(root, rel), payload);
  }
}

function normalizeStock(stock) {
  const close = cleanNumber(stock?.ClosingPrice ?? stock?.close);
  const change = cleanNumber(stock?.Change ?? stock?.change);
  const previous = close - change;
  const percent = Number.isFinite(Number(stock?.Percent ?? stock?.percent))
    ? Number(stock?.Percent ?? stock?.percent)
    : (previous ? (change / previous) * 100 : 0);
  return {
    code: String(stock?.Code ?? stock?.code ?? "").trim(),
    name: String(stock?.Name ?? stock?.name ?? stock?.Code ?? stock?.code ?? "").trim(),
    market: String(stock?.Market ?? stock?.market ?? "").trim(),
    close,
    change,
    percent: Number(percent.toFixed(2)),
    tradeVolume: cleanNumber(stock?.TradeVolume ?? stock?.tradeVolume ?? stock?.volume),
    value: cleanNumber(stock?.TradeValue ?? stock?.value),
    quoteDate: stock?.quoteDate || stock?.tradeDate || stock?.TradeDate || "",
  };
}

function callStocksHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400) {
          reject(new Error(`stocks handler HTTP ${this.statusCode}: ${payload?.error || payload?.message || "failed"}`));
          return;
        }
        resolve(payload);
      },
    };
    Promise.resolve(stocksHandler(req, res)).catch(reject);
  });
}

async function main() {
  const payload = await callStocksHandler();
  const stocks = normalizeArray(payload?.stocks)
    .map(normalizeStock)
    .filter((stock) => /^\d{4}$/.test(stock.code) && stock.name && stock.close)
    .sort((a, b) => a.code.localeCompare(b.code));
  const slim = {
    ok: stocks.length >= MIN_STOCK_COUNT,
    source: `stocks-slim-full:${payload?.source || "api/stocks"}`,
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    today: payload?.today || "",
    resolvedTradeDate: payload?.resolvedTradeDate || "",
    sourceTradeDate: payload?.sourceTradeDate || "",
    isFallbackDate: Boolean(payload?.isFallbackDate),
    realtimeCount: cleanNumber(payload?.realtimeCount),
    marketDates: payload?.marketDates || {},
    count: stocks.length,
    stocks,
  };
  if (!slim.ok) {
    console.error(`[stocks-slim] refused to overwrite full cache: count=${slim.count} < ${MIN_STOCK_COUNT}`);
    process.exitCode = 1;
    return;
  }
  writeToAll("data/stocks-slim.json", slim);
  console.log(`[stocks-slim] wrote data/stocks-slim.json count=${slim.count} date=${slim.resolvedTradeDate || slim.today || "unknown"} ok=${slim.ok}`);
}

main().catch((error) => {
  console.error(`[stocks-slim] failed: ${error.message}`);
  process.exitCode = 1;
});
