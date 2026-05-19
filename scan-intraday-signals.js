const fs = require("fs");
const path = require("path");
const { buildRanks, cleanNumber, detectSignals, isIntradayTradable } = require("./intraday-radar-rules");

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".intraday-cache");
const SIGNAL_FILE = path.join(CACHE_DIR, "signals.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "FumanIntradayScorecard/1.0" } });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStocks() {
  try {
    const market = await fetchJson(`${BASE_URL}/api/market?t=${Date.now()}`, 30000);
    if (Array.isArray(market?.stocks) && market.stocks.length) {
      return market.stocks.map((stock) => ({
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        close: cleanNumber(stock.close),
        change: cleanNumber(stock.change),
        percent: cleanNumber(stock.pct ?? stock.percent),
        value: cleanNumber(stock.value),
        tradeVolume: cleanNumber(stock.volume ?? stock.tradeVolume),
      })).filter((stock) => stock.code && stock.name);
    }
  } catch {}

  const payload = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 30000);
  return payload.map((stock) => {
    const close = cleanNumber(stock.ClosingPrice || stock["收盤價"]);
    const change = cleanNumber(stock.Change || stock["漲跌價差"]);
    const prevClose = close - change;
    return {
      code: String(stock.Code || stock["證券代號"] || ""),
      name: String(stock.Name || stock["證券名稱"] || ""),
      close,
      change,
      percent: prevClose ? (change / prevClose) * 100 : 0,
      value: cleanNumber(stock.TradeValue || stock["成交金額"]),
      tradeVolume: cleanNumber(stock.TradeVolume || stock["成交股數"]),
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
}

async function fetchRealtime(stocks) {
  const quotes = new Map();
  const batchSize = 100;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const codes = stocks.slice(i, i + batchSize).map((stock) => stock.code);
    if (!codes.length) continue;
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 20000);
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
    } catch (error) {
      console.log(`realtime batch failed ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return stock;
    const value = cleanNumber(quote.tradeVolume) && cleanNumber(quote.close)
      ? cleanNumber(quote.tradeVolume) * cleanNumber(quote.close)
      : stock.value;
    return { ...stock, ...quote, value, isRealtime: true };
  });
}

async function main() {
  const parts = taipeiParts();
  const key = dateKey(parts);
  const cache = readJson(SIGNAL_FILE, { date: key, records: [], previous: {} });
  if (cache.date !== key) {
    cache.date = key;
    cache.records = [];
    cache.previous = {};
  }

  const rawStocks = await fetchStocks();
  const liveStocks = (await fetchRealtime(rawStocks)).filter(isIntradayTradable);
  const ranks = buildRanks(liveStocks);
  const timestamp = timestampKey(parts);
  let added = 0;

  for (const stock of liveStocks) {
    const previous = cache.previous[stock.code] || null;
    const signals = detectSignals(stock, previous || { tradeVolume: stock.tradeVolume }, ranks);
    cache.previous[stock.code] = {
      close: stock.close,
      high: stock.high,
      low: stock.low,
      tradeVolume: stock.tradeVolume,
      percent: stock.percent,
    };
    signals.forEach((signal) => {
      const duplicate = cache.records.some((record) => (
        record.code === stock.code &&
        record.strategy === signal.label &&
        record.timestamp === timestamp
      ));
      if (duplicate) return;
      cache.records.push({
        date: key,
        timestamp,
        code: stock.code,
        name: stock.name,
        strategy: signal.label,
        entryPrice: signal.entryPrice,
        entryLow: signal.entryLow,
        entryHigh: signal.entryHigh,
        stopLoss: signal.stopLoss,
        chaseLimit: signal.chaseLimit,
        observedPrice: stock.close,
        observedHigh: stock.high || stock.close,
        volume: stock.tradeVolume,
        percent: stock.percent,
        reason: signal.reason,
      });
      added += 1;
    });
  }

  cache.updatedAt = new Date().toISOString();
  writeJson(SIGNAL_FILE, cache);
  console.log(`intraday signals ${key}: added ${added}, total ${cache.records.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
