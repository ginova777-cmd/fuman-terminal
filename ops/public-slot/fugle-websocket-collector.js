const fs = require("fs");
const path = require("path");

const {
  FUGLE_WS_QUOTES_FILE,
  FUGLE_WS_STATUS_FILE,
  FUGLE_WS_SYMBOLS_FILE,
  cleanNumber,
  readJson,
  writeJson,
} = require("../lib/fugle-websocket-quotes");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const API_KEY_FILES = [
  path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt"),
  "C:/fuman-terminal/secrets/fugle-api-key.txt",
];
const LOOP_MS = Math.max(3000, Number(process.env.FUGLE_COLLECTOR_LOOP_MS || 5000));
const BATCH_SIZE = Math.max(1, Number(process.env.FUGLE_COLLECTOR_BATCH_SIZE || 60));
const QUOTE_TTL_MS = Math.max(30000, Number(process.env.FUGLE_COLLECTOR_QUOTE_TTL_MS || 180000));

let cursor = 0;
let lastMessageAt = "";
let last429At = "";
let cooldownUntil = 0;

function readSecret(paths) {
  for (const file of paths) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function nowIso() {
  return new Date().toISOString();
}

function volumeToLots(value) {
  const number = cleanNumber(value);
  if (!number) return 0;
  return number > 100000 ? Math.round((number / 1000) * 1000) / 1000 : number;
}

function readSymbols() {
  const payload = readJson(FUGLE_WS_SYMBOLS_FILE, {});
  return [...new Set((payload.symbols || [])
    .map(normalizeCode)
    .filter((code) => /^\d{4}$/.test(code) && !code.startsWith("00")))];
}

function writeStatus(extra = {}) {
  writeJson(FUGLE_WS_STATUS_FILE, {
    ok: extra.ok !== false,
    pid: process.pid,
    channel: "rest-quote-collector",
    subscribed: extra.subscribed || 0,
    pending: extra.pending || 0,
    quotes: extra.quotes || 0,
    lastMessageAt,
    last429At,
    cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : "",
    updatedAt: nowIso(),
    ...extra,
  });
}

function mergeQuotes(newQuotes) {
  const current = readJson(FUGLE_WS_QUOTES_FILE, {});
  const rows = Array.isArray(current.quotes) ? current.quotes : [];
  const cutoff = Date.now() - QUOTE_TTL_MS;
  const byCode = new Map();
  for (const row of rows) {
    const seen = Date.parse(row.quoteSeenAt || row.updatedAt || current.updatedAt || "");
    const code = normalizeCode(row.code);
    if (/^\d{4}$/.test(code) && Number.isFinite(seen) && seen >= cutoff) {
      byCode.set(code, row);
    }
  }
  for (const quote of newQuotes) byCode.set(quote.code, quote);
  const quotes = [...byCode.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  writeJson(FUGLE_WS_QUOTES_FILE, {
    source: "fugle-rest-collector",
    channel: "rest-quote-collector",
    updatedAt: nowIso(),
    count: quotes.length,
    quotes,
  });
  return quotes.length;
}

function normalizeQuote(payload, requestedCode) {
  const code = normalizeCode(payload?.symbol || requestedCode);
  if (!/^\d{4}$/.test(code)) return null;
  const prevClose = cleanNumber(payload?.previousClose || payload?.referencePrice);
  const close = cleanNumber(payload?.lastPrice || payload?.closePrice || payload?.lastTrial?.price || payload?.referencePrice || prevClose);
  if (!close || !prevClose) return null;
  const bid = Array.isArray(payload?.bids) ? payload.bids[0] : null;
  const ask = Array.isArray(payload?.asks) ? payload.asks[0] : null;
  const updatedAt = payload?.lastUpdated || nowIso();
  const bidCum = volumeToLots(payload?.total?.tradeVolumeAtBid);
  const askCum = volumeToLots(payload?.total?.tradeVolumeAtAsk);
  return {
    code,
    name: payload?.name || code,
    close,
    closeSource: "fugle-rest-collector",
    change: cleanNumber(payload?.change) || close - prevClose,
    percent: cleanNumber(payload?.changePercent) || ((close - prevClose) / prevClose) * 100,
    open: cleanNumber(payload?.openPrice),
    high: cleanNumber(payload?.highPrice || close),
    low: cleanNumber(payload?.lowPrice || close),
    prevClose,
    tradeVolume: volumeToLots(payload?.total?.tradeVolume || payload?.tradeVolume || payload?.volume),
    tradeValue: cleanNumber(payload?.total?.tradeValue),
    bidPrice: cleanNumber(bid?.price),
    bidSize: volumeToLots(bid?.size),
    askPrice: cleanNumber(ask?.price),
    askSize: volumeToLots(ask?.size),
    cumulativeBidVolume: bidCum || null,
    cumulativeAskVolume: askCum || null,
    cumulativeBidAskVolume: bidCum || askCum ? bidCum + askCum : null,
    market: payload?.market || payload?.exchange || "",
    time: updatedAt,
    quoteTime: updatedAt,
    quoteSeenAt: nowIso(),
    updatedAt,
    quoteSource: "fugle-rest-collector",
    realtimeFallback: "fugle-rest-collector",
    recoveredFromRealtimeFallback: true,
    isTrial: Boolean(payload?.isTrial),
    referencePrice: cleanNumber(payload?.referencePrice),
    trialPrice: cleanNumber(payload?.lastTrial?.price),
  };
}

async function fetchQuote(code, apiKey) {
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      "X-API-KEY": apiKey,
      "User-Agent": "FumanPublicSlotRestCollector/1.0",
      "Referer": "https://developer.fugle.tw/",
    },
  });
  if (response.status === 429) {
    last429At = nowIso();
    cooldownUntil = Date.now() + 60000;
    throw new Error("429 Too Many Requests");
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function tick() {
  const apiKey = readSecret(API_KEY_FILES);
  const symbols = readSymbols();
  if (!apiKey) {
    writeStatus({ ok: false, subscribed: symbols.length, error: "fugle api key missing" });
    return;
  }
  if (!symbols.length) {
    writeStatus({ ok: false, subscribed: 0, error: "symbols missing" });
    return;
  }
  if (Date.now() < cooldownUntil) {
    const existing = readJson(FUGLE_WS_QUOTES_FILE, {});
    writeStatus({ subscribed: symbols.length, quotes: existing.count || 0, cooldown: true });
    return;
  }

  if (cursor < 0 || cursor >= symbols.length) cursor = 0;
  const batch = [];
  for (let i = 0; i < Math.min(BATCH_SIZE, symbols.length); i += 1) {
    batch.push(symbols[(cursor + i) % symbols.length]);
  }

  const quotes = [];
  for (const code of batch) {
    try {
      const payload = await fetchQuote(code, apiKey);
      const quote = normalizeQuote(payload, code);
      if (quote) quotes.push(quote);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (error) {
      if (String(error?.message || "").includes("429")) break;
    }
  }
  cursor = (cursor + Math.max(1, batch.length)) % symbols.length;
  if (quotes.length) lastMessageAt = nowIso();
  const count = mergeQuotes(quotes);
  writeStatus({
    subscribed: symbols.length,
    pending: Math.max(0, symbols.length - count),
    quotes: count,
    fetched: quotes.length,
    attempted: batch.length,
    cursor,
  });
}

async function main() {
  writeStatus({ subscribed: readSymbols().length, quotes: 0, starting: true });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (error) {
      writeStatus({ ok: false, subscribed: readSymbols().length, error: error?.message || String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  }
}

main();
