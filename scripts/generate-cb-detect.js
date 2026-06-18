const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

const CBAS_BASE = "https://cbas16889.pscnet.com.tw/api/CbasQuote";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const OUT_FILE = path.join(DATA_DIR, "cb-detect-latest.json");
const CODE_OUT_FILE = path.join(__dirname, "..", "data", "cb-detect-latest.json");
const STOCKS_FILE = fsSync.existsSync(path.join(DATA_DIR, "stocks-slim.json"))
  ? path.join(DATA_DIR, "stocks-slim.json")
  : path.join(__dirname, "..", "data", "stocks-slim.json");
const INSTITUTION_FILE = fsSync.existsSync(path.join(DATA_DIR, "institution-slim.json"))
  ? path.join(DATA_DIR, "institution-slim.json")
  : path.join(__dirname, "..", "data", "institution-slim.json");
const FUGLE_API_KEY_FILE = process.env.FUGLE_API_KEY_FILE || path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt");
const FINMIND_API_TOKEN_FILE = process.env.FINMIND_API_TOKEN_FILE || path.join(RUNTIME_DIR, "secrets", "finmind-api-token.txt");
const HISTORY_MONTHS = 14;
const HISTORY_CONCURRENCY = 4;
const INTRADAY_60M_RANGE = "6mo";

function readSecret(file) {
  try {
    return fsSync.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

const FUGLE_API_KEY = process.env.FUGLE_API_KEY || process.env.FUGLE_MARKETDATA_API_KEY || readSecret(FUGLE_API_KEY_FILE);
const FINMIND_API_TOKEN = process.env.FINMIND_API_TOKEN || process.env.FINMIND_TOKEN || readSecret(FINMIND_API_TOKEN_FILE);

const SOURCES = [
  { layer: "第一層：MOPS董事會決議", stage: "董事會決議", url: `${CBAS_BASE}/GetBoardAnnouncement` },
  { layer: "第二層：CBAS預計發行", stage: "生效後", url: `${CBAS_BASE}/GetRecentlyEffectively` },
  { layer: "第三層：CBAS已發行（近期掛牌）", stage: "已發行", url: `${CBAS_BASE}/GetRecentlyListed` },
];

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,%]/g, "").trim()) || 0;
}

function cleanCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function isAuction(text) {
  return String(text || "").includes("競拍");
}

function rocToIso(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]) + 1911;
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function monthStarts(count = HISTORY_MONTHS) {
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

function taipeiTimestamp(value = Date.now()) {
  const date = new Date(value);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(safeDate).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour === "24" ? "00" : parts.hour}${parts.minute}${parts.second}`;
}

function normalizeTwseRows(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((row) => ({
    date: rocToIso(row[0]),
    close: num(row[6]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexRows(payload) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  if (!Array.isArray(table?.data)) return [];
  return table.data.map((row) => ({
    date: rocToIso(row[0]),
    close: num(row[6]),
  })).filter((row) => row.date && row.close);
}

function sma(values, length, offset = 0) {
  const end = values.length - offset;
  const start = end - length;
  if (start < 0 || end <= 0) return 0;
  const slice = values.slice(start, end);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function avg(values) {
  const rows = values.map(num).filter((value) => value > 0);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function emaSeries(values, length) {
  if (!values.length) return [];
  const multiplier = 2 / (length + 1);
  const result = [];
  values.forEach((value, index) => {
    result[index] = index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier);
  });
  return result;
}

function macdSnapshot(values) {
  if (values.length < 35) return { histogram: 0, prevHistogram: 0, goldenCross: false, rising: false };
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macdLine = values.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const signalLine = emaSeries(macdLine, 9);
  const histogram = (macdLine.at(-1) || 0) - (signalLine.at(-1) || 0);
  const prevHistogram = (macdLine.at(-2) || 0) - (signalLine.at(-2) || 0);
  return {
    histogram,
    prevHistogram,
    goldenCross: prevHistogram <= 0 && histogram > 0,
    rising: histogram > prevHistogram,
  };
}

async function fetchOfficialJson(url, timeout = 12000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
        Referer: url.includes("tpex.org.tw") ? "https://www.tpex.org.tw/" : "https://www.twse.com.tw/",
        ...extraHeaders,
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTwseMonth(code, date) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
  const payload = await fetchOfficialJson(url);
  if (payload?.stat && payload.stat !== "OK") return [];
  return normalizeTwseRows(payload);
}

async function fetchTpexMonth(code, date) {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(date)}&id=&response=json`;
  const payload = await fetchOfficialJson(url);
  return normalizeTpexRows(payload);
}

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  return timestamps.map((timestamp, index) => {
    const close = num(closes[index]);
    if (!timestamp || !close) return null;
    const date = new Date(timestamp * 1000);
    return {
      date: date.toISOString().slice(0, 10),
      close,
      volume: num(volumes[index]),
    };
  }).filter(Boolean);
}

async function fetchYahooHistory(code, suffix) {
  const symbol = `${code}.${suffix}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=18mo&interval=1d&events=history&includeAdjustedClose=true`;
  const payload = await fetchOfficialJson(url, 15000);
  return normalizeYahooRows(payload);
}

async function fetchYahoo60mHistory(code, suffix) {
  const symbol = `${code}.${suffix}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${INTRADAY_60M_RANGE}&interval=60m&includePrePost=false&events=history`;
  const payload = await fetchOfficialJson(url, 15000);
  return normalizeYahooRows(payload);
}

async function fetchFugleQuote(code) {
  if (!FUGLE_API_KEY) return null;
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(code)}`;
  const payload = await fetchOfficialJson(url, 15000, {
    "X-API-KEY": FUGLE_API_KEY,
    Referer: "https://developer.fugle.tw/",
  });
  const price = num(payload?.lastPrice) || num(payload?.closePrice) || num(payload?.previousClose);
  if (!price) return null;
  return {
    price,
    source: "fugle",
    quoteDate: String(payload?.date || payload?.time || "").slice(0, 10).replaceAll("-", "") || "",
  };
}

async function fetchFinMindSnapshot(code) {
  if (!FINMIND_API_TOKEN) return null;
  const url = new URL("https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot");
  url.searchParams.set("data_id", code);
  url.searchParams.set("token", FINMIND_API_TOKEN);
  let payload = null;
  try {
    payload = await fetchOfficialJson(url.toString(), 15000, {
      Referer: "https://finmindtrade.com/",
    });
  } catch {
    return fetchFinMindDailyQuote(code);
  }
  const row = Array.isArray(payload?.data) ? payload.data[0] : null;
  const price = num(row?.close) || num(row?.last_price) || num(row?.lastPrice);
  if (!price) return fetchFinMindDailyQuote(code);
  return {
    price,
    source: "finmind",
    quoteDate: String(row?.date || row?.time || "").slice(0, 10).replaceAll("-", "") || "",
  };
}

async function fetchFinMindDailyQuote(code) {
  if (!FINMIND_API_TOKEN) return null;
  const start = new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", "TaiwanStockPrice");
  url.searchParams.set("data_id", code);
  url.searchParams.set("start_date", start);
  url.searchParams.set("token", FINMIND_API_TOKEN);
  const payload = await fetchOfficialJson(url.toString(), 15000, {
    Referer: "https://finmindtrade.com/",
  });
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const row = rows
    .filter((item) => num(item?.close))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .at(-1);
  const price = num(row?.close);
  if (!price) return null;
  return {
    price,
    source: "finmind-daily",
    quoteDate: String(row?.date || "").slice(0, 10).replaceAll("-", "") || "",
  };
}

async function fetchHistory(code) {
  const yahoo60Results = await Promise.allSettled(["TW", "TWO"].map((suffix) => fetchYahoo60mHistory(code, suffix)));
  const yahoo60Rows = yahoo60Results
    .filter((result) => result.status === "fulfilled" && result.value.length)
    .sort((a, b) => b.value.length - a.value.length)[0]?.value || [];
  if (yahoo60Rows.length) {
    const yahooDailyResults = await Promise.allSettled(["TW", "TWO"].map((suffix) => fetchYahooHistory(code, suffix)));
    const dailyRows = yahooDailyResults
      .filter((result) => result.status === "fulfilled" && result.value.length)
      .sort((a, b) => b.value.length - a.value.length)[0]?.value || [];
    return { code, market: "YAHOO_60M", timeframe: "60m", rows: yahoo60Rows, dailyRows };
  }

  const months = monthStarts();
  const twseResults = await Promise.allSettled(months.map((item) => fetchTwseMonth(code, item.twse)));
  let market = "TWSE";
  let rows = twseResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (rows.length < 80) {
    market = "TPEX";
    const tpexResults = await Promise.allSettled(months.map((item) => fetchTpexMonth(code, item.tpex)));
    rows = tpexResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
  if (rows.length < 200) {
    const yahooResults = await Promise.allSettled(["TW", "TWO"].map((suffix) => fetchYahooHistory(code, suffix)));
    const yahooRows = yahooResults
      .filter((result) => result.status === "fulfilled" && result.value.length > rows.length)
      .sort((a, b) => b.value.length - a.value.length)[0]?.value || [];
    if (yahooRows.length > rows.length) {
      market = "YAHOO";
      rows = yahooRows;
    }
  }
  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  return { code, market, timeframe: "1d", rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function loadStockMap() {
  try {
    const payload = JSON.parse(await fs.readFile(STOCKS_FILE, "utf8"));
    const rows = Array.isArray(payload?.stocks) ? payload.stocks : [];
    const map = new Map(rows.map((stock) => [cleanCode(stock.code), stock]).filter(([code]) => code));
    try {
      const institutionPayload = JSON.parse(await fs.readFile(INSTITUTION_FILE, "utf8"));
      const institutionRows = Array.isArray(institutionPayload?.rows)
        ? institutionPayload.rows
        : Object.values(institutionPayload?.data || {});
      institutionRows.forEach((row) => {
        const code = cleanCode(row?.code);
        if (!code) return;
        map.set(code, { ...(map.get(code) || {}), ...row });
      });
    } catch {
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadQuoteMap(codes) {
  const entries = await mapLimit(codes, HISTORY_CONCURRENCY, async (code) => {
    try {
      const fugle = await fetchFugleQuote(code);
      if (fugle) return [code, fugle];
    } catch {
    }
    try {
      const finmind = await fetchFinMindSnapshot(code);
      if (finmind) return [code, finmind];
    } catch {
    }
    return [code, null];
  });
  return new Map(entries.filter(([, quote]) => quote));
}

async function probeFinMindQuotes(codes) {
  if (!FINMIND_API_TOKEN) {
    return { checked: 0, rows: 0, ok: false, reason: "not configured" };
  }
  const sample = [...new Set(codes)].slice(0, 8);
  let rows = 0;
  let failures = 0;
  await mapLimit(sample, 2, async (code) => {
    try {
      const quote = await fetchFinMindSnapshot(code);
      if (quote) rows += 1;
    } catch {
      failures += 1;
    }
  });
  return {
    checked: sample.length,
    rows,
    failures,
    ok: rows > 0,
    reason: rows > 0 ? "available" : "no snapshot rows from sampled codes",
  };
}

function technicalFromHistory(history) {
  const rows = history?.rows || [];
  const dailyRows = history?.dailyRows || [];
  const closes = rows.map((row) => num(row.close)).filter(Boolean);
  const dailyCloses = dailyRows.map((row) => num(row.close)).filter(Boolean);
  const volumes = rows.map((row) => num(row.volume)).filter((value) => value > 0);
  const latestClose = closes.at(-1) || 0;
  const dailyMa5 = sma(dailyCloses, 5);
  const dailyMa10 = sma(dailyCloses, 10);
  const dailyMa5Prev = sma(dailyCloses, 5, 1);
  const dailyMa10Prev = sma(dailyCloses, 10, 1);
  const dailyShortSupport = Boolean(latestClose && ((dailyMa5 && latestClose >= dailyMa5 * 0.99) || (dailyMa10 && latestClose >= dailyMa10 * 0.99)));
  const dailyShortRising = Boolean((dailyMa5 && dailyMa5 >= dailyMa5Prev) || (dailyMa10 && dailyMa10 >= dailyMa10Prev));
  const latestVolume = volumes.at(-1) || 0;
  const avg20Volume = volumes.length >= 20 ? avg(volumes.slice(-20)) : 0;
  const previousAvg20Volume = volumes.length >= 21 ? avg(volumes.slice(-21, -1)) : avg20Volume;
  const volumeRatio20 = latestVolume && avg20Volume ? latestVolume / avg20Volume : 0;
  const volumeExpanding = Boolean(latestVolume && avg20Volume && (volumeRatio20 >= 1.2 || avg20Volume > previousAvg20Volume));
  const timeframe = history?.timeframe || "";
  if (timeframe !== "60m") {
    return {
      stockPrice: latestClose,
      aboveMa200: null,
      maAlignedUp: null,
      ma200Rising: null,
      allMaRising: null,
      macdBullish: null,
      technicalPass: false,
      technicalScore: 0,
      tags: ["缺少60分K資料，CB技術門檻不通過"],
      ma5: 0,
      ma35: 0,
      ma200: 0,
      dailyMa5,
      dailyMa10,
      dailyShortSupport,
      dailyShortRising,
      latestVolume,
      avg20Volume,
      volumeRatio20,
      volumeExpanding,
      historyCount: closes.length,
      timeframe,
    };
  }
  if (closes.length < 200) {
    return {
      stockPrice: latestClose,
      aboveMa200: null,
      maAlignedUp: null,
      ma200Rising: null,
      allMaRising: null,
      macdBullish: null,
      technicalPass: false,
      technicalScore: 0,
      tags: [`60分K歷史不足 ${closes.length}/200，CB技術門檻不通過`],
      ma5: sma(closes, 5),
      ma35: sma(closes, 35),
      ma200: 0,
      dailyMa5,
      dailyMa10,
      dailyShortSupport,
      dailyShortRising,
      latestVolume,
      avg20Volume,
      volumeRatio20,
      volumeExpanding,
      historyCount: closes.length,
      timeframe,
    };
  }
  const ma5 = sma(closes, 5);
  const ma35 = sma(closes, 35);
  const ma200 = sma(closes, 200);
  const ma5Prev = sma(closes, 5, 1);
  const ma35Prev = sma(closes, 35, 1);
  const ma200Prev = sma(closes, 200, 1);
  const aboveMa200 = latestClose > ma200;
  const ma5Rising = ma5 > ma5Prev;
  const ma35Rising = ma35 > ma35Prev;
  const ma200Rising = ma200 > ma200Prev;
  const allMaRising = ma5Rising && ma35Rising && ma200Rising;
  const maAlignedUp = ma5 > ma35 && ma35 > ma200 && allMaRising;
  const technicalPass = (aboveMa200 && ma200Rising) || allMaRising;
  const macd = macdSnapshot(closes);
  const macdBullish = macd.rising || macd.goldenCross;
  const technicalScore = (aboveMa200 && ma200Rising ? 10 : 0) + (allMaRising ? 10 : 0) + (macdBullish ? 5 : 0);
  const tags = [];
  if (aboveMa200 && ma200Rising) tags.push("60分K站上MA200且MA200向上 +10");
  if (allMaRising) tags.push("60分MA5/MA35/MA200均線同時向上 +10");
  if (dailyShortSupport) tags.push("日K MA5/MA10支撐");
  if (volumeExpanding) tags.push("60分量能放大");
  if (!technicalPass) tags.push("60分K未符合CB技術門檻，一票否決");
  if (macdBullish) tags.push(macd.goldenCross ? "MACD黃金交叉 +5" : "MACD柱狀向上 +5");
  return {
    stockPrice: latestClose,
    aboveMa200,
    maAlignedUp,
    ma5Rising,
    ma35Rising,
    ma200Rising,
    allMaRising,
    technicalPass,
    macdBullish,
    technicalScore,
    tags,
    ma5,
    ma35,
    ma200,
    dailyMa5,
    dailyMa10,
    dailyShortSupport,
    dailyShortRising,
    latestVolume,
    avg20Volume,
    volumeRatio20: Number(volumeRatio20.toFixed(2)),
    volumeExpanding,
    macdHistogram: macd.histogram,
    macdPrevHistogram: macd.prevHistogram,
    historyCount: closes.length,
    timeframe,
  };
}

function premiumValue(row) {
  const range = premiumRange(row);
  return range.mid || 0;
}

function parsePremiumToken(value) {
  const raw = num(value);
  if (!raw) return 0;
  return raw > 100 ? raw - 100 : raw;
}

function premiumRange(row) {
  const issuedPremium = parsePremiumToken(row.premium_rate || row.conversion_premium_rate);
  if (issuedPremium) {
    return { low: issuedPremium, high: issuedPremium, mid: issuedPremium, source: "official" };
  }
  const text = String(row.tentative_premium_rate || "").replace(/％/g, "%");
  const matches = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => parsePremiumToken(match[0])).filter((value) => value > 0);
  if (matches.length >= 2) {
    const low = Math.min(...matches);
    const high = Math.max(...matches);
    return { low, high, mid: (low + high) / 2, source: "tentative" };
  }
  if (matches.length === 1) {
    return { low: matches[0], high: matches[0], mid: matches[0], source: "tentative" };
  }
  return { low: 0, high: 0, mid: 0, source: "missing" };
}

function buildConversionEstimate({ stockPrice, convertPrice, premium }) {
  const price = num(stockPrice);
  const official = num(convertPrice);
  if (official) {
    return {
      status: "official",
      label: "正式轉換價",
      effectiveConvertPrice: official,
      estimatedConvertPriceLow: 0,
      estimatedConvertPriceHigh: 0,
      estimatedConvertPriceMid: 0,
      missingReason: "",
    };
  }
  if (price && premium?.source === "tentative" && premium.mid > 0) {
    const low = price * (1 + premium.low / 100);
    const high = price * (1 + premium.high / 100);
    return {
      status: "estimated",
      label: "預估轉換價",
      effectiveConvertPrice: (low + high) / 2,
      estimatedConvertPriceLow: roundPrice(low),
      estimatedConvertPriceHigh: roundPrice(high),
      estimatedConvertPriceMid: roundPrice((low + high) / 2),
      missingReason: "CBAS尚未揭露正式轉換價，先用暫定溢價率與現股價估算",
    };
  }
  return {
    status: "missing",
    label: "缺轉換價",
    effectiveConvertPrice: 0,
    estimatedConvertPriceLow: 0,
    estimatedConvertPriceHigh: 0,
    estimatedConvertPriceMid: 0,
    missingReason: price ? "CBAS尚未揭露正式轉換價或暫定溢價率" : "缺現股價與正式轉換價",
  };
}

function roundPrice(value) {
  const price = num(value);
  if (!price) return 0;
  if (price < 10) return Number(price.toFixed(2));
  if (price < 50) return Number(price.toFixed(2));
  if (price < 100) return Number(price.toFixed(1));
  return Number(price.toFixed(0));
}

function pct(value) {
  if (!Number.isFinite(value)) return 0;
  return Number((value * 100).toFixed(2));
}

function truthyFlag(value) {
  if (value === true || value === 1) return true;
  const text = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "黑名單", "不適合"].includes(text);
}

function volumeShares(value) {
  const raw = num(value);
  if (!raw) return 0;
  return raw < 100000 ? raw * 1000 : raw;
}

function buildExclusion({ code, stock, technical }) {
  const reasons = [];
  const stockCode = cleanCode(code);
  const name = String(stock?.name || "");
  const statusText = String(stock?.status || stock?.tradingStatus || stock?.tradeStatus || stock?.note || "");
  const joinedText = `${stockCode} ${name} ${statusText}`;
  const avgVolume5 = volumeShares(stock?.avg_volume_5 || stock?.avgVolume5 || stock?.fiveDayAvgVolume);
  const tradeVolume = volumeShares(stock?.tradeVolume || technical?.latestVolume);
  const innerOuterVolume = volumeShares(stock?.innerOuterVolume || stock?.insideOutsideVolume || stock?.accumulatedBidAskVolume);
  const lowAvgVolume = avgVolume5 > 0 && avgVolume5 < 3000000;
  const lowRealtimeVolume = tradeVolume > 0 && tradeVolume < 3000000;
  const lowInnerOuterVolume = innerOuterVolume > 0 && innerOuterVolume < 3000000;

  if (stockCode.startsWith("00")) reasons.push("00開頭/ETF");
  if (/(ETF|ETN|DR|指數|權證|認購|認售|牛證|熊證|CB)/i.test(joinedText)) {
    reasons.push("ETF/ETN/DR/指數/權證/CB/非普通股");
  }
  if (truthyFlag(stock?.is_blacklisted || stock?.blacklisted)) reasons.push("黑名單");
  if (truthyFlag(stock?.is_daytrade_unsuitable || stock?.daytradeUnsuitable)) reasons.push("當沖不適合");
  if (/(停牌|暫停交易|停止交易|試撮|試搓|suspend|halt)/i.test(statusText)) reasons.push("停牌/試撮");
  if (/^11\d{2}$/.test(stockCode)) reasons.push("水泥族群");
  if (/(軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附)/i.test(joinedText)) {
    reasons.push("軍工/國防/航太");
  }
  if (lowAvgVolume) reasons.push("量能不足：avg_volume_5 < 3000張");
  if (lowInnerOuterVolume) reasons.push("量能不足：累計內外盤量不足");
  if (!lowAvgVolume && !lowInnerOuterVolume && lowRealtimeVolume) reasons.push("量能不足：即時成交量不足");

  return {
    excluded: reasons.length > 0,
    reasons: [...new Set(reasons)],
    avgVolume5,
    tradeVolume,
    innerOuterVolume,
  };
}

function buildEntryPlan({ stockPrice, convertPrice, technical, conversionInfo }) {
  const price = num(stockPrice);
  const conversion = num(convertPrice) || num(conversionInfo?.effectiveConvertPrice);
  const hasOfficialConversion = num(convertPrice) > 0;
  const hasEstimatedConversion = !hasOfficialConversion && conversionInfo?.status === "estimated" && conversion > 0;
  const ma5 = num(technical?.ma5);
  const ma35 = num(technical?.ma35);
  const ma200 = num(technical?.ma200);
  const dailyMa5 = num(technical?.dailyMa5);
  const dailyMa10 = num(technical?.dailyMa10);
  const technicalPass = technical?.technicalPass === true;
  const ma200Rising = technical?.ma200Rising === true;
  const ma35Rising = technical?.ma35Rising === true;
  const allMaRising = technical?.allMaRising === true;
  const dailyShortSupport = technical?.dailyShortSupport === true;
  const dailyShortRising = technical?.dailyShortRising === true;
  const volumeRatio20 = num(technical?.volumeRatio20);
  const volumeExpanding = technical?.volumeExpanding === true || volumeRatio20 >= 1.2;
  const distance = price && conversion ? (price / conversion) - 1 : 0;
  const idealLow = conversion ? conversion * 0.92 : 0;
  const idealHigh = conversion ? conversion * 0.97 : 0;
  const breakout = conversion ? conversion * 1.01 : 0;
  const lowRiskEntry = ma35 || dailyMa5 || dailyMa10 || ma5 || idealHigh || price;
  const supportStop = Math.max(
    0,
    ma35 ? ma35 * 0.985 : 0,
    ma200 && price > ma200 ? ma200 * 0.985 : 0
  );
  const target1 = conversion || (price ? price * 1.08 : 0);
  const target2 = conversion ? conversion * 1.12 : (price ? price * 1.15 : 0);
  const preferredEntry = price && conversion && distance >= -0.1 && distance <= 0.03
    ? price
    : (idealHigh || price);
  const fallbackStop = preferredEntry ? preferredEntry * 0.93 : (price ? price * 0.93 : 0);
  const stopLoss = preferredEntry
    ? Math.min(supportStop || fallbackStop, preferredEntry * 0.96)
    : (supportStop || fallbackStop);
  const risk = preferredEntry && stopLoss ? preferredEntry - stopLoss : 0;
  const reward = preferredEntry && target2 ? target2 - preferredEntry : 0;
  const riskReward = price && conversion && risk > 0 && reward > 0 ? Number((reward / risk).toFixed(2)) : 0;
  let signal = "wait";
  let label = "等待";
  const tags = [];
  const nearMa35Pullback = Boolean(price && ma35 && price >= ma35 * 0.985 && price <= ma35 * 1.035);
  const nearDailyShortPullback = Boolean(price && ((dailyMa5 && price >= dailyMa5 * 0.99 && price <= dailyMa5 * 1.035) || (dailyMa10 && price >= dailyMa10 * 0.99 && price <= dailyMa10 * 1.035)));
  const aboveShortSupport = Boolean(price && ((ma5 && price >= ma5 * 0.99) || (ma35 && price >= ma35 * 0.99) || dailyShortSupport));
  const lowRiskPass = Boolean(hasOfficialConversion && price && conversion && technicalPass && (nearMa35Pullback || nearDailyShortPullback) && aboveShortSupport && (ma35Rising || ma200Rising || allMaRising || dailyShortRising));
  const stealthPass = Boolean(hasOfficialConversion && price && conversion && technicalPass && distance >= -0.08 && distance <= -0.03 && ma200Rising && volumeExpanding);
  const breakoutPass = Boolean(hasOfficialConversion && price && conversion && price >= breakout && volumeRatio20 >= 1.5);
  const lowRiskStop = lowRiskEntry ? Math.min(lowRiskEntry * 0.96, (ma35 || lowRiskEntry) * 0.985) : 0;
  const models = [
    {
      id: "stealth-below-conversion",
      label: "潛伏型",
      pass: stealthPass,
      entry: roundPrice(price || idealHigh),
      stopLoss: roundPrice(stopLoss),
      target1: roundPrice(target1),
      target2: roundPrice(target2),
      reason: stealthPass
        ? "轉換價下方3%~8%，60分K站上MA200且MA200上彎，量能開始放大"
        : "等待股價落在轉換價下方3%~8%，且60分量能放大",
    },
    {
      id: "low-risk-pullback",
      label: "低風險回測支撐",
      pass: lowRiskPass,
      entry: roundPrice(lowRiskEntry),
      stopLoss: roundPrice(lowRiskStop),
      target1: roundPrice(target1),
      target2: roundPrice(target2),
      reason: lowRiskPass
        ? "股價轉強後回測60分K MA35或日K MA5/MA10支撐不破"
        : "等待股價回測60分K MA35、日K MA5/MA10或前高支撐不破",
    },
    {
      id: "conversion-breakout",
      label: "突破型",
      pass: breakoutPass,
      entry: roundPrice(breakout),
      stopLoss: roundPrice(conversion * 0.97 || stopLoss),
      target1: roundPrice(conversion * 1.08 || target1),
      target2: roundPrice(conversion * 1.15 || target2),
      reason: breakoutPass
        ? "股價站上轉換價且60分量能大於20均量1.5倍"
        : "等待站上轉換價且60分量能大於20均量1.5倍",
    },
  ];
  const selectedModel = models.find((model) => model.pass) || null;

  if (!price || !conversion) {
    tags.push(conversionInfo?.missingReason || "缺現股價或轉換價");
  } else if (hasEstimatedConversion) {
    tags.push("正式轉換價未揭露，僅用暫定溢價估算觀察區間");
  } else if (!technicalPass) {
    tags.push("60分K門檻未通過");
  } else if (selectedModel?.id === "low-risk-pullback") {
    signal = "low-risk-pullback";
    label = "低風險回測";
    tags.push("回測支撐不破");
  } else if (selectedModel?.id === "stealth-below-conversion") {
    signal = "early-entry";
    label = "潛伏進場";
    tags.push("轉換價下方3%~8%且量能放大");
  } else if (selectedModel?.id === "conversion-breakout") {
    signal = "breakout";
    label = "突破進場";
    tags.push("站上轉換價且量能>20均量1.5倍");
  } else if (distance > -0.03 && distance <= 0.03) {
    signal = "near-conversion";
    label = "貼近轉換價";
    tags.push("股價貼近轉換價");
  } else if (distance > 0.03 && distance <= 0.12) {
    signal = "breakout";
    label = "突破追蹤";
    tags.push("已突破轉換價，等回測或放量續強");
  } else if (distance < -0.1) {
    tags.push("距轉換價仍遠");
  } else {
    tags.push("已離轉換價較遠");
  }

  if (hasOfficialConversion && price && conversion && riskReward >= 2) tags.push("風報比>=2");
  if (price && preferredEntry && price > preferredEntry * 1.08) tags.push("現價高於理想進場區");

  return {
    signal,
    label,
    conversionDistancePct: pct(distance),
    volumeRatio20: Number(volumeRatio20.toFixed(2)),
    volumeExpanding,
    selectedModel: selectedModel?.id || "",
    entryModels: models,
    idealEntryLow: roundPrice(idealLow),
    idealEntryHigh: roundPrice(idealHigh),
    breakoutEntry: roundPrice(breakout),
    preferredEntry: roundPrice(preferredEntry),
    stopLoss: roundPrice(stopLoss),
    target1: roundPrice(target1),
    target2: roundPrice(target2),
    riskReward: hasOfficialConversion ? riskReward : 0,
    hasOfficialConversion,
    hasEstimatedConversion,
    conversionPriceStatus: conversionInfo?.status || (hasOfficialConversion ? "official" : "missing"),
    conversionPriceLabel: conversionInfo?.label || (hasOfficialConversion ? "正式轉換價" : "缺轉換價"),
    missingReason: conversionInfo?.missingReason || "",
    entryDataCompleteness: hasOfficialConversion ? "full" : (hasEstimatedConversion ? "estimated" : "missing"),
    entryDataCompletenessLabel: hasOfficialConversion ? "完整" : (hasEstimatedConversion ? "預估" : "缺轉換價"),
    tradable: Boolean(hasOfficialConversion && selectedModel),
    tradableLabel: hasOfficialConversion ? (selectedModel ? "可交易" : "等訊號") : (hasEstimatedConversion ? "僅觀察" : "不可交易"),
    tradableReason: hasOfficialConversion ? (selectedModel ? "正式轉換價與進場模型通過" : "有正式轉換價但進場模型未通過") : (hasEstimatedConversion ? "只有暫定溢價估算，不能當正式進場價" : (conversionInfo?.missingReason || "缺正式轉換價")),
    tags,
  };
}

function scoreRow(row, source, technical = {}, entryPlan = {}) {
  const breakdown = {
    cbEvent: 0,
    technical: 0,
    entryModel: 0,
    volume: 0,
    riskReward: 0,
  };
  const tags = [];
  const circulation = num(row.circulation);
  const premium = premiumValue(row);
  const auction = isAuction(row.inquiry_auction);
  const selectedModel = String(entryPlan.selectedModel || "");
  const distance = num(entryPlan.conversionDistancePct);
  const volumeRatio20 = num(entryPlan.volumeRatio20);
  const riskReward = num(entryPlan.riskReward);
  const hasEntryPrices = entryPlan.hasOfficialConversion === true;

  if (source.stage === "董事會決議") {
    breakdown.cbEvent += 5;
    tags.push("董事會決議 +5");
  } else if (source.stage === "生效後") {
    breakdown.cbEvent += 10;
    tags.push("近期生效 +10");
  } else {
    breakdown.cbEvent += 8;
    tags.push("近期掛牌 +8");
  }

  if (auction) {
    breakdown.cbEvent += 8;
    tags.push("競價拍賣 +8");
  } else if (row.inquiry_auction) {
    tags.push("詢價圈購");
  }

  if (circulation > 0 && circulation <= 10) {
    breakdown.cbEvent += 5;
    tags.push("發行規模10億以下 +5");
  } else if (circulation > 20) {
    tags.push("發行規模偏大");
  }

  if (premium > 0 && premium <= 20) {
    breakdown.cbEvent += 4;
    tags.push("轉換溢價20%以下 +4");
  } else if (premium > 30) {
    tags.push("溢價偏高");
  }

  breakdown.cbEvent = Math.min(25, breakdown.cbEvent);

  if (technical.technicalPass === false) {
    tags.push("60分K未符合CB技術門檻，一票否決");
  } else {
    tags.push(...(technical.tags || ["技術面待確認"]));
    if (technical.aboveMa200 && technical.ma200Rising) {
      breakdown.technical += 12;
      tags.push("60分K站上MA200且MA200上彎 +12");
    }
    if (technical.allMaRising) {
      breakdown.technical += 8;
      tags.push("MA5/MA35/MA200同步上彎 +8");
    }
    if (technical.dailyShortSupport) {
      breakdown.technical += 5;
      tags.push("日K MA5/MA10支撐 +5");
    }
    if (technical.macdBullish) {
      breakdown.technical += 5;
      tags.push("MACD轉強 +5");
    }
  }
  breakdown.technical = Math.min(30, breakdown.technical);

  if (selectedModel === "stealth-below-conversion") {
    breakdown.entryModel += 25;
    tags.push("潛伏型通過 +25");
  } else if (selectedModel === "low-risk-pullback") {
    breakdown.entryModel += 20;
    tags.push("低風險回測通過 +20");
  } else if (selectedModel === "conversion-breakout") {
    breakdown.entryModel += 18;
    tags.push("突破型通過 +18");
  } else if (hasEntryPrices && distance >= -8 && distance <= 3) {
    breakdown.entryModel += 8;
    tags.push("貼近轉換價觀察 +8");
  }

  if (volumeRatio20 >= 1.5) {
    breakdown.volume += 10;
    tags.push("60分量比20>=1.5 +10");
  } else if (volumeRatio20 >= 1.2) {
    breakdown.volume += 6;
    tags.push("60分量比20>=1.2 +6");
  } else if (entryPlan.volumeExpanding) {
    breakdown.volume += 4;
    tags.push("量能開始放大 +4");
  }

  if (riskReward >= 3) {
    breakdown.riskReward += 10;
    tags.push("風報比>=3 +10");
  } else if (riskReward >= 2) {
    breakdown.riskReward += 7;
    tags.push("風報比>=2 +7");
  } else if (riskReward >= 1.5) {
    breakdown.riskReward += 4;
    tags.push("風報比>=1.5 +4");
  }

  const baseScore = breakdown.cbEvent + breakdown.technical;
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    baseScore: Math.min(55, baseScore),
    score: Math.min(100, score),
    scoreBreakdown: breakdown,
    tags: [...new Set(tags)],
  };
}

function entryModelRank(row) {
  const model = String(row.selectedEntryModel || "");
  if (model === "stealth-below-conversion") return 0;
  if (model === "low-risk-pullback") return 1;
  if (model === "conversion-breakout") return 2;
  if (row.entrySignal === "near-conversion") return 3;
  return 9;
}

function compareCandidates(a, b) {
  return (
    entryModelRank(a) - entryModelRank(b)
    || b.score - a.score
    || b.riskReward - a.riskReward
    || Math.abs(num(a.conversionDistancePct)) - Math.abs(num(b.conversionDistancePct))
    || num(a.issueAmount) - num(b.issueAmount)
  );
}

function compactByUnderlyingStock(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = cleanCode(row.code || row.cbCode);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.values()].map((group) => {
    const sorted = [...group].sort(compareCandidates);
    const best = sorted[0];
    const related = sorted.slice(1).map((row) => ({
      code: row.code,
      cbCode: row.cbCode,
      cbName: row.cbName,
      stage: row.stage,
      auctionType: row.auctionType,
      issueAmount: row.issueAmount,
      date: row.date,
      score: row.score,
      entryLabel: row.entryLabel,
      selectedEntryModel: row.selectedEntryModel,
    }));
    return {
      ...best,
      relatedCbCount: sorted.length - 1,
      relatedCbRows: related,
    };
  });
}

function normalize(row, source, stockMap, technicalMap, quoteMap) {
  const code = String(row.code || row.convert_target_code || "").trim();
  const cbCode = String(row.cb_code || row.bond_code || "").trim();
  const cbName = String(row.cb_name || row.underlying_bond || "").trim();
  const premiumInfo = premiumRange(row);
  const premium = premiumInfo.mid || 0;
  const stock = stockMap.get(cleanCode(code)) || {};
  const technical = technicalMap.get(cleanCode(code)) || {};
  const quote = quoteMap.get(cleanCode(code)) || {};
  const stockPrice = num(row.underlying_stock_market_price) || num(quote.price) || num(stock.close) || num(technical.stockPrice);
  const convertPrice = num(row.conversion_price);
  const conversionInfo = buildConversionEstimate({ stockPrice, convertPrice, premium: premiumInfo });
  const stockPriceSource = num(row.underlying_stock_market_price) ? "cbas"
    : quote.source || (num(stock.close) ? "stocks-slim" : (num(technical.stockPrice) ? "yahoo-60m" : ""));
  const entryPlan = buildEntryPlan({ stockPrice, convertPrice, technical, conversionInfo });
  const scored = scoreRow(row, source, technical, entryPlan);
  const exclusion = buildExclusion({ code, stock, technical });
  const scoreDetail = {
    event: scored.scoreBreakdown.cbEvent || 0,
    technical: scored.scoreBreakdown.technical || 0,
    entryModel: scored.scoreBreakdown.entryModel || 0,
    volume: scored.scoreBreakdown.volume || 0,
    riskReward: scored.scoreBreakdown.riskReward || 0,
    entryCompleteness: entryPlan.hasOfficialConversion ? 20 : (entryPlan.hasEstimatedConversion ? 8 : 0),
    tradable: entryPlan.tradable ? 10 : 0,
  };
  return {
    sourceLayer: source.layer,
    stage: source.stage,
    code,
    cbCode,
    name: code || cbCode,
    cbName,
    issueAmount: row.circulation || "",
    auctionType: row.inquiry_auction || "",
    convertPrice,
    stockPrice,
    premium,
    premiumLow: premiumInfo.low || 0,
    premiumHigh: premiumInfo.high || 0,
    premiumSource: premiumInfo.source,
    conversionPriceStatus: entryPlan.conversionPriceStatus,
    conversionPriceLabel: entryPlan.conversionPriceLabel,
    estimatedConvertPriceLow: conversionInfo.estimatedConvertPriceLow,
    estimatedConvertPriceHigh: conversionInfo.estimatedConvertPriceHigh,
    estimatedConvertPriceMid: conversionInfo.estimatedConvertPriceMid,
    effectiveConvertPrice: conversionInfo.effectiveConvertPrice,
    missingConversionReason: entryPlan.missingReason,
    entryDataCompleteness: entryPlan.entryDataCompleteness,
    entryDataCompletenessLabel: entryPlan.entryDataCompletenessLabel,
    tradable: entryPlan.tradable,
    tradableLabel: entryPlan.tradableLabel,
    tradableReason: entryPlan.tradableReason,
    conversionDistancePct: entryPlan.conversionDistancePct,
    entrySignal: entryPlan.signal,
    entryLabel: entryPlan.label,
    selectedEntryModel: entryPlan.selectedModel,
    entryModels: entryPlan.entryModels,
    volumeRatio20: entryPlan.volumeRatio20,
    volumeExpanding: entryPlan.volumeExpanding,
    idealEntryLow: entryPlan.idealEntryLow,
    idealEntryHigh: entryPlan.idealEntryHigh,
    breakoutEntry: entryPlan.breakoutEntry,
    preferredEntry: entryPlan.preferredEntry,
    stopLoss: entryPlan.stopLoss,
    target1: entryPlan.target1,
    target2: entryPlan.target2,
    riskReward: entryPlan.riskReward,
    entryPlan,
    date: row.announcement_day || row.expected_effective_date || row.listing_day || row.issue_date || "",
    tcri: row.tcri || row.guarantee_situation || "",
    baseScore: scored.baseScore,
    score: scored.score,
    scoreBreakdown: scored.scoreBreakdown,
    scoreDetail,
    aboveMa200: technical.aboveMa200 ?? null,
    maAlignedUp: technical.maAlignedUp ?? null,
    ma5Rising: technical.ma5Rising ?? null,
    ma35Rising: technical.ma35Rising ?? null,
    ma200Rising: technical.ma200Rising ?? null,
    allMaRising: technical.allMaRising ?? null,
    technicalPass: technical.technicalPass ?? null,
    macdBullish: technical.macdBullish ?? null,
    ma5: technical.ma5 || 0,
    ma35: technical.ma35 || 0,
    ma200: technical.ma200 || 0,
    dailyMa5: technical.dailyMa5 || 0,
    dailyMa10: technical.dailyMa10 || 0,
    dailyShortSupport: technical.dailyShortSupport ?? null,
    dailyShortRising: technical.dailyShortRising ?? null,
    avgVolume5: exclusion.avgVolume5,
    tradeVolume: exclusion.tradeVolume,
    innerOuterVolume: exclusion.innerOuterVolume,
    macdHistogram: technical.macdHistogram || 0,
    historyCount: technical.historyCount || 0,
    technicalTimeframe: technical.timeframe || "",
    stockPriceSource,
    quoteDate: quote.quoteDate || stock.quoteDate || "",
    excluded: exclusion.excluded,
    exclusionReasons: exclusion.reasons,
    veto: technical.technicalPass !== true || exclusion.excluded,
    tags: [...new Set([...scored.tags, ...entryPlan.tags, ...exclusion.reasons])],
    raw: row,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const json = await response.json();
  if (json.statusClass !== 1 || !Array.isArray(json.result)) {
    throw new Error(`${url} unexpected response`);
  }
  return json.result;
}

async function main() {
  const rows = [];
  const sourceCounts = {};
  const stockMap = await loadStockMap();
  for (const source of SOURCES) {
    const data = await fetchJson(source.url);
    sourceCounts[source.layer] = data.length;
    rows.push(...data);
  }

  const codes = [...new Set(rows.map((row) => cleanCode(row.code || row.convert_target_code)).filter(Boolean))];
  const quoteMap = await loadQuoteMap(codes);
  const finmindProbe = await probeFinMindQuotes(codes);
  const histories = await mapLimit(codes, HISTORY_CONCURRENCY, async (code) => {
    try {
      const history = await fetchHistory(code);
      return [code, technicalFromHistory(history)];
    } catch (error) {
      return [code, { technicalScore: 0, tags: [`技術面讀取失敗: ${error.message}`] }];
    }
  });
  const technicalMap = new Map(histories);

  const normalizedRows = [];
  for (const source of SOURCES) {
    const data = await fetchJson(source.url);
    normalizedRows.push(...data.map((row) => normalize(row, source, stockMap, technicalMap, quoteMap)));
  }

  const allCandidates = normalizedRows
    .filter((row) => row.code || row.cbCode);
  const exclusionReasonCounts = {};
  allCandidates.forEach((row) => {
    (row.exclusionReasons || []).forEach((reason) => {
      exclusionReasonCounts[reason] = (exclusionReasonCounts[reason] || 0) + 1;
    });
  });
  const candidates = allCandidates
    .filter((row) => !row.veto)
    .sort(compareCandidates);
  const compactCandidates = compactByUnderlyingStock(candidates)
    .sort(compareCandidates);

  const updatedAt = new Date().toISOString();
  const runId = `cb-detect-${taipeiTimestamp(updatedAt)}`;
  const payload = {
    ok: true,
    complete: true,
    runId,
    qualityStatus: compactCandidates.length ? "complete" : "empty",
    count: compactCandidates.length,
    source: "CBAS",
    updatedAt,
    sourceCounts,
    excludedCounts: {
      veto: allCandidates.length - candidates.length,
      duplicateUnderlying: candidates.length - compactCandidates.length,
      byReason: exclusionReasonCounts,
    },
    quoteSources: {
      fugleConfigured: Boolean(FUGLE_API_KEY),
      finmindConfigured: Boolean(FINMIND_API_TOKEN),
      fugleRows: [...quoteMap.values()].filter((quote) => quote.source === "fugle").length,
      finmindRows: [...quoteMap.values()].filter((quote) => String(quote.source || "").startsWith("finmind")).length,
      finmindProbe,
    },
    scoringNote: "CBAS supplies CB source/issuance terms. Stock price prefers CBAS/Fugle/FinMind/stocks-slim. CB technical gate uses 60-minute K data: pass only when 60m close is above MA200 and MA200 is rising, or when 60m MA5/MA35/MA200 are all rising. Rows failing this 60m gate are excluded from display. Score is now 100 points: CB event 25, technical strength 30, entry model 25, volume 10, risk/reward 10. Sorting prioritizes stealth entry, then low-risk pullback, then conversion breakout, then near-conversion watchlist. Exclusions remove 00-prefix products, ETF/ETN/DR/index/warrant/CB/non-common stocks, blacklisted/daytrade-unsuitable/suspended/trial-match rows, cement/defense/aerospace names, and low-liquidity rows under 3000 lots by 5-day average, inner/outer volume, or realtime volume when available. Multiple CBs for the same underlying stock are compacted to the best-ranked CB row, with the other CBs kept under relatedCbRows.",
    rows: compactCandidates,
  };

  const snapshot = await upsertSnapshot("cb_detect_latest", payload, {
    source: "cb-detect-api-only",
    reason: "cb-detect-complete-run",
  });
  if (!snapshot.ok) throw new Error(`cb-detect Supabase snapshot write failed: ${snapshot.error || snapshot.reason || "unknown"}`);
  console.log(`cb-detect API-only: wrote Supabase snapshot (${compactCandidates.length} rows, compacted ${candidates.length - compactCandidates.length} same-stock CB rows)`);
  console.log(compactCandidates.slice(0, 12).map((row) => `${row.score} ${row.sourceLayer} ${row.code} ${row.cbName} ${row.tags.join(" / ")}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});






