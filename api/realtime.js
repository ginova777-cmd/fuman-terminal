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
const FINMIND_API_TOKEN = process.env.FINMIND_API_TOKEN
  || process.env.FINMIND_TOKEN
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "finmind-api-token.txt"));
const UPSTREAM_CODE_CHUNK_SIZE = Math.max(1, Number(process.env.REALTIME_UPSTREAM_CODE_CHUNK_SIZE || 8));
const UPSTREAM_TIMEOUT_MS = Math.max(2000, Number(process.env.REALTIME_UPSTREAM_TIMEOUT_MS || 6500));
const FALLBACK_CODE_LIMIT = Math.max(0, Number(process.env.REALTIME_FALLBACK_CODE_LIMIT || 60));
const YAHOO_FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.REALTIME_YAHOO_FALLBACK_CONCURRENCY || 8));
const FUGLE_FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.REALTIME_FUGLE_FALLBACK_CONCURRENCY || 4));
const FUGLE_PRIMARY_CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.REALTIME_FUGLE_PRIMARY_CONCURRENCY || 12)));
const FUGLE_PRIMARY_TIMEOUT_MS = Math.max(1500, Number(process.env.REALTIME_FUGLE_PRIMARY_TIMEOUT_MS || 3500));
const FUGLE_PRIMARY_BUDGET_MS = Math.max(2500, Number(process.env.REALTIME_FUGLE_PRIMARY_BUDGET_MS || 8000));
const FINMIND_FALLBACK_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.REALTIME_FINMIND_FALLBACK_CONCURRENCY || 8)));
const FINMIND_FALLBACK_TIMEOUT_MS = Math.max(2000, Number(process.env.REALTIME_FINMIND_FALLBACK_TIMEOUT_MS || 5000));
const FINMIND_FALLBACK_BUDGET_MS = Math.max(2500, Number(process.env.REALTIME_FINMIND_FALLBACK_BUDGET_MS || 7000));
const REALTIME_QUOTE_SOURCE_ORDER = String(process.env.REALTIME_QUOTE_SOURCE_ORDER || process.env.REALTIME_QUOTE_PRIMARY || "fugle,finmind,twse-mis,yahoo-chart");

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

function toTaipeiTimeTextFromValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1e14 ? numeric / 1000 : numeric > 1e11 ? numeric : numeric * 1000;
    return new Date(ms).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
  }
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
  }
  const match = String(value || "").match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (match) return match[1].length === 5 ? `${match[1]}:00` : match[1];
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

function toTaipeiTimeText(timestampSeconds) {
  if (!timestampSeconds) return "";
  return new Date(Number(timestampSeconds) * 1000).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });
}

async function fetchFugleQuote(code, options = {}) {
  if (!FUGLE_API_KEY) return null;
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(code)}`;
  const payload = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "FumanRealtimeFallback/1.0",
      "X-API-KEY": FUGLE_API_KEY,
      "Referer": "https://developer.fugle.tw/",
    },
  }, options.timeout || 8000);
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
    time: toTaipeiTimeTextFromValue(payload.lastUpdated || payload.lastTradeTime || payload.time || ""),
    quoteSource: "fugle",
    realtimeFallback: "fugle",
  };
}

async function fetchFinMindSnapshotQuote(code, options = {}) {
  if (!FINMIND_API_TOKEN) return null;
  const url = new URL("https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot");
  url.searchParams.set("data_id", code);
  url.searchParams.set("token", FINMIND_API_TOKEN);
  const payload = await fetchWithTimeout(url.toString(), {
    headers: {
      "User-Agent": "FumanRealtimeFinMindFallback/1.0",
      "Referer": "https://finmindtrade.com/",
      "Authorization": `Bearer ${FINMIND_API_TOKEN}`,
    },
  }, options.timeout || FINMIND_FALLBACK_TIMEOUT_MS);
  if (payload?.status && Number(payload.status) >= 400) {
    throw new Error(`FinMind status ${payload.status}: ${payload.msg || ""}`.trim());
  }
  const row = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!row) return null;
  const close = cleanNumber(row.close ?? row.last_price ?? row.lastPrice ?? row.price);
  const change = cleanNumber(row.change_price ?? row.change ?? row.spread);
  const prevClose = cleanNumber(row.previous_close ?? row.prev_close ?? row.reference_price ?? row.yesterday_price)
    || (change ? close - change : 0)
    || cleanNumber(row.open)
    || close;
  if (!close || !prevClose) return null;
  const percent = cleanNumber(row.change_percent ?? row.change_rate)
    || (prevClose ? ((close - prevClose) / prevClose) * 100 : 0);
  return {
    code: normalizeCode(row.stock_id || row.symbol || row.code || code),
    name: row.name || row.stock_name || String(code),
    close,
    closeSource: "finmind",
    change: cleanNumber(row.change_price ?? row.change) || (close - prevClose),
    percent,
    open: cleanNumber(row.open),
    high: cleanNumber(row.high || close),
    low: cleanNumber(row.low || close),
    prevClose,
    tradeVolume: cleanNumber(row.volume || row.Trading_Volume || row.trading_volume || row.total_volume),
    market: row.type || row.market || "",
    time: toTaipeiTimeTextFromValue(row.time || row.datetime || row.date || new Date().toISOString()),
    quoteSource: "finmind",
    realtimeFallback: "finmind",
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

function normalizeSourceName(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "twse" || text === "mis" || text === "twse-mis") return "twse-mis";
  if (text === "yahoo") return "yahoo-chart";
  if (text === "finmind" || text === "fin-mind") return "finmind";
  if (text === "fugle") return "fugle";
  return "";
}

function quoteSourceOrder() {
  const text = REALTIME_QUOTE_SOURCE_ORDER.includes(",")
    ? REALTIME_QUOTE_SOURCE_ORDER
    : `${normalizeSourceName(REALTIME_QUOTE_SOURCE_ORDER) || "fugle"},finmind,twse-mis,yahoo-chart`;
  const sources = text.split(",").map(normalizeSourceName).filter(Boolean);
  return [...new Set([...sources, "finmind", "twse-mis", "yahoo-chart"])];
}

async function runSourceWorkers(codes, concurrency, budgetMs, worker) {
  let cursor = 0;
  let attempted = 0;
  const deadline = Date.now() + budgetMs;
  async function loop() {
    while (cursor < codes.length && Date.now() < deadline) {
      const code = codes[cursor++];
      attempted += 1;
      await worker(code);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, codes.length) }, () => loop()));
  return { attempted, skipped: Math.max(0, codes.length - attempted) };
}

async function fetchFugleQuotesForCodes(codes, byCode, errors) {
  const missing = codes.filter((code) => !byCode.has(code));
  if (!missing.length) return { recovered: 0, attempted: 0, skipped: 0 };
  if (!FUGLE_API_KEY) {
    errors.push({ source: "fugle", range: `${missing[0]}-${missing.at(-1)}`, size: missing.length, error: "missing Fugle API key" });
    return { recovered: 0, attempted: 0, skipped: missing.length };
  }
  let recovered = 0;
  let stop = false;
  const result = await runSourceWorkers(missing, FUGLE_PRIMARY_CONCURRENCY, FUGLE_PRIMARY_BUDGET_MS, async (code) => {
    if (stop || byCode.has(code)) return;
    try {
      const quote = await fetchFugleQuote(code, { timeout: FUGLE_PRIMARY_TIMEOUT_MS });
      if (quote?.close) {
        byCode.set(code, quote);
        recovered += 1;
      }
    } catch (error) {
      const message = error?.message || String(error);
      errors.push({ source: "fugle", range: code, size: 1, error: message });
      if (/HTTP (?:401|403|429)/i.test(message)) stop = true;
    }
  });
  if (result.skipped) {
    errors.push({ source: "fugle", range: `${missing[0]}-${missing.at(-1)}`, size: result.skipped, error: `budget exhausted ${FUGLE_PRIMARY_BUDGET_MS}ms` });
  }
  return { recovered, ...result };
}

async function fetchFinMindQuotesForCodes(codes, byCode, errors) {
  const missing = codes.filter((code) => !byCode.has(code));
  if (!missing.length) return { recovered: 0, attempted: 0, skipped: 0 };
  if (!FINMIND_API_TOKEN) {
    errors.push({ source: "finmind", range: `${missing[0]}-${missing.at(-1)}`, size: missing.length, error: "missing FinMind token" });
    return { recovered: 0, attempted: 0, skipped: missing.length };
  }
  let recovered = 0;
  const result = await runSourceWorkers(missing, FINMIND_FALLBACK_CONCURRENCY, FINMIND_FALLBACK_BUDGET_MS, async (code) => {
    if (byCode.has(code)) return;
    try {
      const quote = await fetchFinMindSnapshotQuote(code, { timeout: FINMIND_FALLBACK_TIMEOUT_MS });
      if (quote?.close) {
        byCode.set(code, quote);
        recovered += 1;
      }
    } catch (error) {
      errors.push({ source: "finmind", range: code, size: 1, error: error?.message || String(error) });
    }
  });
  if (result.skipped) {
    errors.push({ source: "finmind", range: `${missing[0]}-${missing.at(-1)}`, size: result.skipped, error: `budget exhausted ${FINMIND_FALLBACK_BUDGET_MS}ms` });
  }
  return { recovered, ...result };
}

async function fetchTwseMisQuotesForCodes(codes, byCode, errors) {
  const missing = codes.filter((code) => !byCode.has(code));
  let recovered = 0;
  for (let index = 0; index < missing.length; index += UPSTREAM_CODE_CHUNK_SIZE) {
    const chunk = missing.slice(index, index + UPSTREAM_CODE_CHUNK_SIZE);
    const label = `${chunk[0]}-${chunk.at(-1)}`;
    const before = byCode.size;
    try {
      const data = await fetchCodeChunk(chunk);
      for (const item of data?.msgArray || []) addQuote(byCode, item);
      recovered += Math.max(0, byCode.size - before);
    } catch (error) {
      errors.push({ source: "twse-mis", range: label, size: chunk.length, error: error.message });
    }
  }
  return { recovered, attempted: missing.length, skipped: 0 };
}

async function fetchYahooQuotesForCodes(codes, byCode, errors) {
  const missing = codes.filter((code) => !byCode.has(code)).slice(0, FALLBACK_CODE_LIMIT);
  if (!missing.length) return { recovered: 0, attempted: 0, skipped: 0 };
  let recovered = 0;
  let yahooCursor = 0;
  async function yahooWorker() {
    while (yahooCursor < missing.length) {
      const code = missing[yahooCursor++];
      if (byCode.has(code)) continue;
      try {
        const quote = await fetchYahooQuote(code);
        if (quote?.close) {
          byCode.set(code, quote);
          recovered += 1;
        }
      } catch (error) {
        errors.push({ source: "yahoo", range: code, size: 1, error: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(YAHOO_FALLBACK_CONCURRENCY, missing.length) }, () => yahooWorker()));
  return { recovered, attempted: missing.length, skipped: Math.max(0, codes.filter((code) => !byCode.has(code)).length - missing.length) };
}

async function fetchQuotes(codes) {
  const byCode = new Map();
  const errors = [];
  const sourceAttempts = [];
  const fallbackRecovered = { fugle: 0, finmind: 0, twseMis: 0, yahoo: 0 };
  const sourceOrder = quoteSourceOrder();
  for (const source of sourceOrder) {
    const missing = codes.filter((code) => !byCode.has(code));
    if (!missing.length) break;
    const before = byCode.size;
    let result = { recovered: 0, attempted: 0, skipped: 0 };
    if (source === "fugle") {
      result = await fetchFugleQuotesForCodes(codes, byCode, errors);
      fallbackRecovered.fugle += result.recovered;
    } else if (source === "finmind") {
      result = await fetchFinMindQuotesForCodes(codes, byCode, errors);
      fallbackRecovered.finmind += result.recovered;
    } else if (source === "twse-mis") {
      result = await fetchTwseMisQuotesForCodes(codes, byCode, errors);
      fallbackRecovered.twseMis += result.recovered;
    } else if (source === "yahoo-chart") {
      result = await fetchYahooQuotesForCodes(codes, byCode, errors);
      fallbackRecovered.yahoo += result.recovered;
    }
    sourceAttempts.push({
      source,
      requested: missing.length,
      attempted: result.attempted,
      recovered: Math.max(0, byCode.size - before),
      skipped: result.skipped,
      remaining: Math.max(0, codes.length - byCode.size),
    });
  }
  return { byCode, errors, fallbackRecovered, sourceAttempts, sourceOrder };
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
    const { byCode, errors, fallbackRecovered, sourceAttempts, sourceOrder } = await fetchQuotes(codes);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      partial: errors.length > 0 || byCode.size < codes.length,
      updatedAt: new Date().toISOString(),
      requested: codes.length,
      count: byCode.size,
      source: sourceOrder.join("+"),
      primarySource: sourceOrder[0] || "",
      sourceOrder,
      sourceAttempts,
      fallbackRecovered,
      quotes: [...byCode.values()],
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, quotes: [] });
  }
};
