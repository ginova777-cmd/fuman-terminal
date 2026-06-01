const fs = require("fs");
const path = require("path");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://mis.twse.com.tw/",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const FUGLE_API_KEY = process.env.FUGLE_API_KEY
  || process.env.FUGLE_MARKETDATA_API_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt"));
const UPSTREAM_CODE_CHUNK_SIZE = Math.max(1, Number(process.env.REALTIME_UPSTREAM_CODE_CHUNK_SIZE || 8));
const UPSTREAM_TIMEOUT_MS = Math.max(2000, Number(process.env.REALTIME_UPSTREAM_TIMEOUT_MS || 6500));
const FALLBACK_CODE_LIMIT = Math.max(0, Number(process.env.REALTIME_FALLBACK_CODE_LIMIT || 60));
const YAHOO_FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.REALTIME_YAHOO_FALLBACK_CONCURRENCY || 8));
const FUGLE_FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.REALTIME_FUGLE_FALLBACK_CONCURRENCY || 4));

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function priceLevels(value) {
  return String(value ?? "")
    .split("_")
    .map(cleanNumber)
    .filter((number) => number > 0);
}

function firstPositive(...values) {
  for (const value of values) {
    const number = priceLevels(value)[0] || cleanNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

function parseQuote(item) {
  const code = String(item?.c || "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const close = firstPositive(item.z, item.pz, item.o, item.h, item.l, item.y);
  const prevClose = cleanNumber(item.y);
  if (!close || !prevClose) return null;
  const closeSource = priceLevels(item.z)[0]
    ? "z"
    : priceLevels(item.pz)[0]
      ? "pz"
      : cleanNumber(item.o)
        ? "open"
        : cleanNumber(item.h)
          ? "high"
          : cleanNumber(item.l)
            ? "low"
            : "prevClose";
  const change = close - prevClose;
  return {
    code,
    name: item.n || code,
    close,
    closeSource,
    change,
    percent: prevClose ? (change / prevClose) * 100 : 0,
    open: cleanNumber(item.o),
    high: firstPositive(item.h, item.z, item.pz, item.o, item.y),
    low: firstPositive(item.l, item.z, item.pz, item.o, item.y),
    prevClose,
    limitUp: cleanNumber(item.u),
    limitDown: cleanNumber(item.w),
    tradeVolume: firstPositive(item.v, item.tv),
    market: item.ex || "",
    time: item.t || "",
    quoteSource: "twse-mis",
  };
}

function addQuote(byCode, item) {
  const quote = parseQuote(item);
  if (!quote) return;
  const previous = byCode.get(quote.code);
  if (!previous || quote.close || quote.tradeVolume) byCode.set(quote.code, quote);
}

async function fetchCodeChunk(codes) {
  const channels = codes.flatMap((code) => [`tse_${code}.tw`, `otc_${code}.tw`]);
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0`;
  return await fetchWithTimeout(url, {}, UPSTREAM_TIMEOUT_MS);
}

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 4);
}

function toTaipeiTimeText(timestampSeconds) {
  if (!timestampSeconds) return "";
  return new Date(Number(timestampSeconds) * 1000).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

async function fetchFugleQuote(code) {
  if (!FUGLE_API_KEY) return null;
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(code)}`;
  const payload = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "FumanRealtimeFallback/1.0",
      "X-API-KEY": FUGLE_API_KEY,
      "Referer": "https://developer.fugle.tw/",
    },
  }, 8000);
  const close = cleanNumber(payload.closePrice || payload.close || payload.lastPrice || payload.price);
  const prevClose = cleanNumber(payload.referencePrice || payload.previousClose || payload.prevClose || payload.previousPrice);
  if (!close || !prevClose) return null;
  const change = cleanNumber(payload.change) || (close - prevClose);
  return {
    code: normalizeCode(payload.symbol || code),
    name: payload.name || String(code),
    close,
    closeSource: "fugle",
    change,
    percent: cleanNumber(payload.changePercent) || (prevClose ? (change / prevClose) * 100 : 0),
    open: cleanNumber(payload.openPrice || payload.open),
    high: cleanNumber(payload.highPrice || payload.high || close),
    low: cleanNumber(payload.lowPrice || payload.low || close),
    prevClose,
    tradeVolume: cleanNumber(payload.total?.tradeVolume || payload.tradeVolume || payload.volume),
    market: payload.exchange || payload.market || "",
    time: payload.lastUpdated || payload.lastTradeTime || payload.time || "",
    quoteSource: "fugle",
    realtimeFallback: "fugle",
  };
}

async function fetchYahooQuote(code) {
  for (const suffix of ["TW", "TWO"]) {
    const symbol = `${code}.${suffix}`;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
      const payload = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "FumanRealtimeFallback/1.0",
          "Referer": "https://finance.yahoo.com/",
        },
      }, 9000);
      const result = payload?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0] || {};
      const closes = quote.close || [];
      const lastIndex = closes.findLastIndex((value) => cleanNumber(value) > 0);
      if (lastIndex < 0) continue;
      const close = cleanNumber(closes[lastIndex]);
      const prevClose = cleanNumber(result?.meta?.previousClose || result?.meta?.chartPreviousClose);
      if (!close || !prevClose) continue;
      const volumes = quote.volume || [];
      const highs = (quote.high || []).map(cleanNumber).filter((value) => value > 0);
      const lows = (quote.low || []).map(cleanNumber).filter((value) => value > 0);
      const change = close - prevClose;
      return {
        code: String(code),
        name: String(code),
        close,
        closeSource: "yahoo-chart",
        change,
        percent: prevClose ? (change / prevClose) * 100 : 0,
        open: cleanNumber((quote.open || []).find((value) => cleanNumber(value) > 0)),
        high: highs.length ? Math.max(...highs) : close,
        low: lows.length ? Math.min(...lows) : close,
        prevClose,
        tradeVolume: volumes.reduce((sum, value) => sum + cleanNumber(value), 0),
        market: suffix === "TWO" ? "otc" : "tse",
        time: toTaipeiTimeText(timestamps[lastIndex]),
        quoteSource: "yahoo-chart",
        realtimeFallback: "yahoo-chart",
      };
    } catch (error) {
      if (suffix === "TWO") throw error;
    }
  }
  return null;
}

async function fillFallbackQuotes(codes, byCode, errors) {
  const missing = codes.filter((code) => !byCode.has(code)).slice(0, FALLBACK_CODE_LIMIT);
  const recovered = { fugle: 0, yahoo: 0 };
  if (!missing.length) return recovered;

  let fugleCursor = 0;
  let fugleRateLimited = false;
  async function fugleWorker() {
    while (fugleCursor < missing.length && !fugleRateLimited) {
      const code = missing[fugleCursor++];
      if (byCode.has(code)) continue;
      try {
        const quote = await fetchFugleQuote(code);
        if (quote?.close) {
          byCode.set(code, quote);
          recovered.fugle += 1;
        }
      } catch (error) {
        if (/HTTP (?:401|403|429)/i.test(String(error.message || ""))) {
          fugleRateLimited = true;
          errors.push({ source: "fugle", range: code, size: 1, error: error.message });
        }
      }
    }
  }
  if (FUGLE_API_KEY) {
    await Promise.all(Array.from({ length: Math.min(FUGLE_FALLBACK_CONCURRENCY, missing.length) }, () => fugleWorker()));
  }

  const yahooTargets = missing.filter((code) => !byCode.has(code));
  let yahooCursor = 0;
  async function yahooWorker() {
    while (yahooCursor < yahooTargets.length) {
      const code = yahooTargets[yahooCursor++];
      if (byCode.has(code)) continue;
      try {
        const quote = await fetchYahooQuote(code);
        if (quote?.close) {
          byCode.set(code, quote);
          recovered.yahoo += 1;
        }
      } catch (error) {
        errors.push({ source: "yahoo", range: code, size: 1, error: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(YAHOO_FALLBACK_CONCURRENCY, yahooTargets.length) }, () => yahooWorker()));
  return recovered;
}

async function fetchQuotes(codes) {
  const byCode = new Map();
  const errors = [];
  for (let index = 0; index < codes.length; index += UPSTREAM_CODE_CHUNK_SIZE) {
    const chunk = codes.slice(index, index + UPSTREAM_CODE_CHUNK_SIZE);
    const label = `${chunk[0]}-${chunk.at(-1)}`;
    try {
      const data = await fetchCodeChunk(chunk);
      for (const item of data?.msgArray || []) addQuote(byCode, item);
      continue;
    } catch (error) {
      errors.push({ source: "twse-mis", range: label, size: chunk.length, error: error.message });
    }
  }
  const fallbackRecovered = await fillFallbackQuotes(codes, byCode, errors);
  return { byCode, errors, fallbackRecovered };
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const codes = String(request.query?.codes || "")
    .split(",")
    .map((code) => code.replace(/\D/g, "").slice(0, 4))
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, 100);

  if (!codes.length) {
    response.status(400).json({ ok: false, error: "Missing codes", quotes: [] });
    return;
  }

  try {
    const { byCode, errors, fallbackRecovered } = await fetchQuotes(codes);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      partial: errors.length > 0 || byCode.size < codes.length,
      updatedAt: new Date().toISOString(),
      requested: codes.length,
      count: byCode.size,
      source: "twse-mis+fallback",
      fallbackRecovered,
      quotes: [...byCode.values()],
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, quotes: [] });
  }
};
