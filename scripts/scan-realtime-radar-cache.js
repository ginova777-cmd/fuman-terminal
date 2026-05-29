const fs = require("fs");
const path = require("path");
const { cleanNumber, isIntradayTradable } = require("./intraday-radar-rules");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("realtime-radar-latest.json");
const SCORECARD_FILE = dataPath("realtime-radar-scorecard-latest.json");
const SCORECARD_HISTORY_DIR = dataPath("realtime-radar-scorecard-history");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const SUPABASE_URL = process.env.FUMAN_SUPABASE_URL || "https://jxnqyqnigsppqsxinlrq.supabase.co";
const SUPABASE_KEY = process.env.FUMAN_SUPABASE_SERVICE_KEY || process.env.FUMAN_SUPABASE_KEY || "";
const SUPABASE_TABLE = process.env.FUMAN_REALTIME_RADAR_TABLE || "fuman_realtime_radar_cache";
const STALE_AFTER_MS = Number(process.env.REALTIME_RADAR_STALE_MS || 20000);
const MAX_QUOTE_AGE_SECONDS = Number(process.env.REALTIME_RADAR_MAX_QUOTE_AGE_SECONDS || 150);
const REALTIME_RESCAN_BATCH_SIZE = Number(process.env.REALTIME_RADAR_RESCAN_BATCH_SIZE || 80);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function roundTradePrice(price) {
  const value = cleanNumber(price);
  if (!value) return 0;
  const tick = value >= 1000 ? 5 : value >= 500 ? 1 : value >= 100 ? 0.5 : value >= 50 ? 0.1 : value >= 10 ? 0.05 : 0.01;
  return Math.round(value / tick) * tick;
}

function timeOnly(value) {
  return String(value || "").match(/\d{2}:\d{2}(?::\d{2})?/)?.[0] || "";
}

function updateRealtimeRadarScorecard(payload) {
  if (payload.status !== "ok" || !Array.isArray(payload.rows)) return;
  const existing = readJson(SCORECARD_FILE, { rows: [] });
  const sameDate = existing.date === payload.date;
  const rows = sameDate && Array.isArray(existing.rows) ? existing.rows : [];
  const byCode = new Map(rows.map((row) => [String(row.code || ""), row]));
  for (const item of payload.rows) {
    const code = String(item.code || "");
    if (!code) continue;
    const price = roundTradePrice(item.close);
    if (!price) continue;
    const high = roundTradePrice(item.high || item.close);
    const current = byCode.get(code);
    if (!current) {
      const row = {
        date: payload.date,
        code,
        name: item.name || "",
        entryAt: payload.timestamp,
        entryTime: timeOnly(payload.timestamp),
        entryPrice: price,
        dayHigh: high || price,
        highestPrice: high || price,
        highestAt: payload.timestamp,
        signalSide: item.side || "",
        signalTags: Array.isArray(item.signalTags) ? item.signalTags.join(" / ") : "",
        score: item.score ?? "",
        profit: Math.round(((high || price) - price) * 1000),
      };
      rows.push(row);
      byCode.set(code, row);
      continue;
    }
    const currentHigh = Number(current.dayHigh || current.highestPrice || current.entryPrice || 0);
    if (high > currentHigh) {
      current.dayHigh = high;
      current.highestPrice = high;
      current.highestAt = payload.timestamp;
    }
    current.name = current.name || item.name || "";
    current.signalSide = current.signalSide || item.side || "";
    current.signalTags = current.signalTags || (Array.isArray(item.signalTags) ? item.signalTags.join(" / ") : "");
    current.score = Math.max(Number(current.score || 0), Number(item.score || 0)) || current.score || "";
    current.profit = Math.round((Number(current.dayHigh || current.highestPrice || current.entryPrice) - Number(current.entryPrice)) * 1000);
  }
  rows.sort((a, b) => String(a.entryAt || "").localeCompare(String(b.entryAt || "")) || String(a.code || "").localeCompare(String(b.code || "")));
  const totalProfit = rows.reduce((sum, row) => sum + (Number(row.profit) || 0), 0);
  const scorecard = {
    source: "terminal-realtime-radar-events",
    sourceFile: "data/realtime-radar-latest.json",
    date: payload.date,
    updatedAt: payload.updatedAt,
    total: rows.length,
    totalProfit,
    rows,
  };
  writeJson(SCORECARD_FILE, scorecard);
  writeJson(path.join(SCORECARD_HISTORY_DIR, `${payload.date.replace(/-/g, "")}.json`), scorecard);
}

async function uploadRealtimeRadarPayload(payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${SUPABASE_TABLE}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: "latest",
      payload,
      updated_at: new Date(payload.updatedAtMs || Date.now()).toISOString(),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`supabase upload failed HTTP ${response.status} ${text}`.trim());
  }
  return true;
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function secondsOfDay(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function quoteAgeSeconds(scanTimestamp, quoteTime) {
  const scanSeconds = secondsOfDay(scanTimestamp);
  const quoteSeconds = secondsOfDay(quoteTime);
  if (scanSeconds == null || quoteSeconds == null) return null;
  return Math.abs(scanSeconds - quoteSeconds);
}

function hasFreshQuote(stock, scanTimestamp) {
  const age = quoteAgeSeconds(scanTimestamp, stock.quoteTime || stock.time);
  return age != null && age <= MAX_QUOTE_AGE_SECONDS;
}

function chunkStocks(stocks = [], size = REALTIME_RESCAN_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < stocks.length; index += size) {
    const batchStocks = stocks.slice(index, index + size);
    chunks.push({ stocks: batchStocks, codes: batchStocks.map((stock) => stock.code).filter(Boolean) });
  }
  return chunks.filter((batch) => batch.codes.length);
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "FumanRealtimeRadarCache/1.0" } });
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
  const failedBatches = [];
  let totalBatches = 0;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batchStocks = stocks.slice(i, i + batchSize);
    const codes = batchStocks.map((stock) => stock.code);
    if (!codes.length) continue;
    const batchIndex = totalBatches + 1;
    totalBatches += 1;
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 20000);
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
    } catch (error) {
      failedBatches.push({
        batchIndex,
        startCode: codes[0],
        endCode: codes.at(-1),
        count: codes.length,
        codes,
        stocks: batchStocks,
        error: error.message,
      });
      console.log(`realtime batch deferred #${batchIndex} ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  const batchByCode = new Map();
  for (let i = 0; i < stocks.length; i += batchSize) {
    const codes = stocks.slice(i, i + batchSize).map((stock) => stock.code).filter(Boolean);
    const batchIndex = Math.floor(i / batchSize) + 1;
    for (const code of codes) {
      batchByCode.set(code, { batchIndex, startCode: codes[0], endCode: codes.at(-1) });
    }
  }
  const liveStocks = applyRealtimeQuotes(stocks, quotes).map((stock) => ({
    ...stock,
    realtimeBatch: batchByCode.get(stock.code) || null,
  }));
  return { stocks: liveStocks, failedBatches, totalBatches, quoteCount: quotes.size };
}

function applyRealtimeQuotes(stocks, quotes) {
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return stock;
    const volume = cleanNumber(quote.tradeVolume) || cleanNumber(stock.tradeVolume);
    const close = cleanNumber(quote.close) || cleanNumber(stock.close);
    return {
      ...stock,
      ...quote,
      close,
      quoteTime: quote.time || "",
      quoteSource: "api/realtime",
      tradeVolume: volume,
      value: volume && close ? volume * close * 1000 : cleanNumber(stock.value),
      isRealtime: true,
    };
  });
}

async function rescanRealtimeBatches(failedBatches = []) {
  const quotes = new Map();
  let recoveredBatches = 0;
  for (const batch of failedBatches) {
    const codes = batch.codes || [];
    if (!codes.length) continue;
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 20000);
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
      recoveredBatches += 1;
    } catch (error) {
      console.log(`realtime deferred batch failed ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  return { quotes, recoveredBatches };
}

function buildFailedBatchDetails(failedBatches = []) {
  return failedBatches.map((batch) => ({
    batchIndex: batch.batchIndex || "",
    range: batch.startCode && batch.endCode ? `${batch.startCode}-${batch.endCode}` : "",
    count: batch.count || (batch.codes || []).length,
    sampleCodes: (batch.codes || []).slice(0, 12).join(","),
    error: String(batch.error || "").slice(0, 240),
  }));
}

function buildStaleQuoteDetails(staleStocks = [], scanTimestamp = "") {
  return staleStocks
    .map((stock) => {
      const batch = stock.realtimeBatch || {};
      const quoteTime = stock.quoteTime || stock.time || "";
      return {
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        quoteTime,
        quoteAgeSeconds: quoteAgeSeconds(scanTimestamp, quoteTime),
        batchIndex: batch.batchIndex || "",
        batchRange: batch.startCode && batch.endCode ? `${batch.startCode}-${batch.endCode}` : "",
        close: cleanNumber(stock.close),
        percent: cleanNumber(stock.percent),
      };
    })
    .sort((a, b) => (Number(b.quoteAgeSeconds) || 0) - (Number(a.quoteAgeSeconds) || 0) || a.code.localeCompare(b.code))
    .slice(0, 80);
}

function radarSignalTags(stock) {
  const tags = [];
  const pct = cleanNumber(stock.percent);
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high);
  const low = cleanNumber(stock.low);
  const bodyPct = open ? ((close - open) / open) * 100 : 0;

  if (close && open && close > open && bodyPct >= 3) tags.push("長紅逾3%");
  if (close && open && close < open && bodyPct <= -1.5) tags.push("長黑轉弱");
  if (value >= 1000000000 || (volume >= 5000 && Math.abs(pct) >= 1.2)) tags.push("即時爆量");
  if (pct >= 3) tags.push("短線急拉");
  if (pct >= 1.5 && value >= 200000000) tags.push("短線強勢");
  if (pct <= -3) tags.push("急殺");
  if (pct <= -1.5 && value >= 200000000) tags.push("短線轉弱");
  if (high && close && close >= high * 0.985 && pct > 0) tags.push("逼近日高");
  if (low && close && close <= low * 1.015 && pct < 0) tags.push("貼近日低");
  return [...new Set(tags)];
}

function radarFlowValue(stock) {
  const value = cleanNumber(stock.value);
  const pct = Math.abs(cleanNumber(stock.percent));
  const tags = stock.signalTags?.length || 0;
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const volumeBoost = volume >= 10000 ? 0.18 : volume >= 5000 ? 0.12 : 0.06;
  const signalBoost = Math.min(tags * 0.11, 0.46);
  const moveBoost = Math.min(pct / 9, 0.42);
  return value * (0.55 + signalBoost + moveBoost + volumeBoost);
}

function radarSignalScore(stock) {
  const pct = Math.abs(cleanNumber(stock.percent));
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const tagScore = (stock.signalTags?.length || 0) * 16;
  const moveScore = Math.min(pct * 7, 32);
  const valueScore = Math.min(Math.log10(Math.max(value, 1)) * 5, 46);
  const volumeScore = Math.min(Math.log10(Math.max(volume, 1)) * 5, 22);
  return Math.max(1, Math.min(100, Math.round(tagScore + moveScore + valueScore + volumeScore - 42)));
}

function buildRadarRows(stocks, detectedAt) {
  return stocks
    .filter(isIntradayTradable)
    .map((stock) => {
      const pct = cleanNumber(stock.percent);
      const close = cleanNumber(stock.close);
      const volume = cleanNumber(stock.tradeVolume || stock.volume);
      const value = cleanNumber(stock.value) || close * volume * 1000;
      const signalTags = radarSignalTags({ ...stock, percent: pct, value });
      const hasLongSignal =
        signalTags.some((tag) => /逼近|爆量|強勢|急拉|長紅/.test(tag)) ||
        pct >= 3 ||
        (pct >= 1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct > 0) ||
        (volume >= 5000 && pct >= 1.2);
      const hasShortSignal =
        signalTags.some((tag) => /急殺|轉弱|長黑|貼近/.test(tag)) ||
        pct <= -3 ||
        (pct <= -1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct < 0) ||
        (volume >= 5000 && pct <= -1.2);
      const side = hasLongSignal && (!hasShortSignal || pct >= 0) ? "long" : hasShortSignal ? "short" : "";
      const row = {
        ...stock,
        pct,
        percent: pct,
        value,
        volume,
        side,
        trust: 0,
        foreign: 0,
        totalInst: 0,
        signalTags,
        detectedAt,
      };
      row.score = radarSignalScore(row);
      row.flow = radarFlowValue(row);
      return row;
    })
    .filter((stock) => stock.value > 0 && stock.side && stock.signalTags.length)
    .sort((a, b) => b.score - a.score || b.value - a.value)
    .slice(0, 80);
}

async function main() {
  const parts = taipeiParts();
  const key = dateKey(parts);
  const detectedAt = Date.now();
  const timestamp = timestampKey(parts);
  if (!isMarketTime(parts)) {
    const payload = {
      source: "mini-pc-realtime-radar",
      status: "outside_market_time",
      date: key,
      timestamp,
      updatedAt: new Date(detectedAt).toISOString(),
      updatedAtMs: detectedAt,
      staleAfterMs: STALE_AFTER_MS,
      maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
      staleQuoteCount: 0,
      rows: [],
      longCount: 0,
      shortCount: 0,
    };
    writeJson(OUT_FILE, payload);
    await uploadRealtimeRadarPayload(payload);
    console.log(`realtime radar skipped outside market time ${timestamp}`);
    return;
  }

  const rawStocks = await fetchStocks();
  const realtime = await fetchRealtime(rawStocks);
  const liveStocks = realtime.stocks;
  const freshStocks = liveStocks.filter((stock) => stock.isRealtime === true && hasFreshQuote(stock, timestamp));
  const staleStocks = liveStocks.filter((stock) => stock.isRealtime === true && !hasFreshQuote(stock, timestamp));
  const staleQuoteCount = staleStocks.length;
  const staleQuoteDetails = buildStaleQuoteDetails(staleStocks, timestamp);
  const failedBatchDetails = buildFailedBatchDetails(realtime.failedBatches);
  const rows = buildRadarRows(freshStocks, detectedAt);
  let payload = {
    source: "mini-pc-realtime-radar",
    status: realtime.failedBatches.length ? "degraded" : "ok",
    date: key,
    timestamp,
    updatedAt: new Date(detectedAt).toISOString(),
    updatedAtMs: detectedAt,
    staleAfterMs: STALE_AFTER_MS,
    maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
    staleQuoteCount,
    failedBatchCount: realtime.failedBatches.length,
    totalBatchCount: realtime.totalBatches,
    quoteCount: realtime.quoteCount,
    staleQuoteDetails,
    failedBatchDetails,
    rows,
    longCount: rows.filter((row) => row.side === "long").length,
    shortCount: rows.filter((row) => row.side === "short").length,
  };
  if (!rows.length && realtime.failedBatches.length) {
    const previous = readJson(OUT_FILE, null);
    if (previous?.status !== "outside_market_time" && previous?.date === key && Array.isArray(previous.rows) && previous.rows.length) {
      payload = {
        ...previous,
        status: "degraded_keepalive",
        timestamp,
        updatedAt: new Date(detectedAt).toISOString(),
        updatedAtMs: detectedAt,
        staleAfterMs: STALE_AFTER_MS,
        maxQuoteAgeSeconds: MAX_QUOTE_AGE_SECONDS,
        staleQuoteCount,
        failedBatchCount: realtime.failedBatches.length,
        totalBatchCount: realtime.totalBatches,
        quoteCount: realtime.quoteCount,
        staleQuoteDetails,
        failedBatchDetails,
        lastFailedScanAt: timestamp,
      };
      console.log(`realtime radar ${timestamp}: kept previous rows ${previous.rows.length} after ${realtime.failedBatches.length}/${realtime.totalBatches} failed batches`);
    }
  }
  writeJson(OUT_FILE, payload);
  if (payload.status !== "degraded_keepalive") updateRealtimeRadarScorecard(payload);
  await uploadRealtimeRadarPayload(payload);
  console.log(`realtime radar ${timestamp}: rows ${payload.rows.length} status ${payload.status} failed ${realtime.failedBatches.length}/${realtime.totalBatches}`);

  const deferredBatches = [...realtime.failedBatches, ...chunkStocks(staleStocks)];
  if (deferredBatches.length) {
    const retry = await rescanRealtimeBatches(deferredBatches);
    if (retry.quotes.size) {
      const retryStocks = applyRealtimeQuotes(deferredBatches.flatMap((batch) => batch.stocks || []), retry.quotes)
        .filter((stock) => stock.isRealtime === true && hasFreshQuote(stock, timestamp));
      const retryRows = buildRadarRows(retryStocks, detectedAt);
      const mergedRows = [...retryRows, ...payload.rows]
        .filter((row, index, rows) => rows.findIndex((item) => item.code === row.code) === index)
        .sort((a, b) => b.score - a.score || b.value - a.value)
        .slice(0, 80);
      if (mergedRows.length > payload.rows.length) {
        const patchedPayload = {
          ...payload,
          status: "ok_after_deferred_rescan",
          rows: mergedRows,
          longCount: mergedRows.filter((row) => row.side === "long").length,
          shortCount: mergedRows.filter((row) => row.side === "short").length,
          recoveredBatchCount: retry.recoveredBatches,
          staleRescanCount: staleStocks.length,
        };
        writeJson(OUT_FILE, patchedPayload);
        updateRealtimeRadarScorecard(patchedPayload);
        await uploadRealtimeRadarPayload(patchedPayload);
        console.log(`realtime radar ${timestamp}: deferred rescan merged rows ${mergedRows.length} recovered ${retry.recoveredBatches}/${deferredBatches.length}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


