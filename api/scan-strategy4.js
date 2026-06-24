const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;
let tpexDailyCache = null;
const fs = require("fs");
const path = require("path");
const { fetchMisQuotes, mergeMisQuoteIntoHistory } = require("../lib/mis-quotes");
const USE_MIS_QUOTES = process.env.STRATEGY4_USE_MIS === "1";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const FUGLE_API_KEY_FILE = process.env.FUGLE_API_KEY_FILE || path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt");
const FINMIND_API_TOKEN_FILE = process.env.FINMIND_API_TOKEN_FILE || path.join(RUNTIME_DIR, "secrets", "finmind-api-token.txt");
const FUGLE_HISTORY_CACHE_DIR = process.env.FUGLE_HISTORY_CACHE_DIR || path.join(RUNTIME_DIR, "cache", "fugle", "historical");
const STRATEGY4_MIN_AVG_VOLUME_5 = 3000;
const ALLOW_YAHOO_FALLBACK = process.env.STRATEGY4_ALLOW_YAHOO_FALLBACK !== "0";
const SUPABASE_FIRST = process.env.STRATEGY4_SUPABASE_FIRST !== "0";
const ALLOW_EXTERNAL_FALLBACK = process.env.STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK === "1";

function readSecret(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

const FUGLE_API_KEY = process.env.FUGLE_API_KEY || process.env.FUGLE_MARKETDATA_API_KEY || readSecret(FUGLE_API_KEY_FILE);
const FINMIND_API_TOKEN = process.env.FINMIND_API_TOKEN || process.env.FINMIND_TOKEN || readSecret(FINMIND_API_TOKEN_FILE);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, options = {}, timeout = 12000) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Referer: "https://www.twse.com.tw/",
          ...(options.headers || {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "" || value === "--") return 0;
  return Number(String(value).replace(/[,+%]/g, "").replace(/^X/i, "").trim()) || 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function rocToIso(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]) + 1911;
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function yyyymmddToIso(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return "";
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function monthStarts(count = 8) {
  const dates = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push({
      twse: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}01`,
      tpex: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/01`,
    });
  }
  return dates;
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function fugleHistoryCacheFile(code) {
  return path.join(FUGLE_HISTORY_CACHE_DIR, `${normalizeCode(code)}.json`);
}

function readFugleHistoryCache(code, from, to) {
  const payload = readJson(fugleHistoryCacheFile(code), null);
  if (
    payload?.code !== normalizeCode(code)
    || payload?.from !== from
    || payload?.to !== to
    || !Array.isArray(payload?.rows)
    || payload.rows.length < 60
  ) return null;
  const source = payload.source || "fugle-cache";
  const sourceUnit = /supabase|fugle|finmind|yahoo|twse|tpex/i.test(source) ? "shares" : "";
  const rows = payload.rows.map((row) => ({
    ...row,
    volumeUnit: row.volumeUnit || row.volume_unit || sourceUnit || undefined,
  }));
  return { rows, source };
}

function writeFugleHistoryCache(code, from, to, rows) {
  if (!Array.isArray(rows) || rows.length < 60) return false;
  return writeJson(fugleHistoryCacheFile(code), {
    code: normalizeCode(code),
    from,
    to,
    source: "fugle",
    updatedAt: new Date().toISOString(),
    rows,
  });
}

function normalizeTwseRows(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    volumeUnit: "shares",
    value: cleanNumber(row[2]),
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexRows(payload) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  if (!Array.isArray(table?.data)) return [];
  return table.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    volumeUnit: "shares",
    value: cleanNumber(row[2]) * 1000,
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexDailyRow(row, date) {
  if (!Array.isArray(row)) return null;
  const close = cleanNumber(row[2]);
  if (!close) return null;
  return {
    date,
    volume: cleanNumber(row[8]) / 1000,
    volumeUnit: "lots",
    value: cleanNumber(row[9]),
    open: cleanNumber(row[4]),
    high: cleanNumber(row[5]),
    low: cleanNumber(row[6]),
    close,
    change: cleanNumber(row[3]),
  };
}

function normalizeFugleRows(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((row) => ({
    date: String(row.date || "").slice(0, 10),
    volume: cleanNumber(row.volume),
    volumeUnit: "shares",
    value: cleanNumber(row.turnover),
    open: cleanNumber(row.open),
    high: cleanNumber(row.high),
    low: cleanNumber(row.low),
    close: cleanNumber(row.close),
    change: cleanNumber(row.change),
  })).filter((row) => row.date && row.close);
}

function normalizeFinMindRows(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => ({
    date: String(row.date || "").slice(0, 10),
    volume: cleanNumber(row.Trading_Volume),
    volumeUnit: "shares",
    value: cleanNumber(row.Trading_money),
    open: cleanNumber(row.open),
    high: cleanNumber(row.max),
    low: cleanNumber(row.min),
    close: cleanNumber(row.close),
    change: cleanNumber(row.spread),
  })).filter((row) => row.date && row.close);
}

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps.map((ts, index) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    volume: cleanNumber(quote.volume?.[index]),
    volumeUnit: "shares",
    value: 0,
    open: cleanNumber(quote.open?.[index]),
    high: cleanNumber(quote.high?.[index]),
    low: cleanNumber(quote.low?.[index]),
    close: cleanNumber(quote.close?.[index]),
    change: 0,
  })).filter((row) => row.date && row.close);
}

async function fetchTpexDailyQuotes() {
  if (tpexDailyCache && Date.now() - tpexDailyCache.ts < CACHE_MS) return tpexDailyCache.value;
  const url = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&s=0,asc,0";
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } }, 20000));
  const date = yyyymmddToIso(payload?.date);
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  const rows = Array.isArray(table?.data) && date ? table.data : [];
  const quotes = new Map();
  rows.forEach((row) => {
    const code = normalizeCode(row[0]);
    const quote = normalizeTpexDailyRow(row, date);
    if (/^\d{4}$/.test(code) && quote) quotes.set(code, quote);
  });
  tpexDailyCache = { ts: Date.now(), value: quotes };
  return quotes;
}

async function mergeTpexDailyQuote(code, history) {
  if (history.market !== "TPEX") return history;
  try {
    const quote = (await fetchTpexDailyQuotes()).get(code);
    if (!quote) return history;
    const byDate = new Map(history.rows.map((row) => [row.date, row]));
    byDate.set(quote.date, { ...(byDate.get(quote.date) || {}), ...quote });
    return {
      ...history,
      rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180),
    };
  } catch {
    return history;
  }
}

async function fetchTwseMonth(code, date) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.twse.com.tw/" } }));
  if (payload?.stat && payload.stat !== "OK") return [];
  return normalizeTwseRows(payload);
}

async function fetchTpexMonth(code, date) {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(date)}&id=&response=json`;
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } }));
  return normalizeTpexRows(payload);
}

async function fetchFugleHistory(code) {
  if (!FUGLE_API_KEY) return { rows: [], source: "" };
  const from = isoDateDaysAgo(270);
  const to = new Date().toISOString().slice(0, 10);
  const cached = readFugleHistoryCache(code, from, to);
  if (cached) return cached;
  if (SUPABASE_FIRST && !ALLOW_EXTERNAL_FALLBACK) return { rows: [], source: "supabase-cache-miss" };
  const params = new URLSearchParams({
    symbol: code,
    from,
    to,
  });
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${code}?${params.toString()}`;
  const payload = JSON.parse(await fetchText(url, {
    headers: {
      Referer: "https://developer.fugle.tw/",
      "X-API-KEY": FUGLE_API_KEY,
    },
  }, 20000));
  const rows = normalizeFugleRows(payload);
  writeFugleHistoryCache(code, from, to, rows);
  return { rows, source: "fugle" };
}

async function fetchFinMindHistory(code) {
  if (!FINMIND_API_TOKEN) return { rows: [], source: "" };
  const params = new URLSearchParams({
    dataset: "TaiwanStockPrice",
    data_id: code,
    start_date: isoDateDaysAgo(270),
    end_date: new Date().toISOString().slice(0, 10),
  });
  const url = `https://api.finmindtrade.com/api/v4/data?${params.toString()}`;
  const payload = JSON.parse(await fetchText(url, {
    headers: {
      Referer: "https://finmindtrade.com/",
      Authorization: `Bearer ${FINMIND_API_TOKEN}`,
    },
  }, 20000));
  const rows = normalizeFinMindRows(payload);
  return { rows, source: "finmind" };
}

async function fetchYahooHistory(code, marketHint = "") {
  const suffixes = marketHint === "TPEX" ? ["TWO", "TW"] : marketHint === "TWSE" ? ["TW", "TWO"] : ["TW", "TWO"];
  for (const suffix of suffixes) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}?range=9mo&interval=1d&events=history&includeAdjustedClose=true`;
      const payload = JSON.parse(await fetchText(url, {
        headers: { Referer: "https://finance.yahoo.com/" },
      }, 20000));
      const rows = normalizeYahooRows(payload);
      if (rows.length >= 25) return { rows, source: `yahoo-${suffix.toLowerCase()}` };
    } catch {
    }
  }
  return { rows: [], source: "" };
}

async function fetchHistory(code, preferredMarket = "") {
  const marketHint = String(preferredMarket || "").toUpperCase();
  const cacheKey = `${code}:${marketHint || "AUTO"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.value;

  const months = monthStarts(8);
  let market = marketHint === "TPEX" ? "TPEX" : "TWSE";
  let rows = [];

  let historySource = "";
  try {
    const primary = await fetchFugleHistory(code);
    if (primary.rows.length >= 60) {
      rows = primary.rows;
      historySource = primary.source || "fugle";
    } else if (primary.source) {
      historySource = primary.source;
    }
  } catch {
  }

  if (SUPABASE_FIRST && !ALLOW_EXTERNAL_FALLBACK && rows.length < 60) {
    const value = {
      code,
      market,
      source: historySource || "supabase-cache-miss",
      rows: [],
    };
    cache.set(cacheKey, { ts: Date.now(), value });
    return value;
  }

  if (rows.length < 60) {
    try {
      const finmind = await fetchFinMindHistory(code);
      if (finmind.rows.length >= rows.length) {
        rows = finmind.rows;
        historySource = finmind.source || historySource;
      }
    } catch {
    }
  }

  if (rows.length < 60 && ALLOW_YAHOO_FALLBACK) {
    const yahoo = await fetchYahooHistory(code, marketHint || market);
    if (yahoo.rows.length >= rows.length) {
      rows = yahoo.rows;
      historySource = yahoo.source || historySource;
    }
  }

  if (rows.length < 60) {
    const officialRows = [];
    if (market !== "TPEX") {
      for (const item of months) {
        try {
          officialRows.push(...await fetchTwseMonth(code, item.twse));
        } catch {
          // Keep partial official daily-K history; one flaky month should not drop the whole stock.
        }
        await sleep(30);
      }
    }

    if (market === "TPEX" || (!marketHint && officialRows.length < 25)) {
      const tpexRows = [];
      for (const item of months) {
        try {
          tpexRows.push(...await fetchTpexMonth(code, item.tpex));
        } catch {
          // Same tolerance for TPEX; noDataCodes will expose true misses after all retries.
        }
        await sleep(30);
      }
      if (marketHint === "TPEX" || tpexRows.length || !officialRows.length) {
        market = "TPEX";
        officialRows.length = 0;
        officialRows.push(...tpexRows);
      }
    }

    if (officialRows.length >= rows.length) {
      rows = officialRows;
      historySource = market === "TPEX" ? "tpex-official" : "twse-official";
    }
  }

  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  const value = {
    code,
    market,
    source: historySource || (market === "TPEX" ? "tpex-official" : "twse-official"),
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180),
  };
  cache.set(cacheKey, { ts: Date.now(), value });
  return value;
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function normalizeVolumeLots(value, row = {}) {
  const volume = cleanNumber(value);
  if (!volume) return 0;
  const unit = String(row?.volumeUnit || row?.volume_unit || "").toLowerCase();
  if (/share|stock|股/.test(unit)) return volume / 1000;
  if (/lot|張/.test(unit)) return volume;

  const close = cleanNumber(row?.close);
  const tradeValue = cleanNumber(row?.value || row?.tradeValue || row?.turnover);
  if (close > 0 && tradeValue > 0) {
    const valueIfShares = close * volume;
    const valueIfLots = close * volume * 1000;
    const shareGap = Math.abs(valueIfShares - tradeValue) / Math.max(tradeValue, 1);
    const lotGap = Math.abs(valueIfLots - tradeValue) / Math.max(tradeValue, 1);
    if (shareGap < lotGap) return volume / 1000;
    if (lotGap < shareGap) return volume;
  }

  return volume >= 100000 ? volume / 1000 : volume;
}

function sma(values, length, offset = 0) {
  const end = values.length - offset;
  const start = end - length;
  if (start < 0 || end <= 0) return 0;
  return avg(values.slice(start, end));
}

function emaSeries(values, length) {
  const k = 2 / (length + 1);
  const out = [];
  values.forEach((value, index) => {
    out[index] = index === 0 ? value : value * k + out[index - 1] * (1 - k);
  });
  return out;
}

function rsi(values, length = 14) {
  if (values.length <= length) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - length; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (!losses) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function macdSnapshot(values) {
  if (values.length < 35) return { macd: 0, signal: 0, histogram: 0, rising: false };
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macdLine = values.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const signalLine = emaSeries(macdLine, 9);
  const macd = macdLine.at(-1) || 0;
  const signal = signalLine.at(-1) || 0;
  const prevHist = (macdLine.at(-2) || 0) - (signalLine.at(-2) || 0);
  const histogram = macd - signal;
  return { macd, signal, histogram, rising: histogram > prevHist };
}

function atr(rows, length = 14) {
  if (rows.length <= length) return 0;
  const trs = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const prev = rows[i - 1];
    trs.push(Math.max(
      row.high - row.low,
      Math.abs(row.high - prev.close),
      Math.abs(row.low - prev.close)
    ));
  }
  return avg(trs.slice(-length));
}

function highestHighAtOffset(rows, length, offset = 0) {
  const end = rows.length - offset;
  const start = end - length;
  if (start < 0 || end > rows.length) return NaN;
  return Math.max(...rows.slice(start, end).map((row) => row.high));
}

function moneyFlowSeries(rows) {
  return rows.map((row) => {
    const range = row.high - row.low;
    return range === 0 ? 0 : ((row.close - row.open) / range) * row.volume;
  });
}

function walletSnapshots(rows, lookback = 5) {
  const mfValues = moneyFlowSeries(rows);
  const mfAvg = emaSeries(mfValues, 20);
  const controlSeries = mfAvg.map((_, index) => sma(mfAvg.slice(0, index + 1), 5));
  const absMfValues = mfValues.map(Math.abs);
  const volumeMa5Series = absMfValues.map((_, index) => sma(absMfValues.slice(0, index + 1), 5));
  const volumeMa60Series = absMfValues.map((_, index) => sma(absMfValues.slice(0, index + 1), 60));
  const start = Math.max(60, rows.length - Math.max(1, lookback));
  const snapshots = [];
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    const prevControlLine = controlSeries[index - 1] || 0;
    const prev2ControlLine = controlSeries[index - 2] || prevControlLine;
    const controlLine = controlSeries[index] || 0;
    const volumeMa5 = volumeMa5Series[index] || 0;
    const volumeMa60 = volumeMa60Series[index] || 0;
    const prevVolumeMa5 = volumeMa5Series[index - 1] || 0;
    const prevVolumeMa60 = volumeMa60Series[index - 1] || 0;
    const volAvg = sma(absMfValues.slice(0, index + 1), 20);
    const mf = mfValues[index] || 0;
    const atr14 = atr(rows.slice(0, index + 1), 14);
    const typicalPrice = (row.high + row.low + row.close) / 3;
    const isRed = row.close > row.open;
    const isGray = Math.abs(mf) < volAvg * 0.3;
    const isStrongMove = Math.abs(mf) > atr14 * 2.5;
    const isDangerZone = row.close < typicalPrice || (controlLine < prevControlLine && prevControlLine < prev2ControlLine);
    snapshots.push({
      date: row.date,
      mf,
      controlLine,
      volumeMa5,
      volumeMa60,
      strongBuy: !isGray && isStrongMove && prevControlLine <= 0 && controlLine > 0 && isRed && !isDangerZone,
      volumeCrossUp: prevVolumeMa5 <= prevVolumeMa60 && volumeMa5 > volumeMa60 && isRed,
    });
  }
  return snapshots;
}

function walletSnapshot(rows) {
  const snapshots = walletSnapshots(rows, Number(process.env.STRATEGY4_WALLET_LOOKBACK_BARS || 1));
  const latestStrongBuy = snapshots.slice().reverse().find((item) => item.strongBuy) || null;
  const latestVolumeCross = snapshots.slice().reverse().find((item) => item.volumeCrossUp) || null;
  const latest = snapshots.at(-1) || {
    mf: 0,
    controlLine: 0,
    volumeMa5: 0,
    volumeMa60: 0,
    strongBuy: false,
    volumeCrossUp: false,
  };
  return {
    ...latest,
    strongBuy: Boolean(latestStrongBuy),
    volumeCrossUp: Boolean(latestVolumeCross),
    strongBuyDate: latestStrongBuy?.date || "",
    volumeCrossDate: latestVolumeCross?.date || "",
    latestStrongBuy,
    latestVolumeCross,
  };
}

function analyzeRows(rows) {
  if (rows.length < 60) return null;
  const normalizedRows = rows.map((row) => ({ ...row, volume: normalizeVolumeLots(row.volume, row), volumeUnit: "lots" }));
  const closes = normalizedRows.map((row) => row.close);
  const volumes = normalizedRows.map((row) => row.volume);
  const last = normalizedRows.at(-1);
  const prev = normalizedRows.at(-2);
  const prev2 = normalizedRows.at(-3);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma5Prev = sma(closes, 5, 1);
  const ma10Prev = sma(closes, 10, 1);
  const ma20Prev3 = sma(closes, 20, 3);
  const ma20Offset = closes.at(-20) || ma20;
  const ema21All = emaSeries(closes, 21);
  const ema21 = ema21All.at(-1) || 0;
  const ema21Prev = ema21All.at(-2) || ema21;
  const volMa5 = sma(volumes, 5);
  const volMa20 = sma(volumes, 20);
  const macd = macdSnapshot(closes);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(rows, 14);
  const wallet = walletSnapshot(normalizedRows);
  const lookback = normalizedRows.slice(-40);
  const swHigh = Math.max(...lookback.map((row) => row.high));
  const swLow = Math.min(...lookback.map((row) => row.low));
  const swDiff = Math.max(swHigh - swLow, 0);
  const position = swDiff ? (last.close - swLow) / swDiff : 0.5;
  const stage = position >= 1 ? { label: "過熱", ratio: "1.00+", tone: "hot", value: position }
    : position >= 0.618 ? { label: "高基期", ratio: position.toFixed(2), tone: "high", value: position }
    : position >= 0.382 ? { label: "中位階", ratio: position.toFixed(2), tone: "mid", value: position }
    : { label: "低基期", ratio: position.toFixed(2), tone: "low", value: position };
  const highest20Prev = Math.max(...normalizedRows.slice(-21, -1).map((row) => row.high));
  const highest10Prev = Math.max(...normalizedRows.slice(-11, -1).map((row) => row.high));
  const highest2Prev = Math.max(...normalizedRows.slice(-3, -1).map((row) => row.high));
  const neckline = highestHighAtOffset(normalizedRows, 40, Math.floor(40 * 0.6));
  const prevLookback = normalizedRows.slice(-41, -1);
  const prevSwHigh = Math.max(...prevLookback.map((row) => row.high));
  const prevSwLow = Math.min(...prevLookback.map((row) => row.low));
  const prevSwDiff = Math.max(prevSwHigh - prevSwLow, 0);
  const fib382 = swLow + swDiff * 0.382;
  const fib500 = swLow + swDiff * 0.5;
  const fib618 = swLow + swDiff * 0.618;
  const prevNeckline = highestHighAtOffset(normalizedRows, 40, Math.floor(40 * 0.6) + 1);
  const pct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const gapUp = prev && last.open > prev.high && last.close > last.open;
  const realBody = (last.high - last.low) > 0 ? Math.abs(last.close - last.open) / (last.high - last.low) > 0.3 : false;
  const bullTrend = last.close > ma20 && last.close > ema21 && ema21 > ema21Prev && macd.macd > macd.signal && ma20 > ma20Prev3;
  const volumeRatio = volMa20 ? last.volume / volMa20 : 0;
  const deepFall = ma20 ? ((last.close - ma20) / ma20) * 100 < -1.5 : false;
  const bias20 = ma20 ? ((last.close - ma20) / ma20) * 100 : 0;
  return {
    rows: normalizedRows,
    last,
    prev,
    prev2,
    closes,
    ma5,
    ma10,
    ma20,
    ma5Prev,
    ma10Prev,
    ma20Offset,
    ema21,
    ema21Prev,
    volMa5,
    volMa20,
    volumeRatio,
    macd,
    rsi14,
    atr14,
    wallet,
    stage,
    highest20Prev,
    highest10Prev,
    highest2Prev,
    neckline,
    prevNeckline,
    fib382,
    fib500,
    fib618,
    pct,
    gapUp,
    realBody,
    bullTrend,
    deepFall,
    bias20,
  };
}

function crossedOver(current, previous, levelNow, levelPrev = levelNow) {
  return Number.isFinite(current) && Number.isFinite(previous) &&
    Number.isFinite(levelNow) && Number.isFinite(levelPrev) &&
    previous <= levelPrev && current > levelNow;
}

function detectNBase(rows, volMa20) {
  let fLow = null;
  let fHigh = null;
  let sLow = null;
  for (let index = Math.max(1, rows.length - 80); index < rows.length; index++) {
    const row = rows[index];
    const prev = rows[index - 1];
    if (!row || !prev) continue;
    if (volMa20 && row.volume > volMa20 * 1.5 && row.close > prev.high) {
      fLow = row.low;
      fHigh = row.high;
    }
    if (fLow != null && fHigh != null && row.low > (fLow + (fHigh - fLow) * 0.5) && row.low > fLow) {
      sLow = row.low;
    }
  }
  const last = rows.at(-1);
  const prev = rows.at(-2);
  return {
    fLow,
    fHigh,
    sLow,
    triggered: fHigh != null && sLow != null && crossedOver(last.close, prev.close, fHigh),
  };
}

function calcBuyStreak(rows, ma20, volMa20) {
  let streak = 0;
  for (let index = Math.max(1, rows.length - 20); index < rows.length; index++) {
    const row = rows[index];
    const prev = rows[index - 1];
    const bias20 = ma20 ? ((row.close - ma20) / ma20) * 100 : 0;
    const deepFall = bias20 < -1.5;
    const instStopDrop = deepFall && row.close > row.open && row.close > prev.high && row.volume > volMa20 * 0.8;
    streak = instStopDrop ? streak + 1 : (row.close < prev.low ? 0 : streak);
  }
  return streak;
}

function scanStrategy4(code, market, rows, priceSource = "") {
  const daily = analyzeRows(rows);
  if (!daily) return null;
  if (daily.volMa5 < STRATEGY4_MIN_AVG_VOLUME_5) return null;

  const last = daily.last;
  const prev = daily.prev;
  const isRed = last.close > last.open;
  const volStrong = daily.volumeRatio >= 1.2;
  const trendConfirmed = daily.ema21 > daily.ma20;
  const signals = [];
  const bullAttack = daily.bullTrend && isRed && volStrong && daily.realBody &&
    (daily.gapUp || (prev && last.volume > prev.volume * 1.2) || last.high > daily.highest2Prev) &&
    trendConfirmed;
  const goldenCross = crossedOver(daily.ma5, daily.ma5Prev, daily.ma10, daily.ma10Prev) && daily.ma10 > daily.ma20 && isRed;
  const breakawayGap = daily.gapUp && last.close > daily.highest20Prev;
  const runawayGap = daily.gapUp && last.close > daily.ma20 && !breakawayGap;
  const necklineBreak = crossedOver(last.close, prev?.close, daily.neckline, daily.prevNeckline);
  const rightHighBreak = crossedOver(last.close, prev?.close, daily.highest10Prev) && prev?.close > daily.prevNeckline;
  const saucerBreakout = (necklineBreak || rightHighBreak) &&
    daily.volumeRatio >= 1.1 && isRed && daily.realBody;
  const nState = detectNBase(daily.rows, daily.volMa20);
  const nBase = nState.triggered && daily.realBody && isRed;
  const roc3 = daily.closes.length > 3 ? ((last.close - daily.closes.at(-4)) / daily.closes.at(-4)) * 100 : 0;
  const vFast = roc3 < -10 && daily.volumeRatio >= 1.5 && isRed && prev && daily.prev2 && crossedOver(last.close, prev.close, prev.high, daily.prev2.high) && daily.rsi14 < 50;
  const buyStreak = calcBuyStreak(daily.rows, daily.ma20, daily.volMa20);
  const vReversal = daily.deepFall && isRed && (
    (roc3 < -5 ? 35 : 0) +
    (prev && last.close > prev.high ? 25 : 0) +
    (buyStreak >= 1 ? 20 : 0) +
    (runawayGap ? 20 : 0) +
    (daily.rsi14 < 40 ? 10 : 0)
  ) >= 60;
  const threeInside = daily.rows.length >= 3 && (() => {
    const a = daily.rows.at(-3);
    const b = daily.rows.at(-2);
    const c = daily.rows.at(-1);
    const aRange = a.high - a.low;
    return a.close < a.open &&
      aRange > 0 &&
      Math.abs(a.close - a.open) / aRange > 0.5 &&
      b.close > b.open &&
      b.close < a.open &&
      b.open > a.close &&
      c.close > c.open &&
      c.close > a.open &&
      c.volume > daily.volMa20 * 1.2 &&
      c.close > daily.ma20 &&
      trendConfirmed;
  })();
  const deepFallFib = daily.deepFall && isRed;

  if (bullAttack) signals.push({ id: "bull_attack", short: "攻擊", icon: "🔥", reason: `站上MA20/EMA21，MACD多頭，量比 ${daily.volumeRatio.toFixed(2)}，日K多頭攻擊。` });
  if (nBase) signals.push({ id: "n_base", short: "N字", icon: "", reason: `爆量突破後回檔不破半分位，再突破前高 ${nState.fHigh?.toFixed?.(2) || ""}，N字共振。` });
  if (necklineBreak) signals.push({ id: "buy_neckline", short: "買1", icon: "買1", reason: `突破圓弧底頸線 ${daily.neckline.toFixed(2)}，對應沐滝買點1。` });
  if (rightHighBreak) signals.push({ id: "buy_pullback_break", short: "買2", icon: "買2", reason: "站回頸線後突破右側10日高點，對應沐滝買點2。" });
  if (saucerBreakout) signals.push({ id: "saucer", short: "圓弧", icon: "◜", reason: "突破40日整理頸線，量能放大，偏圓弧底突破。" });
  if (breakawayGap) signals.push({ id: "breakaway_gap", short: "突破缺口", icon: "◆", reason: "跳空突破近20日整理高點，偏突破缺口。" });
  if (runawayGap) signals.push({ id: "runaway_gap", short: "逃逸缺口", icon: "🚀", reason: "跳空且站上MA20，多頭段延續，偏逃逸缺口。" });
  if (vFast) signals.push({ id: "v_fast", short: "V快殺", icon: "V", reason: `3日急跌後放量翻紅，RSI ${daily.rsi14.toFixed(1)}，偏V型快殺反彈。` });
  if (vReversal) signals.push({
    id: runawayGap ? "v_reversal_runaway" : "v_reversal",
    short: runawayGap ? "V轉逃逸" : "V轉",
    icon: "V",
    reason: runawayGap ? "深跌後反折且同步觸發逃逸缺口，對應沐滝 V轉+逃逸缺口。" : "跌深後收紅並突破前高，V轉積分達標。",
  });
  if (deepFallFib) signals.push({
    id: "deep_fall_fib",
    short: "深跌FIB",
    icon: "Fib",
    reason: `深跌反轉環境成立，負乖離 ${daily.bias20.toFixed(2)}%，Fib 0.382=${daily.fib382.toFixed(2)}、0.500=${daily.fib500.toFixed(2)}、0.618=${daily.fib618.toFixed(2)}。`,
  });
  if (threeInside) signals.push({ id: "three_inside", short: "三內翻紅", icon: "↻", reason: "三內翻紅結構成立，站上MA20且趨勢確認。" });
  if (goldenCross) signals.push({ id: "golden_cross", short: "金釵", icon: "✦", reason: "MA5 > MA10 > MA20 且收紅，多金釵候選。" });
  if (daily.wallet.strongBuy) {
    signals.push({
      id: "wallet_strong_buy",
      title: "多方寶石",
      short: "主力多",
      icon: "◆",
      reason: `主力爸爸錢包多方寶石${daily.wallet.strongBuyDate ? `（${daily.wallet.strongBuyDate}）` : ""}：控盤線由負翻正且日K收紅。`,
    });
  }
  if (daily.wallet.volumeCrossUp) {
    signals.push({
      id: "wallet_volume_cross",
      title: "紅色三角形",
      short: "量叉",
      icon: "🔺",
      reason: `主力爸爸錢包量能紅K交叉${daily.wallet.volumeCrossDate ? `（${daily.wallet.volumeCrossDate}）` : ""}：5日資金量均線 ${Math.round(daily.wallet.volumeMa5).toLocaleString("zh-TW")} 上穿 60日 ${Math.round(daily.wallet.volumeMa60).toLocaleString("zh-TW")}。`,
    });
  }

  const aboveMa20 = last.close > daily.ma20;
  const nearMa20 = daily.ma20 ? Math.abs((last.close - daily.ma20) / daily.ma20) <= 0.06 : false;
  const ma5TurningUp = daily.ma5 > sma(daily.closes, 5, 1);
  const macdImproving = daily.macd.rising || daily.macd.macd > daily.macd.signal;
  const healthyRsi = daily.rsi14 >= 45 && daily.rsi14 <= 72;
  const setupRsi = daily.rsi14 >= 38 && daily.rsi14 <= 62;
  const stageNotHot = daily.stage.tone !== "hot";
  const trendScore = [
    aboveMa20,
    last.close > daily.ema21,
    daily.ema21 >= daily.ema21Prev,
    ma5TurningUp,
    macdImproving,
    healthyRsi,
    daily.volumeRatio >= 0.8,
    stageNotHot,
  ].filter(Boolean).length;
  const prepScore = [
    daily.stage.tone === "low" || daily.stage.tone === "mid",
    nearMa20 || last.close > daily.ma20 * 0.94,
    macdImproving,
    setupRsi,
    daily.volumeRatio >= 0.45,
    daily.volumeRatio <= 1.8,
    ma5TurningUp || isRed,
  ].filter(Boolean).length;

  let swingZone = "A";
  let swingZoneLabel = "A區可進場";
  if (!signals.length && trendScore >= 5) {
    swingZone = "B";
    swingZoneLabel = "B區觀察";
    signals.push({
      id: "watch_trend",
      short: "B觀察",
      icon: "B",
      reason: `趨勢轉強但尚未觸發突破買點；趨勢分 ${trendScore}/8，量比 ${daily.volumeRatio.toFixed(2)}，位階 ${daily.stage.label}。`,
    });
  }
  if (!signals.length && prepScore >= 5) {
    swingZone = "C";
    swingZoneLabel = "C區準備";
    signals.push({
      id: "base_setup",
      short: "C準備",
      icon: "C",
      reason: `低/中位階整理接近發動；準備分 ${prepScore}/7，RSI ${daily.rsi14.toFixed(1)}，量比 ${daily.volumeRatio.toFixed(2)}。`,
    });
  }

  if (!signals.length) {
    swingZone = "C";
    swingZoneLabel = "C區準備";
    signals.push({
      id: "full_scan_watch",
      short: "全掃",
      icon: "C",
      reason: `完整掃描保留：扣除剔除名單後納入策略4股票池；趨勢分 ${trendScore}/8，準備分 ${prepScore}/7，量比 ${daily.volumeRatio.toFixed(2)}，位階 ${daily.stage.label}。`,
    });
  }
  const zoneBase = swingZone === "A" ? 48 : swingZone === "B" ? 38 : 28;
  const score = Math.min(100, Math.round(
    zoneBase +
    signals.length * 7 +
    trendScore * 3 +
    prepScore * 2 +
    Math.min(daily.volumeRatio * 8, 18) +
    (daily.macd.macd > daily.macd.signal ? 8 : 0) +
    (daily.wallet.strongBuy ? 8 : 0) +
    (daily.wallet.volumeCrossUp ? 6 : 0) +
    (daily.stage.tone === "low" ? 8 : daily.stage.tone === "mid" ? 5 : daily.stage.tone === "high" ? 2 : -8)
  ));

  return {
    code,
    market,
    priceSource,
    date: last.date,
    close: last.close,
    percent: daily.pct,
    volume: last.volume,
    tradeVolume: last.volume,
    value: last.value,
    avgVolume5: Number(daily.volMa5.toFixed(2)),
    volumeRatio: Number(daily.volumeRatio.toFixed(2)),
    swingStage: daily.stage,
    swingZone,
    swingZoneLabel,
    trendScore,
    prepScore,
    swingScore: score,
    score,
    swingSignals: signals,
    signals,
    wallet: {
      mf: Math.round(daily.wallet.mf),
      controlLine: Math.round(daily.wallet.controlLine),
      volumeMa5: Math.round(daily.wallet.volumeMa5),
      volumeMa60: Math.round(daily.wallet.volumeMa60),
      strongBuy: daily.wallet.strongBuy,
      volumeCrossUp: daily.wallet.volumeCrossUp,
      strongBuyDate: daily.wallet.strongBuyDate,
      volumeCrossDate: daily.wallet.volumeCrossDate,
    },
    reason: signals[0].reason,
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed", matches: [] });
    return;
  }

  const codes = String(request.query?.codes || "")
    .split(",")
    .map(normalizeCode)
    .filter((code) => /^\d{4}$/.test(code))
    .filter((code) => !/^00/.test(code));
  const markets = String(request.query?.markets || "")
    .split(",")
    .map((market) => String(market || "").trim().toUpperCase());

  if (!codes.length) {
    response.status(400).json({ ok: false, error: "Missing codes", matches: [] });
    return;
  }

  const quoteMap = USE_MIS_QUOTES ? await fetchMisQuotes(codes) : new Map();
  const results = await Promise.allSettled(codes.map(async (code, index) => {
    const officialHistory = await mergeTpexDailyQuote(code, await fetchHistory(code, markets[index] || ""));
    const history = USE_MIS_QUOTES
      ? mergeMisQuoteIntoHistory(officialHistory, quoteMap.get(code))
      : officialHistory;
    const source = USE_MIS_QUOTES && quoteMap.has(code)
      ? `${history.source || "unknown"}+mis`
      : history.source || "";
    if (!history.rows.length) return { code, noData: true, source };
    return {
      code,
      source,
      match: scanStrategy4(code, history.market, history.rows, source),
    };
  }));
  const sourceCounts = {};
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    const source = result.value?.source || result.value?.priceSource || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });
  const matches = results
    .filter((result) => result.status === "fulfilled" && result.value?.match)
    .map((result) => result.value.match || result.value)
    .sort((a, b) => b.score - a.score || b.percent - a.percent);
  const noDataCodes = results
    .filter((result) => result.status === "fulfilled" && result.value?.noData)
    .map((result) => result.value.code);

  response.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  response.status(200).json({
    ok: true,
    updatedAt: new Date().toISOString(),
    priceSource: USE_MIS_QUOTES ? "official-daily-k-plus-mis" : "official-daily-k",
    scanned: codes.length,
    scannedCodes: codes,
    sourceCounts,
    count: matches.length,
    matches,
    noDataCodes,
    errors: results
      .map((result, index) => result.status === "rejected" ? `${codes[index]}: ${result.reason.message}` : null)
      .filter(Boolean),
  });
};





