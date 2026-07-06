const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CACHE_DIR = process.env.FUMAN_CACHE_DIR || path.join(RUNTIME_DIR, "cache");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");

const FUGLE_FUTOPT_WS_QUOTES_FILE = path.join(CACHE_DIR, "intraday", "fugle-futopt-ws-quotes.json");
const FUGLE_FUTOPT_WS_CANDLES_FILE = path.join(CACHE_DIR, "intraday", "fugle-futopt-ws-candles.json");
const FUGLE_FUTOPT_WS_STATUS_FILE = path.join(STATE_DIR, "fugle-futopt-websocket-status.json");

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

function normalizeFutureSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function normalizeCode(value) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(text) ? text : "";
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" || /^\d{10,17}$/.test(String(value).trim())) {
    const raw = Number(value);
    const millis = raw > 1e15 ? raw / 1000 : raw > 1e12 ? raw : raw > 1e10 ? raw : raw * 1000;
    const date = new Date(millis);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
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

function normalizeFutoptQuote(payload, ticker = null) {
  const data = payload?.data || payload || {};
  const futureSymbol = normalizeFutureSymbol(data.symbol || data.future_symbol);
  if (!futureSymbol) return null;
  const previousClose = cleanNumber(data.previousClose || data.referencePrice || data.reference_price);
  const price = cleanNumber(data.lastPrice || data.closePrice || data.close || data.price || data.lastTrade?.price);
  const change = cleanNumber(data.change);
  const lastPrice = price || (previousClose ? previousClose + change : 0);
  if (!lastPrice) return null;
  const updatedAt = normalizeTimestamp(data.lastUpdated || data.lastTrade?.time || data.time || data.date);
  const underlyingSymbol = normalizeCode(ticker?.underlying_symbol || data.underlying_symbol)
    || (futureSymbol.startsWith("TXF") ? "TXF" : "");
  return {
    future_symbol: futureSymbol,
    underlying_symbol: underlyingSymbol,
    underlying_name: ticker?.underlying_name || data.underlying_name || (futureSymbol.startsWith("TXF") ? "TAIEX" : ""),
    updated_at: updatedAt,
    last_price: lastPrice,
    open_price: cleanNumber(data.openPrice || data.open),
    high_price: cleanNumber(data.highPrice || data.high || lastPrice),
    low_price: cleanNumber(data.lowPrice || data.low || lastPrice),
    previous_close: previousClose || null,
    change_percent: cleanNumber(data.changePercent),
    total_volume: cleanNumber(data.total?.tradeVolume || data.totalVolume || data.volume),
    product: ticker?.product || (futureSymbol.startsWith("TXF") ? "TXF" : "STOCK_FUTURE"),
    session: data.session || ticker?.session || "",
    quoteSeenAt: new Date().toISOString(),
    source: "fugle-futopt-ws",
    payload: data,
  };
}

function normalizeFutoptCandle(payload, ticker = null) {
  const data = payload?.data || payload || {};
  const futureSymbol = normalizeFutureSymbol(data.symbol || data.future_symbol);
  if (!futureSymbol) return null;
  const candleTime = normalizeTimestamp(data.date || data.candleTime || data.time, "");
  const close = cleanNumber(data.close);
  if (!candleTime || !close) return null;
  return {
    future_symbol: futureSymbol,
    underlying_symbol: normalizeCode(ticker?.underlying_symbol || data.underlying_symbol) || (futureSymbol.startsWith("TXF") ? "TXF" : ""),
    candle_time: candleTime,
    trade_date: taipeiDate(candleTime),
    open: cleanNumber(data.open),
    high: cleanNumber(data.high),
    low: cleanNumber(data.low),
    close,
    volume: cleanNumber(data.volume),
    average: cleanNumber(data.average),
    candleSeenAt: new Date().toISOString(),
    source: "fugle-futopt-ws-candles",
    payload: data,
  };
}

function readFugleFutoptWebSocketQuotes(options = {}) {
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || 5 * 60 * 1000));
  const payload = readJson(FUGLE_FUTOPT_WS_QUOTES_FILE, {});
  const rows = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const now = Date.now();
  const quotes = new Map();
  for (const row of rows) {
    const seenAt = Date.parse(row.quoteSeenAt || row.updated_at || payload.updatedAt || "");
    if (!Number.isFinite(seenAt) || now - seenAt > maxAgeMs) continue;
    const futureSymbol = normalizeFutureSymbol(row.future_symbol);
    if (futureSymbol && cleanNumber(row.last_price) > 0) quotes.set(futureSymbol, row);
  }
  return { quotes, payload };
}

function readFugleFutoptWebSocketCandles(options = {}) {
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || 10 * 60 * 1000));
  const payload = readJson(FUGLE_FUTOPT_WS_CANDLES_FILE, {});
  const rows = Array.isArray(payload?.candles) ? payload.candles : [];
  const now = Date.now();
  const candles = new Map();
  for (const row of rows) {
    const seenAt = Date.parse(row.candleSeenAt || row.updated_at || payload.updatedAt || "");
    if (!Number.isFinite(seenAt) || now - seenAt > maxAgeMs) continue;
    const futureSymbol = normalizeFutureSymbol(row.future_symbol);
    const candleTime = row.candle_time || row.candleTime || row.date || "";
    if (futureSymbol && candleTime && cleanNumber(row.close) > 0) {
      candles.set(`${futureSymbol}|${candleTime}`, row);
    }
  }
  return { candles, payload };
}

module.exports = {
  FUGLE_FUTOPT_WS_CANDLES_FILE,
  FUGLE_FUTOPT_WS_QUOTES_FILE,
  FUGLE_FUTOPT_WS_STATUS_FILE,
  cleanNumber,
  normalizeFutureSymbol,
  normalizeFutoptCandle,
  normalizeFutoptQuote,
  readFugleFutoptWebSocketCandles,
  readFugleFutoptWebSocketQuotes,
  readJson,
  writeJson,
};
