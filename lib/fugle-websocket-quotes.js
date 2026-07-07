const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CACHE_DIR = process.env.FUMAN_CACHE_DIR || path.join(RUNTIME_DIR, "cache");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const FUGLE_WS_SYMBOLS_FILE = path.join(CACHE_DIR, "intraday", "fugle-ws-symbols.json");
const FUGLE_WS_QUOTES_FILE = path.join(CACHE_DIR, "intraday", "fugle-ws-quotes.json");
const FUGLE_WS_CANDLES_FILE = path.join(CACHE_DIR, "intraday", "fugle-ws-candles.json");
const FUGLE_WS_STATUS_FILE = path.join(STATE_DIR, "fugle-websocket-status.json");

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function taipeiTimeFromEpochMicros(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const ms = number > 1e14 ? Math.floor(number / 1000) : number;
  return new Date(ms).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

function normalizeFugleAggregate(payload) {
  const data = payload?.data || payload || {};
  const code = String(data.symbol || "").replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(code)) return null;
  const close = cleanNumber(data.closePrice || data.lastPrice || data.lastTrade?.price);
  const prevClose = cleanNumber(data.previousClose || data.referencePrice);
  if (!close || !prevClose) return null;
  const change = cleanNumber(data.change) || close - prevClose;
  const timeValue = data.lastUpdated || data.closeTime || data.lastTrade?.time || data.total?.time;
  return {
    code,
    name: data.name || code,
    close,
    closeSource: "fugle-ws",
    change,
    percent: cleanNumber(data.changePercent) || (prevClose ? (change / prevClose) * 100 : 0),
    open: cleanNumber(data.openPrice),
    high: cleanNumber(data.highPrice || close),
    low: cleanNumber(data.lowPrice || close),
    prevClose,
    tradeVolume: cleanNumber(data.total?.tradeVolume),
    tradeValue: cleanNumber(data.total?.tradeValue),
    bidPrice: cleanNumber(data.bids?.[0]?.price),
    bidSize: cleanNumber(data.bids?.[0]?.size),
    askPrice: cleanNumber(data.asks?.[0]?.price),
    askSize: cleanNumber(data.asks?.[0]?.size),
    cumulativeBidVolume: cleanNumber(
      data.cumulativeBidVolume
        ?? data.cumulative_bid_volume
        ?? data.bidTradeVolume
        ?? data.bid_trade_volume
        ?? data.innerVolume
        ?? data.inner_volume
        ?? data.totalBidVolume
        ?? data.total_bid_volume
    ) || null,
    cumulativeAskVolume: cleanNumber(
      data.cumulativeAskVolume
        ?? data.cumulative_ask_volume
        ?? data.askTradeVolume
        ?? data.ask_trade_volume
        ?? data.outerVolume
        ?? data.outer_volume
        ?? data.totalAskVolume
        ?? data.total_ask_volume
    ) || null,
    market: data.market || data.exchange || "",
    time: taipeiTimeFromEpochMicros(timeValue),
    quoteTime: taipeiTimeFromEpochMicros(timeValue),
    quoteSeenAt: new Date().toISOString(),
    quoteSource: "fugle-ws",
    realtimeFallback: "fugle-ws",
    recoveredFromRealtimeFallback: true,
  };
}

function normalizeFugleTrade(payload) {
  const data = payload?.data || payload || {};
  const code = String(data.symbol || "").replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(code)) return null;
  const price = cleanNumber(data.price || data.lastPrice || data.closePrice);
  if (!price) return null;
  const timeValue = data.time || data.lastUpdated || data.lastTrade?.time;
  return {
    code,
    name: data.name || code,
    close: price,
    closeSource: "fugle-ws-trades",
    change: cleanNumber(data.change),
    percent: cleanNumber(data.changePercent),
    open: cleanNumber(data.openPrice),
    high: cleanNumber(data.highPrice || price),
    low: cleanNumber(data.lowPrice || price),
    prevClose: cleanNumber(data.previousClose || data.referencePrice),
    tradeVolume: cleanNumber(data.volume),
    tradeValue: 0,
    bidPrice: cleanNumber(data.bid),
    bidSize: 0,
    askPrice: cleanNumber(data.ask),
    askSize: 0,
    cumulativeBidVolume: null,
    cumulativeAskVolume: null,
    market: data.market || data.exchange || "",
    time: taipeiTimeFromEpochMicros(timeValue),
    quoteTime: taipeiTimeFromEpochMicros(timeValue),
    quoteSeenAt: new Date().toISOString(),
    quoteSource: "fugle-ws-trades",
    realtimeFallback: "fugle-ws-trades",
    recoveredFromRealtimeFallback: true,
    tradeSerial: data.serial || null,
    tradeSize: cleanNumber(data.size),
  };
}

function normalizeFugleCandle(payload) {
  const data = payload?.data || payload || {};
  const code = String(data.symbol || "").replace(/\D/g, "").slice(0, 4);
  if (!/^\d{4}$/.test(code)) return null;
  const candleTime = data.date || data.candleTime || data.time || "";
  const close = cleanNumber(data.close);
  if (!candleTime || !close) return null;
  return {
    code,
    symbol: code,
    market: data.market || data.exchange || "",
    candleTime,
    tradeDate: taipeiDate(candleTime),
    open: cleanNumber(data.open),
    high: cleanNumber(data.high),
    low: cleanNumber(data.low),
    close,
    volume: cleanNumber(data.volume),
    average: cleanNumber(data.average),
    candleSeenAt: new Date().toISOString(),
    source: "fugle-ws-candles",
    payload: data,
  };
}

function taipeiDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function writeFugleWebSocketSymbols(codes, meta = {}) {
  const current = readJson(FUGLE_WS_SYMBOLS_FILE, {});
  const currentAgeMs = Date.now() - Date.parse(current.updatedAt || "");
  const recentCurrent = Number.isFinite(currentAgeMs) && currentAgeMs <= 15 * 1000
    ? (current.symbols || [])
    : [];
  const symbols = [...new Set([...(codes || []), ...recentCurrent]
    .map((code) => String(code || "").replace(/\D/g, "").slice(0, 4))
    .filter((code) => /^\d{4}$/.test(code)))];
  writeJson(FUGLE_WS_SYMBOLS_FILE, {
    updatedAt: new Date().toISOString(),
    symbols,
    count: symbols.length,
    ...meta,
  });
}

function readFugleWebSocketQuotes(options = {}) {
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || 10 * 1000));
  const payload = readJson(FUGLE_WS_QUOTES_FILE, {});
  const rows = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const now = Date.now();
  const quotes = new Map();
  for (const row of rows) {
    const seenAt = Date.parse(row.quoteSeenAt || row.updatedAt || payload.updatedAt || "");
    if (!Number.isFinite(seenAt) || now - seenAt > maxAgeMs) continue;
    if (/^\d{4}$/.test(String(row.code || "")) && cleanNumber(row.close) > 0) {
      quotes.set(String(row.code), row);
    }
  }
  return { quotes, payload };
}

function readFugleWebSocketCandles(options = {}) {
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || 5 * 60 * 1000));
  const payload = readJson(FUGLE_WS_CANDLES_FILE, {});
  const rows = Array.isArray(payload?.candles) ? payload.candles : [];
  const now = Date.now();
  const candles = new Map();
  for (const row of rows) {
    const seenAt = Date.parse(row.candleSeenAt || row.updatedAt || payload.updatedAt || "");
    if (!Number.isFinite(seenAt) || now - seenAt > maxAgeMs) continue;
    const code = String(row.code || row.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (/^\d{4}$/.test(code) && cleanNumber(row.close) > 0 && row.candleTime) {
      candles.set(`${code}|${row.candleTime}`, row);
    }
  }
  return { candles, payload };
}

module.exports = {
  FUGLE_WS_CANDLES_FILE,
  FUGLE_WS_QUOTES_FILE,
  FUGLE_WS_STATUS_FILE,
  FUGLE_WS_SYMBOLS_FILE,
  cleanNumber,
  normalizeFugleAggregate,
  normalizeFugleCandle,
  normalizeFugleTrade,
  readFugleWebSocketCandles,
  readFugleWebSocketQuotes,
  readJson,
  writeFugleWebSocketSymbols,
  writeJson,
};
