const fs = require("fs");
const path = require("path");
const { hasLineConfig, sendLineText } = require("./line-push");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");
const { cleanNumber, isIntradayTradable } = require("./intraday-radar-rules");
const { isTwseTradingDay } = require("./twse-trading-day");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "realtime-radar-latest.json");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(ROOT, "state");
const FAILED_QUEUE_FILE = path.join(STATE_DIR, "realtime-radar-failed-batches.json");
const ALERT_STATUS_FILE = path.join(STATE_DIR, "realtime-radar-alert-status.json");
const SUPABASE_STATUS_FILE = path.join(STATE_DIR, "realtime-radar-supabase-status.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = process.env.FUMAN_SUPABASE_URL
  || process.env.SUPABASE_URL
  || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  || "https://jxnqyqnigsppqsxinlrq.supabase.co";
const SUPABASE_KEY = process.env.FUMAN_SUPABASE_SERVICE_KEY
  || process.env.FUMAN_SUPABASE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"))
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const SUPABASE_TABLE = process.env.FUMAN_REALTIME_RADAR_TABLE || "fuman_realtime_radar_cache";
const STALE_AFTER_MS = Number(process.env.REALTIME_RADAR_STALE_MS || 20000);
const MAX_QUOTE_AGE_SECONDS = Number(process.env.REALTIME_RADAR_MAX_QUOTE_AGE_SECONDS || 150);
const REALTIME_RESCAN_BATCH_SIZE = Number(process.env.REALTIME_RADAR_RESCAN_BATCH_SIZE || 80);
const REALTIME_BATCH_TIMEOUT_MS = Number(process.env.REALTIME_RADAR_BATCH_TIMEOUT_MS || 10000);
const REALTIME_BATCH_CONCURRENCY = Math.max(1, Number(process.env.REALTIME_RADAR_BATCH_CONCURRENCY || 6));
const REALTIME_RADAR_ALERT_COOLDOWN_MS = Math.max(0, Number(process.env.REALTIME_RADAR_ALERT_COOLDOWN_MS || 15 * 60 * 1000));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

async function sendOpsText(text) {
  if (hasTelegramConfig()) {
    await sendTelegramText(text);
    return "telegram";
  }
  if (hasLineConfig()) {
    await sendLineText(text);
    return "line";
  }
  return "";
}

function alertSignature(payload) {
  const staleCodes = (payload.staleQuoteDetails || []).map((item) => item.code).filter(Boolean).join(",");
  const issues = (payload.externalSourceIssues || [])
    .map((item) => `${item.source}:${item.type}:${item.status || ""}:${item.count || 0}:${item.sampleCodes || ""}`)
    .join("|");
  return `${payload.date || ""}|stale=${payload.staleQuoteCount || 0}:${staleCodes}|issues=${issues}|failed=${payload.failedBatchCount || 0}`;
}

async function maybeSendRealtimeRadarAlert(payload) {
  if (process.env.REALTIME_RADAR_NOTIFY === "0") return;
  const staleDetails = payload.staleQuoteDetails || [];
  const issues = payload.externalSourceIssues || [];
  const hasProblem = Number(payload.staleQuoteCount || 0) > 0 || Number(payload.failedBatchCount || 0) > 0 || issues.length > 0;
  if (!hasProblem) return;
  const previous = readJson(ALERT_STATUS_FILE, {});
  const signature = alertSignature(payload);
  const lastAlertAt = previous.lastAlertAt ? Date.parse(previous.lastAlertAt) : 0;
  if (previous.signature === signature && lastAlertAt && Date.now() - lastAlertAt < REALTIME_RADAR_ALERT_COOLDOWN_MS) return;
  const staleLines = staleDetails.slice(0, 10).map((item) => `${item.code} ${item.name || ""} age=${item.quoteAgeSeconds ?? ""}s quote=${item.quoteTime || "--"}`);
  const issueLines = issues.slice(0, 8).map((item) => `${item.source || ""} ${item.type || ""}${item.status ? ` HTTP ${item.status}` : ""} x${item.count || 0}${item.sampleCodes ? ` ${item.sampleCodes}` : ""}`.trim());
  const text = [
    `即時雷達資料源警示｜${payload.timestamp || ""}`,
    `狀態：${payload.status || ""}`,
    `staleQuoteCount：${payload.staleQuoteCount || 0}`,
    `failedBatch：${payload.failedBatchCount || 0}/${payload.totalBatchCount || 0}`,
    staleLines.length ? "" : null,
    staleLines.length ? "stale 標的：" : null,
    ...staleLines,
    issueLines.length ? "" : null,
    issueLines.length ? "外部資料源：" : null,
    ...issueLines,
  ].filter((line) => line !== null).join("\n");
  try {
    const channel = await sendOpsText(text);
    writeJson(ALERT_STATUS_FILE, { signature, lastAlertAt: new Date().toISOString(), channel, lastError: "" });
  } catch (error) {
    writeJson(ALERT_STATUS_FILE, { signature, lastAlertAt: previous.lastAlertAt || "", channel: "", lastError: String(error.message || error).slice(0, 500), checkedAt: new Date().toISOString() });
    console.log(`realtime radar alert failed: ${error.message}`);
  }
}

function normalizeDeferredBatch(batch = {}, reason = "failed_batch") {
  const codes = (batch.codes || []).map((code) => String(code || "")).filter(Boolean);
  return {
    reason: batch.reason || reason,
    batchIndex: batch.batchIndex || "",
    startCode: batch.startCode || codes[0] || "",
    endCode: batch.endCode || codes.at(-1) || "",
    count: batch.count || codes.length,
    codes,
    error: String(batch.error || "").slice(0, 240),
    failedAt: batch.failedAt || new Date().toISOString(),
  };
}

function readFailedBatchQueue() {
  const payload = readJson(FAILED_QUEUE_FILE, { batches: [] });
  return Array.isArray(payload?.batches) ? payload.batches : [];
}

function writeFailedBatchQueue(batches = []) {
  const byKey = new Map();
  for (const batch of batches) {
    const normalized = normalizeDeferredBatch(batch, batch.reason || "failed_batch");
    if (!normalized.codes.length) continue;
    byKey.set(normalized.codes.join(","), normalized);
  }
  const queue = [...byKey.values()].slice(0, 60);
  writeJson(FAILED_QUEUE_FILE, { updatedAt: new Date().toISOString(), count: queue.length, batches: queue });
}

function hydrateQueuedBatches(queuedBatches = [], stocks = []) {
  const stockByCode = new Map(stocks.map((stock) => [String(stock.code || ""), stock]));
  return queuedBatches.map((batch) => {
    const codes = (batch.codes || []).map((code) => String(code || "")).filter(Boolean);
    return { ...batch, codes, stocks: codes.map((code) => stockByCode.get(code)).filter(Boolean) };
  }).filter((batch) => batch.codes.length && batch.stocks.length);
}

function updateSupabaseUploadStatus(ok, error = "") {
  const previous = readJson(SUPABASE_STATUS_FILE, { consecutiveFailures: 0 });
  const payload = {
    ok,
    checkedAt: new Date().toISOString(),
    consecutiveFailures: ok ? 0 : Number(previous.consecutiveFailures || 0) + 1,
    lastSuccessAt: ok ? new Date().toISOString() : previous.lastSuccessAt || "",
    lastErrorAt: ok ? previous.lastErrorAt || "" : new Date().toISOString(),
    lastError: ok ? "" : String(error || "").slice(0, 500),
  };
  writeJson(SUPABASE_STATUS_FILE, payload);
  return payload;
}

async function safeUploadRealtimeRadarPayload(payload) {
  try {
    const uploaded = await uploadRealtimeRadarPayload(payload);
    return updateSupabaseUploadStatus(uploaded !== false, uploaded === false ? "Supabase credentials missing; upload skipped." : "");
  } catch (error) {
    console.log(`realtime radar supabase upload failed: ${error.message}`);
    return updateSupabaseUploadStatus(false, error.message);
  }
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
        stock_type: stock.stock_type ?? stock.stockType,
        industry: stock.industry || stock.officialIndustry || stock.primaryIndustry || "",
        officialIndustry: stock.officialIndustry || "",
        primaryIndustry: stock.primaryIndustry || "",
        is_active: stock.is_active ?? stock.isActive,
        is_etf: stock.is_etf ?? stock.isEtf,
        is_warrant: stock.is_warrant ?? stock.isWarrant,
        is_cb: stock.is_cb ?? stock.isCb,
        is_blacklisted: stock.is_blacklisted ?? stock.isBlacklisted,
        is_daytrade_unsuitable: stock.is_daytrade_unsuitable ?? stock.isDaytradeUnsuitable,
        is_halted: stock.is_halted ?? stock.isHalted,
        is_trial: stock.is_trial ?? stock.isTrial,
        avg_volume_5: stock.avg_volume_5 ?? stock.avgVolume5,
        cumulative_bid_ask_volume: stock.cumulative_bid_ask_volume ?? stock.cumulativeBidAskVolume,
        cumulative_bid_volume: stock.cumulative_bid_volume ?? stock.cumulativeBidVolume,
        cumulative_ask_volume: stock.cumulative_ask_volume ?? stock.cumulativeAskVolume,
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

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}
async function fetchRealtime(stocks) {
  const quotes = new Map();
  const batchSize = 100;
  const failedBatches = [];
  const apiErrors = [];
  const fallbackRecovered = { fugle: 0, yahoo: 0 };
  const batches = [];
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batchStocks = stocks.slice(i, i + batchSize);
    const codes = batchStocks.map((stock) => stock.code);
    if (!codes.length) continue;
    batches.push({
      batchIndex: batches.length + 1,
      batchStocks,
      codes,
    });
  }
  await runWithConcurrency(batches, REALTIME_BATCH_CONCURRENCY, async ({ batchStocks, codes, batchIndex }) => {
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, REALTIME_BATCH_TIMEOUT_MS);
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
      (payload.errors || []).forEach((error) => apiErrors.push({ ...error, parentBatch: batchIndex }));
      fallbackRecovered.fugle += Number(payload.fallbackRecovered?.fugle || 0);
      fallbackRecovered.yahoo += Number(payload.fallbackRecovered?.yahoo || 0);
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
  });
  failedBatches.sort((a, b) => a.batchIndex - b.batchIndex);
  const batchByCode = new Map();
  for (const batch of batches) {
    for (const code of batch.codes) {
      batchByCode.set(code, { batchIndex: batch.batchIndex, startCode: batch.codes[0], endCode: batch.codes.at(-1) });
    }
  }
  const liveStocks = applyRealtimeQuotes(stocks, quotes).map((stock) => ({
    ...stock,
    realtimeBatch: batchByCode.get(stock.code) || null,
  }));
  const quoteSourceCounts = {};
  for (const stock of liveStocks) {
    if (!stock.isRealtime) continue;
    const source = stock.quoteSource || "unknown";
    quoteSourceCounts[source] = (quoteSourceCounts[source] || 0) + 1;
  }
  return { stocks: liveStocks, failedBatches, apiErrors, fallbackRecovered, quoteSourceCounts, totalBatches: batches.length, quoteCount: quotes.size };
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
      quoteSource: quote.quoteSource || quote.realtimeFallback || "api/realtime",
      tradeVolume: volume,
      value: volume && close ? volume * close * 1000 : cleanNumber(stock.value),
      isRealtime: true,
    };
  });
}

async function rescanRealtimeBatches(failedBatches = []) {
  const quotes = new Map();
  const stillFailedBatches = [];
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
      stillFailedBatches.push(normalizeDeferredBatch({ ...batch, error: error.message }, batch.reason || "retry_failed"));
      console.log(`realtime deferred batch failed ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  return { quotes, recoveredBatches, failedBatches: stillFailedBatches };
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

function httpStatusCounts(details = []) {
  const counts = {};
  for (const item of details) {
    const status = String(item.error || "").match(/HTTP\s+(\d{3})/i)?.[1] || "other";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function buildExternalSourceIssues({ failedBatchDetails = [], staleQuoteDetails = [] } = {}) {
  const issues = [];
  const httpCounts = httpStatusCounts(failedBatchDetails);
  for (const [status, count] of Object.entries(httpCounts)) {
    issues.push({ source: "api/realtime", type: "http_error", status, count });
  }
  if (staleQuoteDetails.length) {
    issues.push({
      source: "api/realtime",
      type: "stale_quote",
      count: staleQuoteDetails.length,
      sampleCodes: staleQuoteDetails.slice(0, 12).map((item) => item.code).join(","),
    });
  }
  return issues;
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

function staleQuoteLogText(staleQuoteDetails = [], staleQuoteCount = 0) {
  const count = Number(staleQuoteCount || 0);
  if (!count) return "stale 0";
  const sample = staleQuoteDetails
    .slice(0, 12)
    .map((item) => `${item.code}${item.quoteAgeSeconds ? `(${item.quoteAgeSeconds}s)` : ""}`)
    .join(",");
  return `stale ${count}${sample ? ` [${sample}]` : " [details empty]"}`;
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
  const tradingDay = await isTwseTradingDay(new Date(detectedAt), { stateDir: STATE_DIR });
  if (!tradingDay.isTradingDay) {
    writeFailedBatchQueue([]);
    console.log(`realtime radar skipped non-trading day ${tradingDay.date} (${tradingDay.reason}, source=${tradingDay.source})`);
    return;
  }
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
    await safeUploadRealtimeRadarPayload(payload);
    writeFailedBatchQueue([]);
    console.log(`realtime radar skipped outside market time ${timestamp}`);
    return;
  }

  const rawStocks = await fetchStocks();
  const queuedBatches = hydrateQueuedBatches(readFailedBatchQueue(), rawStocks);
  const realtime = await fetchRealtime(rawStocks);
  const liveStocks = realtime.stocks;
  const freshStocks = liveStocks.filter((stock) => stock.isRealtime === true && hasFreshQuote(stock, timestamp));
  const staleStocks = liveStocks.filter((stock) => stock.isRealtime === true && !hasFreshQuote(stock, timestamp));
  const staleQuoteCount = staleStocks.length;
  const staleQuoteDetails = buildStaleQuoteDetails(staleStocks, timestamp);
  const failedBatchDetails = buildFailedBatchDetails(realtime.failedBatches);
  const externalSourceIssues = buildExternalSourceIssues({ failedBatchDetails, staleQuoteDetails });
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
    quoteSourceCounts: realtime.quoteSourceCounts,
    fallbackRecovered: realtime.fallbackRecovered,
    apiErrorDetails: realtime.apiErrors,
    staleQuoteDetails,
    failedBatchDetails,
    externalSourceIssues,
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
        externalSourceIssues,
        lastFailedScanAt: timestamp,
      };
      console.log(`realtime radar ${timestamp}: kept previous rows ${previous.rows.length} after ${realtime.failedBatches.length}/${realtime.totalBatches} failed batches`);
    }
  }
  writeJson(OUT_FILE, payload);
  const supabaseUpload = await safeUploadRealtimeRadarPayload(payload);
  payload = { ...payload, supabaseUpload };
  writeJson(OUT_FILE, payload);
  await maybeSendRealtimeRadarAlert(payload);
  console.log(`realtime radar ${timestamp}: rows ${payload.rows.length} status ${payload.status} ${staleQuoteLogText(payload.staleQuoteDetails, payload.staleQuoteCount)} failed ${realtime.failedBatches.length}/${realtime.totalBatches}`);

  const deferredBatches = [...queuedBatches, ...realtime.failedBatches, ...chunkStocks(staleStocks).map((batch) => ({ ...batch, reason: "stale_quote" }))];
  let deferredRetry = null;
  if (deferredBatches.length) {
    const retry = await rescanRealtimeBatches(deferredBatches);
    deferredRetry = retry;
    if (retry.quotes.size) {
      const retryStocks = applyRealtimeQuotes(deferredBatches.flatMap((batch) => batch.stocks || []), retry.quotes)
        .filter((stock) => stock.isRealtime === true && hasFreshQuote(stock, timestamp));
      const retryRows = buildRadarRows(retryStocks, detectedAt);
      const mergedRows = [...retryRows, ...payload.rows]
        .filter((row, index, rows) => rows.findIndex((item) => item.code === row.code) === index)
        .sort((a, b) => b.score - a.score || b.value - a.value)
        .slice(0, 80);
      if (mergedRows.length > payload.rows.length) {
        const retryFreshCodes = new Set(retryStocks.map((stock) => String(stock.code || "")).filter(Boolean));
        const remainingStaleStocks = staleStocks.filter((stock) => !retryFreshCodes.has(String(stock.code || "")));
        const patchedStaleQuoteDetails = buildStaleQuoteDetails(remainingStaleStocks, timestamp);
        const patchedFailedBatchDetails = buildFailedBatchDetails(retry.failedBatches || []);
        const patchedPayload = {
          ...payload,
          status: "ok_after_deferred_rescan",
          rows: mergedRows,
          longCount: mergedRows.filter((row) => row.side === "long").length,
          shortCount: mergedRows.filter((row) => row.side === "short").length,
          recoveredBatchCount: retry.recoveredBatches,
          staleRescanCount: staleStocks.length,
          staleQuoteCount: remainingStaleStocks.length,
          staleQuoteDetails: patchedStaleQuoteDetails,
          failedBatchDetails: patchedFailedBatchDetails,
          externalSourceIssues: buildExternalSourceIssues({ failedBatchDetails: patchedFailedBatchDetails, staleQuoteDetails: patchedStaleQuoteDetails }),
        };
        writeJson(OUT_FILE, patchedPayload);
        await safeUploadRealtimeRadarPayload(patchedPayload);
        await maybeSendRealtimeRadarAlert(patchedPayload);
        console.log(`realtime radar ${timestamp}: deferred rescan merged rows ${mergedRows.length} ${staleQuoteLogText(patchedPayload.staleQuoteDetails, patchedPayload.staleQuoteCount)} recovered ${retry.recoveredBatches}/${deferredBatches.length}`);
      }
    }
  }
  writeFailedBatchQueue(deferredRetry ? deferredRetry.failedBatches || [] : realtime.failedBatches || []);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




