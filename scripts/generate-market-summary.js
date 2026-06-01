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
    resolvedTradeDate: stockPayload.resolvedTradeDate || marketPayload.resolvedTradeDate || "",
    today: stockPayload.today || marketPayload.today || "",
  };
  writeJson(path.join(ROOT, "data", "market-summary.json"), summary);
  writeJson(dataPath("market-summary.json"), summary);
  console.log(`market summary wrote stocks=${summary.stockCount} sectors=${summary.sectors.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
