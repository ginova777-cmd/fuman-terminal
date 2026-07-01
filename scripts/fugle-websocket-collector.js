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
const LOOP_MS = Math.max(1000, Number(process.env.FUGLE_COLLECTOR_LOOP_MS || 1000));
const BATCH_SIZE = Math.max(1, Number(process.env.FUGLE_COLLECTOR_BATCH_SIZE || 320));
const PER_SYMBOL_DELAY_MS = Math.max(0, Number(process.env.FUGLE_COLLECTOR_REQUEST_DELAY_MS || process.env.FUGLE_COLLECTOR_PER_SYMBOL_DELAY_MS || 20));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.FUGLE_COLLECTOR_CONCURRENCY || 4)));
const QUOTE_TTL_MS = Math.max(30000, Number(process.env.FUGLE_COLLECTOR_QUOTE_TTL_MS || 120000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.FUGLE_COLLECTOR_REQUEST_TIMEOUT_MS || 15000));
const REQUEST_RETRIES = Math.max(0, Number(process.env.FUGLE_COLLECTOR_REQUEST_RETRIES || 2));
const REQUEST_RETRY_BACKOFF_MS = Math.max(100, Number(process.env.FUGLE_COLLECTOR_RETRY_BACKOFF_MS || 500));
const OPENING_BOOST_START = process.env.FUGLE_COLLECTOR_OPENING_BOOST_START || "08:45";
const OPENING_BOOST_END = process.env.FUGLE_COLLECTOR_OPENING_BOOST_END || "10:30";
const OPENING_BOOST_BATCH_SIZE = Math.max(BATCH_SIZE, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE || 1200));
const OPENING_BOOST_CONCURRENCY = Math.max(CONCURRENCY, Math.min(12, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_CONCURRENCY || 8)));
const OPENING_BOOST_DELAY_MS = Math.max(0, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_DELAY_MS || 0));
const OPENING_BOOST_TARGET_COVERAGE = Math.max(0.5, Math.min(1, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_TARGET_COVERAGE || 0.95)));

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
    loopMs: LOOP_MS,
    batchSize: BATCH_SIZE,
    perSymbolDelayMs: PER_SYMBOL_DELAY_MS,
    concurrency: CONCURRENCY,
    quoteTtlMs: QUOTE_TTL_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    requestRetries: REQUEST_RETRIES,
    openingBoostStart: OPENING_BOOST_START,
    openingBoostEnd: OPENING_BOOST_END,
    openingBoostBatchSize: OPENING_BOOST_BATCH_SIZE,
    openingBoostConcurrency: OPENING_BOOST_CONCURRENCY,
    openingBoostDelayMs: OPENING_BOOST_DELAY_MS,
    lastMessageAt,
    last429At,
    cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : "",
    updatedAt: nowIso(),
    ...extra,
  });
}

function minutesFromHHmm(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function taipeiMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function inOpeningBoostWindow() {
  const now = taipeiMinutesNow();
  const start = minutesFromHHmm(OPENING_BOOST_START, 8 * 60 + 45);
  const end = minutesFromHHmm(OPENING_BOOST_END, 10 * 60 + 30);
  return now >= start && now <= end;
}

function countFreshCachedQuotes(symbols) {
  const symbolSet = new Set(symbols);
  const payload = readJson(FUGLE_WS_QUOTES_FILE, {});
  const rows = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const cutoff = Date.now() - QUOTE_TTL_MS;
  let count = 0;
  for (const row of rows) {
    const code = normalizeCode(row?.code);
    const seen = Date.parse(row?.quoteSeenAt || row?.updatedAt || payload?.updatedAt || "");
    if (symbolSet.has(code) && Number.isFinite(seen) && seen >= cutoff) count += 1;
  }
  return count;
}

function effectiveCollectorConfig(symbols) {
  const freshCount = countFreshCachedQuotes(symbols);
  const coverage = symbols.length ? freshCount / symbols.length : 0;
  const openingBoostActive = inOpeningBoostWindow() && coverage < OPENING_BOOST_TARGET_COVERAGE;
  return {
    openingBoostActive,
    freshCount,
    coverage,
    batchSize: openingBoostActive ? Math.min(symbols.length, Math.max(BATCH_SIZE, OPENING_BOOST_BATCH_SIZE)) : BATCH_SIZE,
    concurrency: openingBoostActive ? OPENING_BOOST_CONCURRENCY : CONCURRENCY,
    delayMs: openingBoostActive ? Math.min(PER_SYMBOL_DELAY_MS, OPENING_BOOST_DELAY_MS) : PER_SYMBOL_DELAY_MS,
  };
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
  let lastError = null;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
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
    } catch (error) {
      lastError = error?.name === "AbortError" ? new Error(`timeout ${REQUEST_TIMEOUT_MS}ms`) : error;
      const retryable = /timeout|aborted|429|5\d\d|ECONNRESET|ETIMEDOUT/i.test(String(lastError?.message || lastError || ""));
      if (attempt >= REQUEST_RETRIES || !retryable) break;
      await new Promise((resolve) => setTimeout(resolve, REQUEST_RETRY_BACKOFF_MS * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("quote fetch failed");
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
  const effective = effectiveCollectorConfig(symbols);
  const batch = [];
  for (let i = 0; i < Math.min(effective.batchSize, symbols.length); i += 1) {
    batch.push(symbols[(cursor + i) % symbols.length]);
  }

  const quotes = [];
  for (let offset = 0; offset < batch.length; offset += effective.concurrency) {
    const chunk = batch.slice(offset, offset + effective.concurrency);
    const results = await Promise.all(chunk.map(async (code) => {
      try {
        const payload = await fetchQuote(code, apiKey);
        return normalizeQuote(payload, code);
      } catch (error) {
        if (String(error?.message || "").includes("429")) {
          last429At = nowIso();
          cooldownUntil = Date.now() + 60000;
        }
        return null;
      }
    }));
    for (const quote of results) {
      if (quote) quotes.push(quote);
    }
    if (cooldownUntil && Date.now() < cooldownUntil) break;
    if (effective.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, effective.delayMs));
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
    openingBoostActive: effective.openingBoostActive,
    openingBoostFreshCount: effective.freshCount,
    openingBoostCoverage: Number(effective.coverage.toFixed(4)),
    batchSize: effective.batchSize,
    concurrency: effective.concurrency,
    perSymbolDelayMs: effective.delayMs,
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
