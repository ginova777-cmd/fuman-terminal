const fs = require("fs");
const path = require("path");
const marketHandler = require("../api/market");
const heatmapHandler = require("../api/heatmap");
const stocksHandler = require("../api/stocks");
const { ROOT, dataPath } = require("./runtime-paths");

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function callHandler(handler, query = {}) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function slimStock(row) {
  return {
    Code: row.Code || row.code || "",
    Name: row.Name || row.name || "",
    Market: row.Market || row.market || "",
    ClosingPrice: row.ClosingPrice ?? row.close ?? "",
    Change: row.Change ?? row.change ?? "",
    TradeValue: row.TradeValue ?? row.value ?? "",
    TradeVolume: row.TradeVolume ?? row.tradeVolume ?? "",
    percent: row.percent ?? row.Percent ?? "",
    quoteDate: row.quoteDate || row.tradeDate || "",
  };
}

function slimSector(sector) {
  return {
    name: sector.name || "",
    avg: sector.avg,
    up: sector.up,
    down: sector.down,
    total: sector.total,
    stocks: Array.isArray(sector.stocks) ? sector.stocks.slice(0, 8).map(slimStock) : [],
  };
}

function taipeiDateKey() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function hasMisRealtimeIndexes(indexes) {
  return Array.isArray(indexes) && indexes.some((item) => String(item?._source || "").includes("MIS"));
}

function assertTodayMarketSummary(summary) {
  const today = String(summary.today || "");
  const resolved = String(summary.resolvedTradeDate || "");
  const twse = String(summary.marketDates?.twse || "");
  const tpex = String(summary.marketDates?.tpex || "");
  const issues = [];
  if (!today) issues.push("today is empty");
  if (resolved !== today) issues.push(`resolvedTradeDate=${resolved || "(empty)"} today=${today || "(empty)"}`);
  if (summary.isFallbackDate !== false) issues.push(`isFallbackDate=${summary.isFallbackDate}`);
  const allowsRealtimeDate = summary.trading === true && summary.realtimeIndex === true && resolved === today;
  if (!allowsRealtimeDate && twse !== today) issues.push(`marketDates.twse=${twse || "(empty)"} today=${today || "(empty)"}`);
  if (!allowsRealtimeDate && tpex !== today) issues.push(`marketDates.tpex=${tpex || "(empty)"} today=${today || "(empty)"}`);
  if (issues.length) {
    throw new Error(`market-summary freshness guard failed: ${issues.join("; ")}`);
  }
}

async function main() {
  const [market, heatmap, stocksResult] = await Promise.allSettled([
    callHandler(marketHandler),
    callHandler(heatmapHandler),
    callHandler(stocksHandler),
  ]);
  const marketPayload = market.status === "fulfilled" ? market.value : {};
  const heatmapPayload = heatmap.status === "fulfilled" ? heatmap.value : {};
  const stockPayload = stocksResult.status === "fulfilled" ? stocksResult.value : {};
  const heatmapStocks = Array.isArray(heatmapPayload.sectors)
    ? heatmapPayload.sectors.flatMap((sector) => Array.isArray(sector.stocks) ? sector.stocks : [])
    : [];
  const stocks = heatmapStocks.length
    ? heatmapStocks
    : Array.isArray(marketPayload.stocks) && marketPayload.stocks.length
      ? marketPayload.stocks
      : Array.isArray(stockPayload.stocks)
        ? stockPayload.stocks
        : [];
  const topStocks = [...stocks]
    .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0))
    .slice(0, 80)
    .map(slimStock);
  const todayKey = stockPayload.today || marketPayload.today || taipeiDateKey();
  const sourceTradeDate = stockPayload.sourceTradeDate || stockPayload.resolvedTradeDate || marketPayload.resolvedTradeDate || "";
  const resolvedTradeDate = marketPayload.trading === true && hasMisRealtimeIndexes(marketPayload.indexes)
    ? todayKey
    : (stockPayload.resolvedTradeDate || marketPayload.resolvedTradeDate || "");
  const summary = {
    ok: Boolean(marketPayload.ok || heatmapPayload.ok),
    source: "market-summary",
    updatedAt: new Date().toISOString(),
    marketStatus: marketPayload.marketStatus || "",
    trading: marketPayload.trading === true,
    indexes: marketPayload.indexes || [],
    futuresNear: marketPayload.futuresNear || marketPayload.futures || null,
    futuresNext: marketPayload.futuresNext || null,
    otcSignal: marketPayload.otcSignal || null,
    stockCount: stocks.length,
    stocks: topStocks,
    sectors: Array.isArray(heatmapPayload.sectors) ? heatmapPayload.sectors.slice(0, 60).map(slimSector) : [],
    marketDates: stockPayload.marketDates || marketPayload.marketDates || {},
    resolvedTradeDate,
    sourceTradeDate,
    isFallbackDate: Boolean(resolvedTradeDate && todayKey && resolvedTradeDate !== todayKey),
    realtimeIndex: hasMisRealtimeIndexes(marketPayload.indexes),
    today: todayKey,
  };
  assertTodayMarketSummary(summary);
  writeJson(path.join(ROOT, "data", "market-summary.json"), summary);
  writeJson(dataPath("market-summary.json"), summary);
  console.log(`market summary wrote stocks=${summary.stockCount} sectors=${summary.sectors.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

