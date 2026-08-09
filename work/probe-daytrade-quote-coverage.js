const fs = require("fs");
const { readFugleWebSocketQuotes } = require("C:\\fuman-terminal\\lib\\fugle-websocket-quotes");

const url = "https://cpmpfhbzutkiecccekfr.supabase.co";
const readText = (file) => {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
};
const key = process.env.SUPABASE_ANON_KEY
  || readText("C:\\fuman-runtime\\secrets\\supabase-anon-key.txt")
  || readText("C:\\fuman-runtime\\secrets\\supabase-service-role-key.txt");
if (!key) throw new Error("missing Supabase read key");

async function readPaged(resource, query, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const response = await fetch(`${url}/rest/v1/${resource}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + pageSize - 1}` },
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${text.slice(0, 200)}`);
    const page = text ? JSON.parse(text) : [];
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const countFields = (rows, fields) => Object.fromEntries(fields.map((field) => [field, rows.filter((row) => positive(row[field])).length]));
const normalize = (value) => String(value || "").replace(/\D/g, "").slice(0, 4).padStart(4, "0");

const [active, quotes, daily] = await Promise.all([
  readPaged("stock_tickers", "select=symbol,market,stock_type,type,is_etf,is_suspended&order=symbol.asc"),
  readPaged("fugle_daytrade_quotes_live", "select=symbol,price,open_price,previous_close,total_volume,change_percent,quote_seen_at,updated_at&order=symbol.asc"),
  readPaged("fugle_daytrade_daily_volume_avg", "select=symbol,avg_volume5,avg5_volume,volume,trade_date,updated_at&order=symbol.asc"),
]);
const activeCodes = new Set(active.filter((row) => !row.is_etf && !row.is_suspended).map((row) => normalize(row.symbol)).filter(Boolean));
const quoteMap = new Map(quotes.map((row) => [normalize(row.symbol), row]));
const dailyMap = new Map(daily.map((row) => [normalize(row.symbol), row]));
const cache = readFugleWebSocketQuotes({ maxAgeMs: 120000 });
const cacheRows = [...cache.quotes.entries()].map(([code, row]) => ({ code: normalize(code || row.code || row.symbol), row }));
const wsCurrent = (row, ...keys) => keys.map((keyName) => row?.[keyName]).find((value) => value !== undefined && value !== null && value !== "");
const merged = [...activeCodes].map((symbol) => {
  const previous = quoteMap.get(symbol) || {};
  const cached = cache.quotes.get(symbol) || {};
  const choose = (value, fallback, positiveOnly = false) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && (!positiveOnly || parsed > 0)) return parsed;
    const previousValue = Number(fallback);
    return Number.isFinite(previousValue) ? previousValue : 0;
  };
  return {
    symbol,
    price: choose(wsCurrent(cached, "close", "price"), previous.price, true),
    open_price: choose(wsCurrent(cached, "open", "openPrice"), previous.open_price, true),
    previous_close: choose(wsCurrent(cached, "previousClose", "previous_close", "referencePrice"), previous.previous_close, true),
    total_volume: choose(wsCurrent(cached, "tradeVolume", "total_volume"), previous.total_volume, true),
    avg_volume5: Number(dailyMap.get(symbol)?.avg_volume5 ?? dailyMap.get(symbol)?.avg5_volume ?? 0),
  };
});
console.log(JSON.stringify({
  ok: true,
  active: { total: active.length, eligible: activeCodes.size },
  supabaseQuotes: { rows: quotes.length, matchedActive: quotes.filter((row) => activeCodes.has(normalize(row.symbol))).length, fields: countFields(quotes, ["price", "open_price", "previous_close", "total_volume", "change_percent"]) },
  dailyVolume: { rows: daily.length, avg5Positive: daily.filter((row) => positive(row.avg_volume5 ?? row.avg5_volume)).length, avg5Gt3000: daily.filter((row) => Number(row.avg_volume5 ?? row.avg5_volume) > 3000).length, matchedActive: daily.filter((row) => activeCodes.has(normalize(row.symbol))).length },
  websocketCache: { rows: cacheRows.length, payloadUpdatedAt: cache.payload?.updatedAt || "", fields: {
    price: cacheRows.filter(({ row }) => positive(wsCurrent(row, "close", "price"))).length,
    open: cacheRows.filter(({ row }) => positive(wsCurrent(row, "open", "openPrice"))).length,
    previousClose: cacheRows.filter(({ row }) => positive(wsCurrent(row, "previousClose", "previous_close", "referencePrice"))).length,
    volume: cacheRows.filter(({ row }) => positive(wsCurrent(row, "tradeVolume", "total_volume"))).length,
  } },
  mergedActive: { rows: merged.length, pricePositive: merged.filter((row) => positive(row.price)).length, openPositive: merged.filter((row) => positive(row.open_price)).length, previousClosePositive: merged.filter((row) => positive(row.previous_close)).length, volumePositive: merged.filter((row) => positive(row.total_volume)).length, avg5Gt3000: merged.filter((row) => row.avg_volume5 > 3000).length, strictBaseEligibleShape: merged.filter((row) => row.price >= 10 && row.price <= 1000 && row.avg_volume5 > 3000 && row.total_volume > 0).length },
}, null, 2));
