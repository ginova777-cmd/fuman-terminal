const fs = require("fs");
const path = require("path");
const { buildRanks, cleanNumber, detectSignals, isIntradayTradable, ma35SourceLabel } = require("./intraday-radar-rules");
const { rotateStrategy2IntradayCache } = require("./strategy2-cache-rotation");
const { overlayFugleWebSocketQuoteMap } = require("../lib/fugle-quote-overlay");
const { assertStrategy2SourcePublishGate } = require("../lib/strategy2-source-publish-gate");
const {
  auditRunTimeSourceSnapshot,
  buildRunTimeSourceSnapshotFields,
} = require("../lib/run-time-source-snapshot-contract");
const {
  fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchIntraday1m: fetchSupabaseFugleIntraday1m,
  fetchIntraday1mStatus,
  fetchQuotesByCodes: fetchSupabaseFugleQuotes,
  getStrategy2SourceHealth,
} = require("../lib/supabase-public-slot");

const { ROOT, dataPath, cachePath, dataOutputPaths } = require("./runtime-paths");
const CACHE_DIR = cachePath("intraday");
const SIGNAL_FILE = path.join(CACHE_DIR, "signals.json");
const SCORECARD_TRACK_FILE = path.join(CACHE_DIR, "scorecard-trades.json");
const STRATEGY5_TRACK_FILE = path.join(CACHE_DIR, "strategy5-scorecard-trades.json");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const STRATEGY2_API_ONLY = true;
const STRATEGY2_SCORECARD_SOURCE_FILE = dataPath("strategy2-scorecard-source.json");
const STRATEGY2_HISTORY_DIR = dataPath("strategy2-intraday-history");
const OPEN_BUY_SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");
const OPEN_BUY_FILE = dataPath("open-buy-latest.json");
const OPEN_BUY_BACKUP_FILE = dataPath("open-buy-backup.json");
const STAR_PREOPEN_FILE = dataPath("star-preopen-latest.json");
const STRATEGY3_SCORECARD_SOURCE_FILE = dataPath("strategy3-scorecard-source.json");
const STRATEGY3_FILE = dataPath("strategy3-latest.json");
const STRATEGY3_BACKUP_FILE = dataPath("strategy3-backup.json");
const STRATEGY5_FILE = dataPath("strategy5-latest.json");
const STRATEGY5_BACKUP_FILE = dataPath("strategy5-backup.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const MANAGER_MIN_ENTRY_TIME = process.env.TRADE_MANAGER_MIN_ENTRY_TIME || "09:05:00";
const MAX_QUOTE_AGE_SECONDS = Number(process.env.STRATEGY2_MAX_QUOTE_AGE_SECONDS || 150);
const SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS = Number(process.env.STRATEGY2_SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS || 120);
const SUPABASE_SOURCE_MIN_QUOTES = Number(process.env.STRATEGY2_SUPABASE_SOURCE_MIN_QUOTES || 500);
const SUPABASE_SOURCE_MIN_ACTIVE_SYMBOLS = Number(process.env.STRATEGY2_SUPABASE_SOURCE_MIN_ACTIVE_SYMBOLS || 500);
const MIN_AVG_5D_VOLUME = Number(process.env.STRATEGY2_MIN_AVG_5D_VOLUME || 0);
const SUPABASE_SHARED_SOURCE_ERROR_MESSAGE = "Supabase shared source 異常，等待資料恢復";
const QUOTE_CACHE_MAX_AGE_SECONDS = Number(process.env.STRATEGY2_QUOTE_CACHE_MAX_AGE_SECONDS || 15 * 60);
const MIN_REALTIME_COVERAGE = Number(process.env.STRATEGY2_MIN_REALTIME_COVERAGE || 0.5);
const REALTIME_BATCH_SIZE = Number(process.env.STRATEGY2_REALTIME_BATCH_SIZE || 8);
const REALTIME_RETRY_BATCH_SIZE = Number(process.env.STRATEGY2_REALTIME_RETRY_BATCH_SIZE || 4);
const REALTIME_BATCH_CONCURRENCY = Math.max(1, Number(process.env.STRATEGY2_REALTIME_BATCH_CONCURRENCY || 4));
const REALTIME_FUGLE_ONLY = process.env.STRATEGY2_REALTIME_FUGLE_ONLY === "1";
const REALTIME_FALLBACK_CANDIDATE_LIMIT = Math.max(0, Number(process.env.STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT || 1200));
const FORMAL_DAYTRADE_POOL_ONLY = process.env.STRATEGY2_FORMAL_DAYTRADE_POOL_ONLY === "1";
const FORMAL_DAYTRADE_PRIORITY_LIMIT = Math.max(1, Number(process.env.STRATEGY2_FORMAL_DAYTRADE_PRIORITY_LIMIT || process.env.DAYTRADE_FORMAL_PRIORITY_LIMIT || 40));
const PRIORITY_SYMBOLS_FILE = process.env.FUGLE_WS_PRIORITY_SYMBOLS_FILE
  || path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "cache", "intraday", "fugle-ws-priority-symbols.json");
const REALTIME_YAHOO_FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.STRATEGY2_REALTIME_YAHOO_FALLBACK_CONCURRENCY || 6));
const ENABLE_FINMIND_REALTIME = process.env.STRATEGY2_ENABLE_FINMIND_REALTIME === "1";
const ENABLE_FINMIND_RESCUE = process.env.STRATEGY2_ENABLE_FINMIND_RESCUE !== "0";
const REALTIME_RESCUE_COVERAGE = Number(process.env.STRATEGY2_REALTIME_RESCUE_COVERAGE || 0.7);
const REALTIME_RESCUE_LIMIT = Math.max(0, Number(process.env.STRATEGY2_REALTIME_RESCUE_LIMIT || 60));
const REALTIME_RESCUE_COOLDOWN_MS = Math.max(0, Number(process.env.STRATEGY2_REALTIME_RESCUE_COOLDOWN_MS || 30 * 1000));
const MIN_ENTRY_SOURCE_COVERAGE = Number(process.env.STRATEGY2_MIN_ENTRY_SOURCE_COVERAGE || 0.5);
const STRATEGY2_SCAN_START_MINUTES = Number(process.env.STRATEGY2_SCAN_START_MINUTES || (9 * 60));
const STRATEGY2_ENTRY_START_MINUTES = Number(process.env.STRATEGY2_ENTRY_START_MINUTES || (9 * 60));
const STRATEGY2_ENTRY_END_MINUTES = Number(process.env.STRATEGY2_ENTRY_END_MINUTES || (12 * 60));
const STRATEGY2_SCAN_END_MINUTES = Number(process.env.STRATEGY2_SCAN_END_MINUTES || (12 * 60));
const STRATEGY2_FORCE_SCAN = process.env.STRATEGY2_FORCE_SCAN === "1";
const STRATEGY2_OPEN_RUSH_END_MINUTES = Number(process.env.STRATEGY2_OPEN_RUSH_END_MINUTES || 9 * 60 + 10);
const STRATEGY2_EARLY_ATTACK_START_MINUTES = Number(process.env.STRATEGY2_EARLY_ATTACK_START_MINUTES || 9 * 60 + 30);
const STRATEGY2_EARLY_ATTACK_END_MINUTES = Number(process.env.STRATEGY2_EARLY_ATTACK_END_MINUTES || 10 * 60 + 30);
const STRATEGY2_1M_WARMUP_LIMIT = Math.max(1, Number(process.env.STRATEGY2_1M_WARMUP_LIMIT || 120));
const STRATEGY2_1M_STATUS_MAX_AGE_SECONDS = Math.max(240, Number(process.env.STRATEGY2_1M_STATUS_MAX_AGE_SECONDS || 15 * 60));
const STRATEGY2_1M_SUPABASE_SYNC = process.env.STRATEGY2_1M_SUPABASE_SYNC === "1";
const STRATEGY2_SKIP_SUPABASE_PUBLISH = process.env.STRATEGY2_SKIP_SUPABASE_PUBLISH === "1";
const MA35_PROVIDER_FAILURE_LIMIT = Math.max(1, Number(process.env.STRATEGY2_MA35_PROVIDER_FAILURE_LIMIT || 8));
const RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS = Math.max(0, Number(process.env.STRATEGY2_RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS || 4 * 60 * 60));
let lastRealtimeCoverageRescueAt = 0;

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const FUGLE_API_KEY = "";
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY
  || process.env.TWELVEDATA_API_KEY
  || readSecretText(path.join(ROOT, "secrets", "twelve-data-api-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "twelve-data-api-key.txt"));
const FINMIND_API_TOKEN = process.env.FINMIND_API_TOKEN
  || process.env.FINMIND_TOKEN
  || readSecretText(path.join(ROOT, "secrets", "finmind-api-token.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "finmind-api-token.txt"));
let yahooMa35Failures = 0;
let fugleMa35Failures = 0;
let yahooMa35BlockedReason = "";
let fugleMa35BlockedReason = "";
let twelveDataBlockedReason = "";
const yahooMa35NotFoundSymbols = new Set();

function disableMa35Provider(provider, reason) {
  if (provider === "yahoo" && !yahooMa35BlockedReason) {
    yahooMa35BlockedReason = reason;
    console.log(`sma35 1m yahoo disabled for this scan: ${reason}`);
  }
  if (provider === "fugle" && !fugleMa35BlockedReason) {
    fugleMa35BlockedReason = reason;
    console.log(`sma35 1m fugle disabled for this scan: ${reason}`);
  }
  if (provider === "twelve" && !twelveDataBlockedReason) {
    twelveDataBlockedReason = reason;
    console.log(`sma35 1m twelve disabled for this scan: ${reason}`);
  }
}

function noteMa35ProviderFailure(provider, reason) {
  if (provider === "yahoo") {
    yahooMa35Failures += 1;
    if (yahooMa35Failures >= MA35_PROVIDER_FAILURE_LIMIT) disableMa35Provider("yahoo", `${reason || "failed"}-${yahooMa35Failures}`);
  }
  if (provider === "fugle") {
    fugleMa35Failures += 1;
    if (/HTTP (?:401|403|429)/i.test(reason || "")) disableMa35Provider("fugle", reason);
    if (fugleMa35Failures >= MA35_PROVIDER_FAILURE_LIMIT) disableMa35Provider("fugle", `${reason || "failed"}-${fugleMa35Failures}`);
  }
  if (provider === "twelve") {
    if (/HTTP (?:401|403|429)/i.test(reason || "")) disableMa35Provider("twelve", reason);
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function formalDaytradePrioritySet() {
  if (!FORMAL_DAYTRADE_POOL_ONLY) return null;
  const payload = readJson(PRIORITY_SYMBOLS_FILE, {});
  const source = Array.isArray(payload.daytradePrioritySymbols)
    ? payload.daytradePrioritySymbols
    : Array.isArray(payload.daytradeSymbols)
      ? payload.daytradeSymbols
      : Array.isArray(payload.symbols)
        ? payload.symbols
        : [];
  const codes = source
    .map((item) => String(item?.symbol || item?.code || item || "").trim())
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  return new Set(codes);
}

function filterFormalDaytradePool(stocks) {
  const formalSet = formalDaytradePrioritySet();
  if (!formalSet || !formalSet.size) return stocks;
  return (stocks || []).filter((stock) => formalSet.has(String(stock.code || stock.symbol || "")));
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function avg(values) {
  const rows = values.map(cleanNumber).filter((value) => value > 0);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function emaSeries(values, length) {
  const nums = values.map(cleanNumber);
  const k = 2 / (length + 1);
  const out = [];
  nums.forEach((value, index) => {
    out[index] = index === 0 ? value : value * k + out[index - 1] * (1 - k);
  });
  return out;
}

function macdInfo(values) {
  const closes = values.map(cleanNumber).filter((value) => value > 0);
  if (closes.length < 35) return {};
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif = closes.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const dea = emaSeries(dif, 9);
  const last = dif.length - 1;
  const prev = dif.length - 2;
  const hist = 2 * (dif[last] - dea[last]);
  const prevHist = 2 * (dif[prev] - dea[prev]);
  return {
    macdDif: dif[last],
    macdSignal: dea[last],
    macdHist: hist,
    macdDifPrev: dif[prev],
    macdSignalPrev: dea[prev],
    macdHistPrev: prevHist,
    macdDifUp: dif[last] > dif[prev],
    macdHistUp: hist > prevHist,
    macdUp: hist > prevHist,
  };
}

function kdInfo(rows) {
  const sorted = rows.filter((row) => cleanNumber(row.high) > 0 && cleanNumber(row.low) > 0 && cleanNumber(row.close) > 0);
  if (sorted.length < 10) return {};
  let k = 50;
  let d = 50;
  let prevK = k;
  let prevD = d;
  for (let index = 0; index < sorted.length; index++) {
    const start = Math.max(0, index - 8);
    const window = sorted.slice(start, index + 1);
    const high = Math.max(...window.map((row) => cleanNumber(row.high)));
    const low = Math.min(...window.map((row) => cleanNumber(row.low)));
    const close = cleanNumber(sorted[index].close);
    const rsv = high > low ? ((close - low) / (high - low)) * 100 : 50;
    prevK = k;
    prevD = d;
    k = (prevK * 2 + rsv) / 3;
    d = (prevD * 2 + k) / 3;
  }
  const j = 3 * k - 2 * d;
  const prevJ = 3 * prevK - 2 * prevD;
  return {
    kdK: k,
    kdD: d,
    kdJ: j,
    kdKPrev: prevK,
    kdDPrev: prevD,
    kdJPrev: prevJ,
    kdKUp: k > prevK,
    kdDUp: d > prevD,
    kdJUp: j > prevJ,
    kdUp: k > prevK && d > prevD && j > prevJ,
  };
}

function rsiSeries(values, period = 5) {
  const closes = values.map(cleanNumber).filter((value) => value > 0);
  if (closes.length <= period) return [];
  const out = Array(closes.length).fill(0);
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const diff = closes[index] - closes[index - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let index = period + 1; index < closes.length; index += 1) {
    const diff = closes[index] - closes[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[index] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

function rsiInfo(values) {
  const closes = values.map(cleanNumber).filter((value) => value > 0);
  if (closes.length < 12) return {};
  const rsi5Series = rsiSeries(closes, 5);
  const rsi10Series = rsiSeries(closes, 10);
  const last = closes.length - 1;
  const prev = closes.length - 2;
  const rsi5 = cleanNumber(rsi5Series[last]);
  const rsi5Prev = cleanNumber(rsi5Series[prev]);
  const rsi10 = cleanNumber(rsi10Series[last]);
  const rsi10Prev = cleanNumber(rsi10Series[prev]);
  return {
    rsi5,
    rsi5Prev,
    rsi10,
    rsi10Prev,
    rsiUp: (rsi5 > rsi5Prev && rsi5 > 0) || (rsi10 > rsi10Prev && rsi10 > 0),
  };
}

function npsyInfo(values, period = 12) {
  const closes = values.map(cleanNumber).filter((value) => value > 0);
  if (closes.length < period + 2) return {};
  const scoreAt = (endIndex) => {
    let up = 0;
    for (let index = endIndex - period + 1; index <= endIndex; index += 1) {
      if (closes[index] > closes[index - 1]) up += 1;
    }
    return (up / period) * 100;
  };
  const last = closes.length - 1;
  const npsy = scoreAt(last);
  const npsyPrev = scoreAt(last - 1);
  return { npsy, npsyPrev, npsyUp: npsy > npsyPrev };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function pickStrategy2PublicRecord(record) {
  const out = {};
  [
    "code",
    "name",
    "date",
    "timestamp",
    "entryAt",
    "firstAAt",
    "firstBAt",
    "stateId",
    "stateLabel",
    "signalId",
    "entryPrice",
    "observedPrice",
    "close",
    "observedHigh",
    "observedHighAt",
    "percent",
    "value",
    "volume",
    "tradeVolume",
    "deltaVolume",
    "avg5dVolume",
    "cumulativeBidVolume",
    "cumulativeAskVolume",
    "score",
    "strategy",
    "primaryStrategy",
    "strategyIds",
    "strategyTags",
    "strategyReasons",
    "preopenStrategy",
    "preopenSourceDate",
    "reason",
    "stateReason",
    "supportPrice",
    "sourceCoverage",
    "sourceCoverageHealthy",
    "ma35",
    "ma35Prev",
    "aboveMa35",
    "ma35TrendUp",
    "ma35Source",
    "ma35At",
    "ma35Symbol",
    "ma35Attempts",
    "macdDif",
    "macdSignal",
    "macdHist",
    "macdUp",
    "kdK",
    "kdD",
    "kdUp",
    "npsy",
    "npsyPrev",
    "npsyUp",
    "intradayVolumeBurst",
  ].forEach((key) => {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  });
  return out;
}

function strategy2RecordSortTime(record) {
  return String(record?.timestamp || record?.entryAt || record?.firstAAt || record?.firstBAt || "");
}

function buildStrategy2PublicReport(report) {
  const latestByCode = new Map();
  (report.records || []).forEach((record) => {
    const code = String(record?.code || "");
    if (!code) return;
    const current = latestByCode.get(code);
    if (!current || strategy2RecordSortTime(record).localeCompare(strategy2RecordSortTime(current)) >= 0) {
      latestByCode.set(code, record);
    }
  });
  const records = [...latestByCode.values()]
    .sort((a, b) => strategy2RecordSortTime(b).localeCompare(strategy2RecordSortTime(a)) || String(a.code).localeCompare(String(b.code)))
    .map(pickStrategy2PublicRecord);
  return {
    source: report.source || "strategy2-0900-1200-live-patrol",
    profile: "strategy2-public-slim",
    date: report.date || "",
    updatedAt: report.updatedAt || new Date().toISOString(),
    realtime: report.realtime || {},
    records,
    events: report.events || [],
    entryCount: report.entryCount || 0,
    aCount: report.aCount || report.entryCount || 0,
    bOnlyCount: report.bOnlyCount || 0,
    slim: {
      generatedAt: new Date().toISOString(),
      sourceRecords: (report.records || []).length,
      records: records.length,
      events: (report.events || []).length,
    },
  };
}

function buildStrategy2ScorecardSource(report) {
  const records = (report.records || [])
    .sort((a, b) => strategy2RecordSortTime(a).localeCompare(strategy2RecordSortTime(b)) || String(a.code || "").localeCompare(String(b.code || "")))
    .map(pickStrategy2PublicRecord);
  return {
    source: "strategy2-scorecard-source",
    date: report.date || "",
    updatedAt: report.updatedAt || new Date().toISOString(),
    realtime: report.realtime || {},
    records,
    events: report.events || [],
    entryCount: report.entryCount || 0,
    aCount: report.aCount || report.entryCount || 0,
    bOnlyCount: report.bOnlyCount || 0,
    summary: {
      sourceRecords: (report.records || []).length,
      records: records.length,
      entryRecords: records.filter((record) => record?.stateId === "entry" || record?.stateId === "go").length,
      events: (report.events || []).length,
    },
  };
}


function compactStrategy2Enhancement(item) {
  return pickDefined({
    at: item?.at,
    price: item?.price,
    score: item?.score,
    deltaVolume: item?.deltaVolume,
    totalVolume: item?.totalVolume,
    trigger: item?.trigger,
    strategy: item?.strategy,
    reason: item?.reason,
  });
}

function compactStrategy2Event(event) {
  return pickDefined({
    code: event?.code,
    name: event?.name,
    date: event?.date,
    firstBAt: event?.firstBAt,
    firstBPrice: event?.firstBPrice,
    highAfterB: event?.highAfterB,
    highAfterBAt: event?.highAfterBAt,
    firstAAt: event?.firstAAt,
    firstAPrice: event?.firstAPrice,
    firstTradableAAt: event?.firstTradableAAt,
    firstTradableAPrice: event?.firstTradableAPrice,
    latestAAt: event?.latestAAt,
    latestAPrice: event?.latestAPrice,
    latestBAt: event?.latestBAt,
    latestBPrice: event?.latestBPrice,
    latestSeenAt: event?.latestSeenAt,
    latestSeenPrice: event?.latestSeenPrice,
    highAfterA: event?.highAfterA,
    highAfterAAt: event?.highAfterAAt,
    highestPrice: event?.highestPrice,
    highestAt: event?.highestAt,
    stateId: event?.stateId,
    stateLabel: event?.stateLabel,
    signalId: event?.signalId || event?.latestRecord?.signalId,
    latestState: event?.latestState,
    maxScore: event?.maxScore,
    strategies: Array.isArray(event?.strategies) ? event.strategies.slice(0, 8) : [],
    strategyIds: Array.isArray(event?.strategyIds) ? event.strategyIds.slice(0, 8) : [],
    strategyTags: Array.isArray(event?.strategyTags) ? event.strategyTags.slice(0, 8) : [],
    strategyReasons: Array.isArray(event?.strategyReasons) ? event.strategyReasons.slice(0, 8) : [],
    primaryStrategy: event?.primaryStrategy,
    preopenStrategy: event?.preopenStrategy,
    preopenSourceDate: event?.preopenSourceDate,
    ma35: event?.ma35,
    ma35Prev: event?.ma35Prev,
    aboveMa35: event?.aboveMa35,
    ma35TrendUp: event?.ma35TrendUp,
    ma35Source: event?.ma35Source,
    ma35At: event?.ma35At,
    ma35Symbol: event?.ma35Symbol,
    macdUp: event?.macdUp ?? event?.latestRecord?.macdUp,
    kdUp: event?.kdUp ?? event?.latestRecord?.kdUp,
    intradayVolumeBurst: event?.intradayVolumeBurst ?? event?.latestRecord?.intradayVolumeBurst,
    latestRecord: event?.latestRecord ? pickStrategy2PublicRecord(event.latestRecord) : undefined,
    enhancements: Array.isArray(event?.enhancements) ? event.enhancements.slice(-8).map(compactStrategy2Enhancement) : [],
    stateReason: event?.stateReason,
    supportPrice: event?.supportPrice,
  });
}

function buildStrategy2FastSlimReport(report) {
  const publicReport = buildStrategy2PublicReport(report);
  return {
    ...publicReport,
    profile: "strategy2-fast-slim",
    realtime: {
      requested: publicReport.realtime?.requested || 0,
      received: publicReport.realtime?.received || 0,
      failed: publicReport.realtime?.failed || 0,
      usable: publicReport.realtime?.usable || 0,
      coverage: publicReport.realtime?.coverage || 0,
      coverageBeforeRescue: publicReport.realtime?.coverageBeforeRescue || 0,
      coverageAfterRescue: publicReport.realtime?.coverageAfterRescue || 0,
      cachedRecovered: publicReport.realtime?.cachedRecovered || 0,
      entrySourceHealthy: publicReport.realtime?.entrySourceHealthy === true,
      entrySourceCoverageThreshold: publicReport.realtime?.entrySourceCoverageThreshold || 0,
      skippedPartialCoverage: publicReport.realtime?.skippedPartialCoverage === true,
    },
    events: (publicReport.events || []).map(compactStrategy2Event),
    slim: {
      ...(publicReport.slim || {}),
      generatedAt: new Date().toISOString(),
      enhancementLimit: 8,
    },
  };
}

function buildStrategy2TopReport(report, options = {}) {
  const slim = buildStrategy2FastSlimReport(report);
  const eventLimit = options.eventLimit || 50;
  const recordLimit = options.recordLimit || 70;
  const source = options.source || "strategy2-mobile-top";
  const eventDetectedTime = (event) => String(event.latestAAt || event.firstAAt || event.latestSeenAt || event.latestBAt || event.firstBAt || "");
  const rankEvents = (items) => [...items]
    .sort((a, b) => eventDetectedTime(b).localeCompare(eventDetectedTime(a)) || (Number(b.maxScore) || 0) - (Number(a.maxScore) || 0));
  const entryEvents = rankEvents((slim.events || []).filter((event) => event.stateId === "entry" || event.stateId === "go"));
  const watchEvents = rankEvents((slim.events || []).filter((event) => !(event.stateId === "entry" || event.stateId === "go")));
  const events = [...entryEvents, ...watchEvents].slice(0, Math.max(eventLimit, entryEvents.length));
  const eventCodes = new Set(events.map((event) => String(event.code || "")));
  const records = [
    ...(slim.records || []).filter((record) => eventCodes.has(String(record.code || ""))),
    ...(slim.records || []).filter((record) => !eventCodes.has(String(record.code || ""))).slice(0, Math.max(0, recordLimit - eventCodes.size)),
  ].slice(0, recordLimit);
  return {
    ...slim,
    source,
    profile: source,
    events,
    records,
    count: events.length,
  };
}

function buildStrategy2MobileTopReport(report) {
  return buildStrategy2TopReport(report, { source: "strategy2-mobile-top", eventLimit: 50, recordLimit: 70 });
}

function buildStrategy2LiveTopReport(report) {
  return buildStrategy2TopReport(report, { source: "strategy2-mobile-live-top", eventLimit: 28, recordLimit: 40 });
}

function buildStrategy2DeltaReport(report) {
  const slim = buildStrategy2FastSlimReport(report);
  const events = [...(slim.events || [])]
    .sort((a, b) => String(b.latestSeenAt || b.latestAAt || "").localeCompare(String(a.latestSeenAt || a.latestAAt || "")) || (Number(b.maxScore) || 0) - (Number(a.maxScore) || 0))
    .slice(0, 24);
  const codes = new Set(events.map((event) => String(event.code || "")));
  return {
    ok: true,
    source: "strategy2-intraday-delta",
    updatedAt: slim.updatedAt,
    since: slim.updatedAt,
    count: events.length,
    events,
    records: (slim.records || []).filter((record) => codes.has(String(record.code || ""))).slice(0, 32),
  };
}
function strategy2LiveRecordMinute(record) {
  const raw = String(record?.timestamp || record?.entryAt || record?.quoteTime || record?.time || "").trim();
  const match = raw.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isStrategy2LiveLedgerRecord(record, key) {
  if (!record || typeof record !== "object") return false;
  const recordDate = compactDateKey(record.date || record.scanDate || record.timestamp || record.entryAt, key);
  if (recordDate && recordDate !== key) return false;
  const minute = strategy2LiveRecordMinute(record);
  if (minute === null) return true;
  return minute >= STRATEGY2_SCAN_START_MINUTES && minute <= STRATEGY2_SCAN_END_MINUTES;
}

function strategy2LiveLedgerRecordKey(record) {
  return [
    compactDateKey(record?.date || record?.timestamp || record?.entryAt, ""),
    String(record?.timestamp || record?.entryAt || record?.quoteTime || record?.time || ""),
    String(record?.code || record?.symbol || ""),
    String(record?.signalId || record?.signal_id || record?.primaryStrategy || ""),
    String(record?.stateId || record?.state_id || ""),
    String(record?.strategy || ""),
  ].join("|");
}

function mergeStrategy2LiveLedgerRows(existingRows, incomingRows, key) {
  const merged = new Map();
  const add = (row, source) => {
    if (!isStrategy2LiveLedgerRecord(row, key)) return;
    const normalized = {
      ...row,
      date: key,
      liveWindow: "09:00-12:00",
      liveLedgerSource: source,
    };
    const rowKey = strategy2LiveLedgerRecordKey(normalized);
    if (!rowKey.replace(/\|/g, "")) return;
    const current = merged.get(rowKey);
    merged.set(rowKey, current ? { ...current, ...normalized } : normalized);
  };
  (Array.isArray(existingRows) ? existingRows : []).forEach((row) => add(row, "history-ledger"));
  (Array.isArray(incomingRows) ? incomingRows : []).forEach((row) => add(row, "live-scan"));
  return [...merged.values()].sort((a, b) => {
    return String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || ""))
      || cleanNumber(b.score) - cleanNumber(a.score)
      || String(a.code || "").localeCompare(String(b.code || ""), "zh-Hant");
  });
}

function buildStrategy2LiveLedgerReport(report, key) {
  const strategy2HistoryFile = path.join(STRATEGY2_HISTORY_DIR, `${key}.json`);
  const records = Array.isArray(report?.records) ? report.records : [];
  const events = Array.isArray(report?.events) ? report.events : [];
  const existing = readJson(strategy2HistoryFile, {});
  const existingRecords = Array.isArray(existing?.records) ? existing.records : [];
  const mergedRecords = mergeStrategy2LiveLedgerRows(existingRecords, records, key);
  const mergedEvents = mergedRecords.length ? mergeStrategy2Events(mergedRecords, key) : events;
  if (!mergedRecords.length && !mergedEvents.length) return null;
  const times = [...new Set(mergedRecords.map((record) => timeLabel(record.timestamp || record.entryAt || record.quoteTime || record.time)).filter(Boolean))].sort();
  return {
    ...existing,
    ...report,
    source: report.source || "strategy2-0900-1200-live-patrol",
    cacheSource: report.cacheSource || "strategy2-live-ledger",
    records: mergedRecords,
    events: mergedEvents,
    entryCount: mergedEvents.filter((event) => event.firstAAt || event.stateId === "entry" || event.stateId === "go").length,
    aCount: mergedEvents.filter((event) => event.firstAAt || event.stateId === "entry" || event.stateId === "go").length,
    bOnlyCount: mergedRecords.filter((record) => !isEntryState(record)).length,
    totalCount: mergedRecords.length,
    scanned: mergedRecords.length,
    total: mergedRecords.length,
    historyContract: "strategy2-live-ledger-0900-1200-v3",
    historyWindow: {
      start: "09:00",
      end: "12:00",
      timezone: "Asia/Taipei",
      source: "scanner-append-only-live-ledger",
      uniqueRecordTimes: times.length,
      firstRecordAt: times[0] || "",
      lastRecordAt: times[times.length - 1] || "",
    },
    scanWindow: {
      ...(report.scanWindow || {}),
      start: "09:00:00",
      end: "12:00:00",
      timezone: "Asia/Taipei",
      mode: "live-detection-ledger",
      uniqueRecordTimes: times.length,
      firstRecordAt: times[0] || "",
      lastRecordAt: times[times.length - 1] || "",
    },
  };
}

function writeStrategy2HistorySnapshot(report, key, options = {}) {
  const ledgerReport = buildStrategy2LiveLedgerReport(report, key);
  if (!ledgerReport && !options.allowEmpty) return null;
  const strategy2HistoryFile = path.join(STRATEGY2_HISTORY_DIR, `${key}.json`);
  const payload = ledgerReport || {
    ...report,
    records: [],
    events: [],
    historyContract: "strategy2-live-ledger-0900-1200-v3",
    historyWindow: { start: "09:00", end: "12:00", timezone: "Asia/Taipei", source: "scanner-append-only-live-ledger" },
  };
  writeJson(strategy2HistoryFile, payload);
  return payload;
}

function writeStaticDataTargets(name, payload, options = {}) {
  const targets = options.skipRuntime
    ? dataOutputPaths(name, { repoEnv: "FUMAN_STRATEGY2_INTRADAY_WRITE_CODE_REPO" }).filter((file) => path.resolve(file) !== path.resolve(dataPath(name)))
    : dataOutputPaths(name, { repoEnv: "FUMAN_STRATEGY2_INTRADAY_WRITE_CODE_REPO" });
  [...new Set(targets.map((file) => path.resolve(file)))].forEach((file) => {
    writeJson(file, payload);
  });
}

function publishStaticDataJson(name, value) {
  if (STRATEGY2_API_ONLY && /^strategy2-intraday.*\.json$/i.test(String(name || ""))) {
    console.log(`strategy2 API-only: skipped static ${name} output`);
    return;
  }
  const payload = value;
  const slimPayload = name === "strategy2-intraday-latest.json" ? buildStrategy2FastSlimReport(value) : null;
  const topPayload = name === "strategy2-intraday-latest.json" ? buildStrategy2MobileTopReport(value) : null;
  writeStaticDataTargets(name, payload, { skipRuntime: name === "strategy2-intraday-latest.json" });
  if (name !== "strategy2-intraday-latest.json") return;
  writeStaticDataTargets("strategy2-intraday-slim.json", slimPayload);
  writeStaticDataTargets("strategy2-intraday-top.json", topPayload);
  writeStaticDataTargets("strategy2-intraday-live-top.json", buildStrategy2LiveTopReport(value));
  writeStaticDataTargets("strategy2-intraday-delta.json", buildStrategy2DeltaReport(value));
}

function getStrategy2TaipeiParts(value) {
  const date = new Date(value || Date.now());
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
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === "24" ? "00" : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function buildStrategy2CompleteRunPayload(report) {
  const qualityStatus = report.qualityStatus
    || (report.realtime?.entrySourceHealthy === false || report.realtime?.skippedPartialCoverage ? "degraded" : "ok");
  const dedupeRows = (rows, kind) => {
    const byConflictKey = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row || typeof row !== "object") return false;
      const key = [
        kind,
        row.code || row.symbol || "",
        row.rowKind || row.row_kind || row.stateId || row.state_id || "",
        row.signalId || row.signal_id || row.primaryStrategy || "",
      ].join("|");
      if (!key.replace(/\|/g, "")) return;
      const current = byConflictKey.get(key);
      if (!current || strategy2RecordSortTime(row).localeCompare(strategy2RecordSortTime(current)) >= 0) {
        byConflictKey.set(key, row);
      }
    });
    return [...byConflictKey.values()];
  };
  return {
    ...report,
    events: dedupeRows(report.events, "event"),
    records: dedupeRows(report.records, "record"),
    entryCount: cleanNumber(report.entryCount || report.aCount),
    qualityStatus,
    schemaVersion: report.schemaVersion || "strategy2-run-id-complete-v1",
    dataContractSource: report.dataContractSource || "supabase:strategy2_intraday_ready_cache",
  };
}

function buildStrategy2CompleteRunId(report) {
  const scanDate = String(report.date || "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(report.date)
    : null;
  const parts = getStrategy2TaipeiParts(report.updatedAt || report.generatedAt || Date.now());
  const ymd = scanDate ? scanDate.replace(/\D/g, "") : `${parts.year}${parts.month}${parts.day}`;
  return `strategy2-${ymd}-${parts.hour}${parts.minute}${parts.second}`;
}

function writeStrategy2LivePublishReceipt(report, runId, source = "scan-intraday-signals.js") {
  const receiptDir = dataPath("scan-receipts");
  fs.mkdirSync(receiptDir, { recursive: true });
  const records = Array.isArray(report.records) ? report.records : [];
  const events = Array.isArray(report.events) ? report.events : [];
  const matches = cleanNumber(report.entryCount || report.aCount || events.length || records.length);
  const now = new Date().toISOString();
  const receipt = {
    strategy: "strategy2",
    label: "strategy2 intraday live publish",
    tier: "critical",
    startedAt: report.startedAt || report.generatedAt || report.updatedAt || now,
    finishedAt: now,
    status: report.ok === false ? "failed" : "complete",
    exitCode: report.ok === false ? 1 : 0,
    scanned: records.length,
    total: records.length,
    matches,
    complete: report.ok !== false,
    qualityStatus: report.qualityStatus || "complete",
    fallback: false,
    preservedLatest: false,
    publishBlocked: false,
    runId,
    marketDate: String(report.date || "").replace(/\D/g, ""),
    updatedAt: report.updatedAt || report.generatedAt || now,
    payloadPath: "supabase:strategy2_latest",
    source,
    warnings: [],
    blockingReason: "",
    log: "run_id=" + runId + "; source=" + source,
  };
  fs.writeFileSync(path.join(receiptDir, "strategy2.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8");
  return receipt;
}
function buildStrategy2RealtimePayload(report, runId) {
  return {
    strategy: "strategy2",
    event: "complete-run",
    runId,
    date: report.date || "",
    updatedAt: report.updatedAt || new Date().toISOString(),
    entryCount: cleanNumber(report.entryCount || report.aCount),
    recordCount: Array.isArray(report.records) ? report.records.length : 0,
    eventCount: Array.isArray(report.events) ? report.events.length : 0,
    qualityStatus: report.qualityStatus || "",
    schemaVersion: report.schemaVersion || "strategy2-run-id-complete-v1",
    dataContractSource: report.dataContractSource || "supabase:strategy2_intraday_ready_cache",
  };
}

async function broadcastStrategy2CompleteRun({ supabaseUrl, publishKey, report, runId }) {
  if (!publishKey || process.env.STRATEGY2_DISABLE_REALTIME_BROADCAST === "1") return false;
  const topic = process.env.STRATEGY2_REALTIME_TOPIC || "fuman-strategy2-complete";
  const event = process.env.STRATEGY2_REALTIME_EVENT || "complete-run";
  const payload = buildStrategy2RealtimePayload(report, runId);
  try {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${encodeURIComponent(event)}`, {
      method: "POST",
      headers: {
        apikey: publishKey,
        Authorization: `Bearer ${publishKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`strategy2 realtime broadcast skipped: HTTP ${response.status} ${text.slice(0, 160)}`);
      return false;
    }
    console.log(`strategy2 realtime broadcast ok: ${topic}/${event} ${runId}`);
    return true;
  } catch (error) {
    console.warn(`strategy2 realtime broadcast skipped: ${error?.message || String(error)}`);
    return false;
  }
}
function getStrategy2BroadcastConfig() {
  if (global.__strategy2BroadcastConfig) return global.__strategy2BroadcastConfig;
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-service-role-key.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"));
  global.__strategy2BroadcastConfig = { supabaseUrl, publishKey: serviceKey };
  return global.__strategy2BroadcastConfig;
}

function buildStrategy2CandidateHitPayload(record) {
  return {
    strategy: "strategy2",
    event: "candidate-hit",
    date: record.date || "",
    timestamp: record.timestamp || record.entryAt || "",
    code: String(record.code || ""),
    name: String(record.name || record.code || ""),
    stateId: record.stateId || "",
    stateLabel: record.stateLabel || "",
    signalId: record.signalId || record.primaryStrategy || "",
    strategyLabel: record.strategy || record.primaryStrategy || "",
    score: cleanNumber(record.score),
    price: cleanNumber(record.entryPrice || record.observedPrice),
    percent: cleanNumber(record.percent),
    volume: cleanNumber(record.volume || record.tradeVolume),
    reason: String(record.reason || record.stateReason || "").slice(0, 180),
    sourceCoverage: cleanNumber(record.sourceCoverage),
    updatedAt: new Date().toISOString(),
  };
}

async function broadcastStrategy2CandidateHit(record) {
  if (!record || process.env.STRATEGY2_DISABLE_REALTIME_BROADCAST === "1") return false;
  if (!["entry", "go"].includes(String(record.stateId || ""))) return false;
  const { supabaseUrl, publishKey } = getStrategy2BroadcastConfig();
  if (!supabaseUrl || !publishKey) return false;
  const topic = process.env.STRATEGY2_REALTIME_TOPIC || "fuman-strategy2-complete";
  const event = process.env.STRATEGY2_REALTIME_CANDIDATE_EVENT || "candidate-hit";
  const payload = buildStrategy2CandidateHitPayload(record);
  try {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${encodeURIComponent(event)}`, {
      method: "POST",
      headers: {
        apikey: publishKey,
        Authorization: `Bearer ${publishKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
    });
    if (!response.ok) return false;
    console.log(`strategy2 candidate-hit broadcast ok: ${payload.code} ${payload.signalId || payload.stateId}`);
    return true;
  } catch {
    return false;
  }
}
async function publishStrategy2CompleteRunToSupabase({ supabaseUrl, publishKey, report }) {
  if (!publishKey) {
    throw new Error("strategy2 complete run publish failed: missing Supabase service role key");
  }
  const recordCount = Array.isArray(report.records) ? report.records.length : 0;
  const eventCount = Array.isArray(report.events) ? report.events.length : 0;
  if (recordCount <= 0 && eventCount <= 0) {
    console.warn("strategy2 complete run publish skipped: empty report has no records/events");
    return false;
  }
  const evidenceAudit = auditRunTimeSourceSnapshot(report);
  if (!evidenceAudit.ok) {
    throw new Error(`strategy2 complete run publish blocked: missing run-time evidence ${evidenceAudit.missingFields.join(",")}`);
  }
  const scanDate = String(report.date || "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? String(report.date)
    : (() => {
      const parts = getStrategy2TaipeiParts(report.updatedAt || report.generatedAt || Date.now());
      return `${parts.year}-${parts.month}-${parts.day}`;
    })();
  const runId = buildStrategy2CompleteRunId(report);
  const rpcPayload = {
    p_run_id: runId,
    p_scan_date: scanDate,
    p_payload: report,
  };
  const alreadyPublished = async () => {
    try {
      const params = new URLSearchParams({
        select: "run_id",
        run_id: `eq.${runId}`,
        limit: "1",
      });
      const response = await fetch(`${supabaseUrl}/rest/v1/v_strategy2_latest_complete_run?${params.toString()}`, {
        headers: {
          apikey: publishKey,
          Authorization: `Bearer ${publishKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
      });
      if (!response.ok) return false;
      const rows = await response.json();
      return Array.isArray(rows) && rows.some((row) => String(row?.run_id || "") === runId);
    } catch {
      return false;
    }
  };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/publish_strategy2_complete_run`, {
      method: "POST",
      headers: {
        apikey: publishKey,
        Authorization: `Bearer ${publishKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rpcPayload),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`strategy2 complete run publish failed: HTTP ${response.status} ${text.slice(0, 160)}`);
    }
    await broadcastStrategy2CompleteRun({ supabaseUrl, publishKey, report, runId });
    return true;
  } catch (error) {
    if (/duplicate constrained values|ON CONFLICT|21000/i.test(error?.message || String(error)) && await alreadyPublished()) {
      console.warn(`strategy2 complete run already published: runId=${runId}`);
      return true;
    }
    throw new Error(`strategy2 complete run publish failed: ${error?.message || String(error)}`);
  }
}

async function upsertStrategy2LatestToSupabase(report) {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-anon-key.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-anon-key.txt"));
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-service-role-key.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"));
  if (!supabaseUrl || !anonKey) {
    console.warn("strategy2_latest upsert skipped: missing Supabase anon key");
    return false;
  }
  if (!serviceKey) {
    console.warn("strategy2_latest upsert skipped: missing Supabase service role key");
    return false;
  }
  const completePayload = buildStrategy2CompleteRunPayload(report);
  const recordCount = Array.isArray(completePayload.records) ? completePayload.records.length : 0;
  const eventCount = Array.isArray(completePayload.events) ? completePayload.events.length : 0;
  if (recordCount <= 0 && eventCount <= 0) {
    console.warn("strategy2_latest upsert skipped: empty report has no records/events");
    return false;
  }
  let sourceGate = null;
  try {
    sourceGate = await assertStrategy2SourcePublishGate({
      supabaseUrl,
      serviceKey,
      publishKey: serviceKey,
      anonKey,
    }, { stage: "scanner-latest-complete-run-publish" });
  } catch (error) {
    const issues = error?.gate?.issues || [];
    console.warn(`strategy2_latest upsert blocked by source gate: ${(issues.length ? issues.join("; ") : error?.message || String(error)).slice(0, 320)}`);
    return false;
  }
  const runId = buildStrategy2CompleteRunId(completePayload);
  Object.assign(completePayload, buildRunTimeSourceSnapshotFields({
    strategy: "strategy2",
    runId,
    payload: completePayload,
    startedAt: completePayload.startedAt || completePayload.generatedAt || completePayload.updatedAt || new Date().toISOString(),
    finishedAt: completePayload.updatedAt || completePayload.generatedAt || new Date().toISOString(),
    expectedTotal: recordCount,
    scannedCount: recordCount,
    resultCount: cleanNumber(completePayload.entryCount || completePayload.aCount || eventCount),
    readbackCount: null,
    sourceStatus: sourceGate?.sourceCoverage || {},
    quoteCoverage: sourceGate?.sourceCoverage || {},
    intraday1mReadiness: sourceGate?.sourceCoverage || {},
    maReadiness: sourceGate?.sourceCoverage || {},
    preopenFutoptDailyReadiness: sourceGate?.sourceCoverage || {},
    publishAllowed: sourceGate?.publishAllowed === true,
    degradedBlocksLatest: sourceGate?.publishAllowed !== true,
    preservePreviousGood: sourceGate?.publishAllowed !== true,
    fallbackUsed: sourceGate?.fallbackUsed === true,
    writeBudget: sourceGate?.writeBudget || null,
    retentionOk: sourceGate?.retentionOk ?? null,
    qualityStatus: completePayload.qualityStatus || "complete",
  }));
  const evidenceAudit = auditRunTimeSourceSnapshot(completePayload);
  if (!evidenceAudit.ok) {
    console.warn(`strategy2_latest upsert blocked: missing run-time evidence ${evidenceAudit.missingFields.join(",")}`);
    return false;
  }
  const payload = {
    id: "latest",
    date: completePayload.date || "",
    updated_at: completePayload.updatedAt || new Date().toISOString(),
    entry_count: cleanNumber(completePayload.entryCount || completePayload.aCount),
    record_count: recordCount,
    event_count: eventCount,
    payload: completePayload,
  };
  let latestOk = false;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/strategy2_latest?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`strategy2_latest upsert skipped: HTTP ${response.status} ${text.slice(0, 160)}`);
    } else {
      latestOk = true;
    }
  } catch (error) {
    console.warn(`strategy2_latest upsert skipped: ${error?.message || String(error)}`);
  }
  const completeOk = await publishStrategy2CompleteRunToSupabase({ supabaseUrl, publishKey: serviceKey, report: completePayload });
  if (latestOk && completeOk) {
    writeStrategy2LivePublishReceipt(completePayload, runId, "scan-intraday-signals.js:strategy2_latest+complete_run");
  }
  return latestOk && completeOk;
}

function normalizeVolumeLots(value) {
  const number = cleanNumber(value);
  if (!number) return 0;
  return number > 100000 ? Math.round(number / 1000) : number;
}

function normalizeRealtimeQuoteVolume(quote) {
  const volume = cleanNumber(quote?.tradeVolume);
  if (!volume) return 0;
  const source = String(quote?.realtimeFallback || quote?.closeSource || quote?.quoteSource || "");
  if (/yahoo|finmind/i.test(source)) return normalizeVolumeLots(volume);
  return Math.round(volume);
}

function isTrustedStrategy2Ma35Source(source) {
  return new Set(["supabase-fugle-1m", "fugle-1m", "yahoo-1m", "local-1m", "twelve-1m"]).has(String(source || ""));
}

const STRATEGY2_TRADE_VALUE_OK = Number(process.env.STRATEGY2_TRADE_VALUE_OK || 50000000);
const STRATEGY2_MIN_TRADE_VALUE_ENTRY = Number(process.env.STRATEGY2_MIN_TRADE_VALUE_ENTRY || 30000000);
const STRATEGY2_MIN_CUMULATIVE_VOLUME_ENTRY = Number(process.env.STRATEGY2_MIN_CUMULATIVE_VOLUME_ENTRY || 500);
const STRATEGY2_MIN_AVG5D_VOLUME_OK = Number(process.env.STRATEGY2_MIN_AVG5D_VOLUME_OK || 3000);
const STRATEGY2_CONDITION_LABELS = {
  star: "STAR",
  preopen_watch: "盤前觀察",
  strategy2_mother_pool: "母池觀察",
  open_rush: "開盤沖",
  early_attack: "早攻續強",
  intraday_continuation: "盤中續強",
  triggered_still_strong: "曾發動仍強",
  rebound_turn: "反彈轉強",
  confirmed_re_rise: "正式再起漲",
  early_re_rise_entry: "早期再起漲",
  creeping_re_rise: "低量沿線再起漲",
  deep_rebound: "跌深反彈轉強",
  opening_breakout: "開盤強勢突破",
};

function uniqueCompact(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function minutesFromTimestamp(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})/);
  if (!match) return marketMinutes();
  return Number(match[1]) * 60 + Number(match[2]);
}

function hasVerifiedStarPreopenSource(item) {
  const futuresOk = item?.stockFutureOk === true
    || item?.stockFuturesOk === true
    || item?.futureSignalOk === true
    || item?.preopenFutureOk === true;
  const trialOk = item?.trialAuctionOk === true
    || item?.preopenTrialOk === true
    || item?.finalBlindBuy === true
    || item?.finalBlindBuyOk === true;
  return futuresOk && trialOk;
}


function readStarPreopenSource(today) {
  const payload = readJson(STAR_PREOPEN_FILE, { ok: true, finalMatches: [], matches: [] });
  const sourceDate = compactDateKey(payload.usedDate || payload.date || payload.quoteDate, today);
  if (sourceDate !== today) return { ok: true, matches: [] };
  const matches = (payload.finalMatches || payload.matches || [])
    .filter((item) => item?.finalBlindBuy === true || item?.finalBlindBuyOk === true)
    .map((item) => ({
      ...item,
      stockFutureOk: true,
      preopenFutureOk: true,
      preopenTrialOk: true,
      trialAuctionOk: true,
      finalBlindBuy: true,
      finalBlindBuyOk: true,
      strategyIds: [...new Set([...(item.strategyIds || []), "star"])],
      reason: item.reason || "STAR：期貨 + 試撮 FinalBlindBuy 通過。",
    }));
  return { ...payload, matches };
}
function buildPreopenStrategyMap(today) {
  const payload = readScorecardSource(OPEN_BUY_SCORECARD_SOURCE_FILE, OPEN_BUY_FILE, OPEN_BUY_BACKUP_FILE);
  const map = new Map();
  (payload.matches || []).forEach((item) => {
    const code = String(item?.code || "");
    if (!code) return;
    const id = hasVerifiedStarPreopenSource(item) ? "star" : "preopen_watch";
    map.set(code, {
      id,
      label: STRATEGY2_CONDITION_LABELS[id],
      sourceDate: compactDateKey(item?.date || item?.quoteDate || payload.usedDate || payload.date, today),
      score: cleanNumber(item?.score),
      reason: item?.reason || `${STRATEGY2_CONDITION_LABELS[id]}：來自盤前/開盤名單。`,
    });
  });
  return map;
}

function strategy2TechFlags(stock) {
  const close = cleanNumber(stock.close);
  const latestClose = cleanNumber(stock.latest1mClose) || close;
  const ma35 = cleanNumber(stock.ma35);
  const ma35Prev = cleanNumber(stock.ma35Prev);
  const aboveMa35 = ma35 > 0 && latestClose >= ma35 && isTrustedStrategy2Ma35Source(stock.ma35Source);
  const ma35Rising = stock.ma35TrendUp === true || (ma35 > 0 && ma35Prev > 0 && ma35 >= ma35Prev);
  const macdGreenRising = stock.macdHistUp === true || stock.macdUp === true;
  const kdjBullish = stock.kdUp === true || (stock.kdKUp === true && stock.kdDUp === true);
  const npsyUp = stock.npsyUp === true;
  const rsiUp = stock.rsiUp === true;
  const npsyOrRsi = npsyUp || rsiUp;
  const latestOpen = cleanNumber(stock.latest1mOpen) || cleanNumber(stock.open);
  const latestPrevClose = cleanNumber(stock.latest1mPrevClose);
  const priceMomentumUp = latestClose > 0 && (
    (latestPrevClose > 0 && latestClose >= latestPrevClose)
    || (latestOpen > 0 && latestClose >= latestOpen)
  );
  return { close, latestClose, ma35, ma35Prev, aboveMa35, ma35Rising, macdGreenRising, kdjBullish, npsyUp, rsiUp, npsyOrRsi, priceMomentumUp };
}

function openAmplitudePercent(stock) {
  const close = cleanNumber(stock.latest1mClose || stock.close);
  const open = cleanNumber(stock.open || stock.latest1mOpen);
  if (close <= 0 || open <= 0) return cleanNumber(stock.percent);
  return ((close - open) / open) * 100;
}

function hasDailyMaBullishAlignment(stock) {
  const ma5 = cleanNumber(stock.dailyMa5 || stock.ma5 || stock.sma5);
  const ma10 = cleanNumber(stock.dailyMa10 || stock.ma10 || stock.sma10);
  const ma20 = cleanNumber(stock.dailyMa20 || stock.ma20 || stock.sma20);
  const ma60 = cleanNumber(stock.dailyMa60 || stock.ma60 || stock.sma60);
  const rows = [ma5, ma10, ma20, ma60].filter((value) => value > 0);
  if (rows.length < 3) return true;
  if (ma5 > 0 && ma10 > 0 && ma20 > 0 && ma5 < ma10) return false;
  if (ma10 > 0 && ma20 > 0 && ma10 < ma20) return false;
  if (ma20 > 0 && ma60 > 0 && ma20 < ma60) return false;
  return true;
}

function buildStrategy2MotherPoolMeta(stock, options = {}) {
  const close = cleanNumber(stock.close);
  const pct = openAmplitudePercent(stock);
  const volume = cleanNumber(stock.tradeVolume);
  const value = cleanNumber(stock.value) || close * volume;
  const avg5dVolume = cleanNumber(stock.avg5dVolume || stock.avg_5d_volume || stock.avgVolume5);
  const prevClosePct = cleanNumber(stock.prevClosePercent || stock.changePercent || stock.change_percent);
  const limitUp = cleanNumber(stock.limitUp || stock.limit_up_price || stock.limitUpPrice);
  const limitUpExcluded = limitUp > 0 ? close >= limitUp * 0.995 : prevClosePct >= 9.7;
  const volumeTop100 = options.volumeTop100Codes?.has?.(String(stock.code || "")) === true;
  const channelAvg5 = avg5dVolume > STRATEGY2_MIN_AVG5D_VOLUME_OK;
  const channelStrongVolume = pct >= 2 && volume > 5000 && hasDailyMaBullishAlignment(stock);
  const channelVolumeRank = avg5dVolume > 0 && volume > avg5dVolume * 2 && volume >= 10000 && volumeTop100;
  const ok = close >= 10
    && close <= 1000
    && pct >= 2
    && pct < 9.9
    && volume > 0
    && !limitUpExcluded
    && (channelAvg5 || channelStrongVolume || channelVolumeRank);
  if (!ok) return { ok: false, strategyIds: [], strategyTags: [], strategyReasons: [] };
  const channels = [
    channelAvg5 ? `5日均量 ${Math.round(avg5dVolume).toLocaleString("zh-TW")} 張` : "",
    channelStrongVolume ? `幅度達標且今日量 ${Math.round(volume).toLocaleString("zh-TW")} 張` : "",
    channelVolumeRank ? `爆量且成交量排名前100` : "",
  ].filter(Boolean);
  return {
    ok: true,
    strategyIds: ["strategy2_mother_pool"],
    strategyTags: [STRATEGY2_CONDITION_LABELS.strategy2_mother_pool],
    primaryStrategy: STRATEGY2_CONDITION_LABELS.strategy2_mother_pool,
    strategyReasons: [`幅度 ${pct.toFixed(2)}%，成交量 ${Math.round(volume).toLocaleString("zh-TW")} 張，成交金額 ${Math.round(value / 10000).toLocaleString("zh-TW")} 萬，流動性通道：${channels.join(" / ")}。`],
  };
}

function buildStrategy2ConditionMeta(stock, options = {}) {
  const tags = [];
  const reasons = [];
  const add = (id, reason) => {
    tags.push({ id, label: STRATEGY2_CONDITION_LABELS[id] });
    if (reason) reasons.push(`${STRATEGY2_CONDITION_LABELS[id]}：${reason}`);
  };
  const preopen = options.preopen;
  if (preopen?.id) add(preopen.id, preopen.reason);

  const minute = minutesFromTimestamp(options.timestamp);
  const pct = cleanNumber(stock.percent);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high) || cleanNumber(stock.close);
  const low = cleanNumber(stock.low) || cleanNumber(stock.close);
  const volume = cleanNumber(stock.tradeVolume);
  const value = cleanNumber(stock.value) || cleanNumber(stock.close) * volume;
  const deltaVolume = cleanNumber(stock.deltaVolume);
  const latest1mVolume = cleanNumber(stock.latest1mVolume);
  const avg5dVolume = cleanNumber(stock.avg5dVolume);
  const cumulativeBidVolume = cleanNumber(stock.cumulativeBidVolume);
  const cumulativeAskVolume = cleanNumber(stock.cumulativeAskVolume);
  const buySellRatio = cumulativeAskVolume > 0 ? cumulativeBidVolume / cumulativeAskVolume : (cumulativeBidVolume > 0 ? 99 : 0);
  const { close, latestClose, aboveMa35, ma35Rising, macdGreenRising, kdjBullish, npsyUp, rsiUp, npsyOrRsi, priceMomentumUp } = strategy2TechFlags(stock);
  const tradeValueOk = value >= STRATEGY2_TRADE_VALUE_OK;
  const entryVolumeOk = volume >= STRATEGY2_MIN_CUMULATIVE_VOLUME_ENTRY || value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY;
  const strictVolumeOk = latest1mVolume >= 50 || deltaVolume >= 50 || volume >= 2000 || value >= STRATEGY2_TRADE_VALUE_OK;
  const avg5dVolumeOk = avg5dVolume >= STRATEGY2_MIN_AVG5D_VOLUME_OK;
  const liquidityOk = volume >= STRATEGY2_MIN_CUMULATIVE_VOLUME_ENTRY || value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY;
  const reRisePattern = aboveMa35 && ma35Rising && priceMomentumUp && latestClose >= low * 1.01;
  const minuteVolumeBase = avg5dVolume > 0 ? Math.max(1, avg5dVolume / 270) : 0;
  const minuteVolumeRatio = minuteVolumeBase ? latest1mVolume / minuteVolumeBase : 0;
  const strongMinuteVolumeRatio = minuteVolumeBase ? Math.max(latest1mVolume, deltaVolume) / minuteVolumeBase : 0;
  const strictEntry = options.stateId === "entry" || options.stateId === "go" || options.strictEntry === true;
  const openingAcceleration = latest1mVolume >= 20
    || deltaVolume >= 50
    || close >= open * 1.01
    || volume >= 10000;

  if (
    entryVolumeOk
    && strictVolumeOk
    && pct >= 2
    && pct < 9.9
    && aboveMa35
    && ma35Rising
    && reRisePattern
    && npsyUp
    && kdjBullish
    && macdGreenRising
  ) add("confirmed_re_rise", `漲幅 ${pct.toFixed(2)}%，站上/守住 MA35，MA35 向上，NPSY/KDJ/MACD 柱狀體同步向上。`);

  if (
    entryVolumeOk
    && strictVolumeOk
    && latest1mVolume >= 50
    && avg5dVolumeOk
    && liquidityOk
    && pct >= -1
    && aboveMa35
    && ma35Rising
    && reRisePattern
    && kdjBullish
    && macdGreenRising
    && npsyOrRsi
  ) add("early_re_rise_entry", `最近分時量 ${Math.round(latest1mVolume)} 張，累計量 ${Math.round(volume)} 張，早期再起漲條件成立。`);

  if (
    value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY
    && pct >= -1
    && aboveMa35
    && ma35Rising
    && reRisePattern
    && priceMomentumUp
    && kdjBullish
    && macdGreenRising
    && npsyOrRsi
  ) add("creeping_re_rise", `成交金額 ${Math.round(value / 10000).toLocaleString("zh-TW")} 萬，沿 MA35 低量再起漲。`);

  if (
    entryVolumeOk
    && strictVolumeOk
    && avg5dVolumeOk
    && liquidityOk
    && pct >= -8
    && pct < -1
    && low > 0
    && latestClose >= low * 1.03
    && aboveMa35
    && ma35Rising
    && reRisePattern
    && kdjBullish
    && macdGreenRising
    && npsyOrRsi
  ) add("deep_rebound", `跌幅 ${pct.toFixed(2)}%，自低點反彈 ${(((latestClose - low) / low) * 100).toFixed(2)}%，轉強站回 MA35。`);

  if (
    minute <= STRATEGY2_OPEN_RUSH_END_MINUTES
    && avg5dVolumeOk
    && liquidityOk
    && pct >= 5
    && pct < 9.9
    && latest1mVolume >= 20
    && open > 0
    && latestClose > open
    && (
      minuteVolumeRatio >= 2
      || strongMinuteVolumeRatio >= 2.5
      || priceMomentumUp
      || buySellRatio >= 2
    )
  ) add("opening_breakout", `09:10 前漲幅 ${pct.toFixed(2)}%，分時量 ${Math.round(latest1mVolume)} 張，現價站上開盤價。`);

  if (
    minute >= STRATEGY2_ENTRY_START_MINUTES
    && minute <= STRATEGY2_OPEN_RUSH_END_MINUTES
    && pct >= 4
    && aboveMa35
    && ma35Rising
    && tradeValueOk
  ) add("open_rush", `09:00~09:10 漲幅 ${pct.toFixed(2)}%，站上 MA35 且 MA35 向上。`);

  if (
    minute >= STRATEGY2_EARLY_ATTACK_START_MINUTES
    && minute <= STRATEGY2_EARLY_ATTACK_END_MINUTES
    && !strictEntry
    && pct >= 2
    && aboveMa35
    && ma35Rising
    && macdGreenRising
    && tradeValueOk
  ) add("early_attack", `09:30~10:30 漲幅 ${pct.toFixed(2)}%，MA35/MACD 轉強但尚未正式進場。`);

  if (
    strictEntry
    || options.signalId === "open_burst_entry"
    || (options.signalId === "rebound" && options.stateId === "entry")
    || (
      volume >= 500
      && pct >= 2
      && aboveMa35
      && ma35Rising
      && macdGreenRising
      && kdjBullish
      && (npsyOrRsi || latest1mVolume >= 20 || deltaVolume >= 50)
    )
    || (
      minute <= STRATEGY2_OPEN_RUSH_END_MINUTES
      && pct >= 5
      && latest1mVolume >= 20
      && openingAcceleration
      && open > 0
      && close >= open
    )
  ) add("intraday_continuation", "盤中續攻子型成立或已通過進場區升級。");

  if (
    options.hadTriggeredStrong
    && pct >= 1
    && open > 0
    && close >= open * 1.01
    && volume >= 500
    && close >= open
    && high > 0
    && close >= high * 0.985
    && low >= open * 0.985
  ) add("triggered_still_strong", `先前已發動，現價仍貼近高點且量 ${Math.round(volume)} 張。`);

  if (
    volume >= 500
    && aboveMa35
    && macdGreenRising
    && kdjBullish
  ) add("rebound_turn", `成交量 ${Math.round(volume)} 張，重新站上 MA35，MACD/KDJ 同步翻強。`);

  return {
    strategyIds: uniqueCompact(tags.map((tag) => tag.id)),
    strategyTags: uniqueCompact(tags.map((tag) => tag.label)),
    primaryStrategy: tags[0]?.label || "",
    strategyReasons: uniqueCompact(reasons),
    preopenStrategy: preopen?.label || "",
    preopenSourceDate: preopen?.sourceDate || "",
  };
}

function classifyStrategy2State(stock, signal, options = {}) {
  if (signal.id !== "open_burst_entry" && signal.id !== "rebound") return null;
  const sourceHealthyForEntry = options.entrySourceHealthy !== false;
  const sourceCoverage = Number(options.sourceCoverage || 0);
  const coverageBelowEntryGate = sourceCoverage > 0 && sourceCoverage < MIN_ENTRY_SOURCE_COVERAGE;
  const actionableRebound = signal.id === "rebound" && isActionableStrategy2Rebound(signal);
  const score = signal.id === "rebound"
    ? Math.min(100, Math.round(62 + (signal.macdHistUp ? 8 : 0) + (signal.kdUp ? 8 : 0) + (signal.rsiUp ? 8 : 0)))
    : Math.min(100, Math.round(70 + (signal.macdDifUp ? 8 : 0) + (signal.macdHistUp ? 8 : 0) + (signal.kdUp ? 10 : 0)));
  if (!sourceHealthyForEntry) {
    const label = signal.id === "rebound" ? "反彈" : "開彈";
    return {
      stateId: "wait",
      stateLabel: "待確認",
      stateReason: coverageBelowEntryGate
        ? `${label}條件已符合，但本輪市場來源可用率 ${sourceCoverage.toFixed(2)} 未達 ${MIN_ENTRY_SOURCE_COVERAGE.toFixed(2)}，暫不升級。`
        : `${label}條件已符合；1分K/技術確認未就緒，暫不升級。`,
      score,
    };
  }
  if (signal.id === "rebound") {
    return {
      stateId: "entry",
      stateLabel: "進場區",
      stateReason: actionableRebound
        ? "反彈進場：1分K回踩MA35後重新站上，且量能放大、MACD/KD/RSI 任一轉強。"
        : "反彈進場：1分K回踩MA35後重新站上，MACD/KD/RSI 任一轉強。",
      score,
    };
  }
  return { stateId: "entry", stateLabel: "進場區", stateReason: "開彈進場：1分K close > MA35，MACD/DIF/K/D/J 全部向上。", score };
}

function detectOpenBurstEntrySignal(stock) {
  const latestClose = cleanNumber(stock.latest1mClose || stock.close);
  const ma35 = cleanNumber(stock.ma35);
  const volume = cleanNumber(stock.tradeVolume);
  const checks = {
    volume: volume >= 500,
    trustedMa35: ma35 > 0 && isTrustedStrategy2Ma35Source(stock.ma35Source),
    aboveMa35: latestClose > ma35 && ma35 > 0,
    macdUp: stock.macdHistUp === true,
    difUp: stock.macdDifUp === true,
    kUp: stock.kdKUp === true,
    dUp: stock.kdDUp === true,
    jUp: stock.kdJUp === true,
  };
  if (!Object.values(checks).every(Boolean)) return null;
  return {
    id: "open_burst_entry",
    label: "開彈",
    reason: `1分K close ${latestClose.toFixed(2)} > MA35 ${ma35.toFixed(2)}，MACD/DIF/K/D/J 向上`,
    entryPrice: latestClose,
    entryLow: latestClose,
    entryHigh: latestClose,
    stopLoss: latestClose * 0.985,
    chaseLimit: latestClose * 1.01,
    volumeMilestone: 500,
    deltaVolume: cleanNumber(stock.deltaVolume),
    ma35,
    ma35Prev: cleanNumber(stock.ma35Prev),
    aboveMa35: true,
    ma35TrendUp: stock.ma35TrendUp === true,
    ma35Source: stock.ma35Source || "",
    ma35Symbol: stock.ma35Symbol || "",
    ma35At: stock.latest1mAt || stock.ma35At || "",
    ma35Attempts: stock.ma35Attempts || [],
    macdDif: cleanNumber(stock.macdDif),
    macdDifPrev: cleanNumber(stock.macdDifPrev),
    macdSignal: cleanNumber(stock.macdSignal),
    macdHist: cleanNumber(stock.macdHist),
    macdHistPrev: cleanNumber(stock.macdHistPrev),
    macdUp: stock.macdHistUp === true,
    macdDifUp: stock.macdDifUp === true,
    macdHistUp: stock.macdHistUp === true,
    kdK: cleanNumber(stock.kdK),
    kdKPrev: cleanNumber(stock.kdKPrev),
    kdD: cleanNumber(stock.kdD),
    kdDPrev: cleanNumber(stock.kdDPrev),
    kdJ: cleanNumber(stock.kdJ),
    kdJPrev: cleanNumber(stock.kdJPrev),
    kdUp: stock.kdUp === true,
    kdKUp: stock.kdKUp === true,
    kdDUp: stock.kdDUp === true,
    kdJUp: stock.kdJUp === true,
    intradayVolumeBurst: true,
    latest1mClose: latestClose,
    latest1mAt: stock.latest1mAt || stock.ma35At || "",
    checks,
  };
}

function detectReboundEntrySignal(stock) {
  const latestClose = cleanNumber(stock.latest1mClose || stock.close);
  const latestOpen = cleanNumber(stock.latest1mOpen || stock.open || latestClose);
  const latestLow = cleanNumber(stock.latest1mLow || stock.low || latestClose);
  const previousClose = cleanNumber(stock.latest1mPrevClose);
  const ma35 = cleanNumber(stock.ma35);
  const ma35Prev = cleanNumber(stock.ma35Prev);
  const volume = cleanNumber(stock.tradeVolume);
  const touchedMa35 = latestLow <= ma35 * 1.003 || (previousClose > 0 && previousClose <= ma35Prev);
  const reclaimedMa35 = latestClose > ma35 && latestClose >= latestOpen;
  const momentumUp = stock.macdHistUp === true || stock.kdUp === true || stock.rsiUp === true;
  const checks = {
    volume: volume >= 500,
    touchedMa35,
    reclaimedMa35,
    ma35Ready: ma35 > 0 && isTrustedStrategy2Ma35Source(stock.ma35Source),
    momentumUp,
  };
  if (!Object.values(checks).every(Boolean)) return null;
  return {
    id: "rebound",
    label: "反彈",
    reason: `1分K回踩MA35 ${ma35.toFixed(2)} 後重新站上，MACD/KD/RSI任一轉強`,
    entryPrice: latestClose,
    entryLow: latestClose,
    entryHigh: latestClose,
    stopLoss: Math.min(latestLow || latestClose, ma35 || latestClose) * 0.985,
    chaseLimit: latestClose * 1.008,
    supportPrice: ma35,
    volumeMilestone: 500,
    deltaVolume: cleanNumber(stock.deltaVolume),
    ma35,
    ma35Prev,
    aboveMa35: true,
    ma35TrendUp: ma35Prev > 0 && ma35 >= ma35Prev,
    ma35Source: stock.ma35Source || "",
    ma35Symbol: stock.ma35Symbol || "",
    ma35At: stock.latest1mAt || stock.ma35At || "",
    ma35Attempts: stock.ma35Attempts || [],
    macdDif: cleanNumber(stock.macdDif),
    macdDifPrev: cleanNumber(stock.macdDifPrev),
    macdSignal: cleanNumber(stock.macdSignal),
    macdHist: cleanNumber(stock.macdHist),
    macdHistPrev: cleanNumber(stock.macdHistPrev),
    macdUp: stock.macdHistUp === true,
    macdDifUp: stock.macdDifUp === true,
    macdHistUp: stock.macdHistUp === true,
    kdK: cleanNumber(stock.kdK),
    kdKPrev: cleanNumber(stock.kdKPrev),
    kdD: cleanNumber(stock.kdD),
    kdDPrev: cleanNumber(stock.kdDPrev),
    kdJ: cleanNumber(stock.kdJ),
    kdJPrev: cleanNumber(stock.kdJPrev),
    kdUp: stock.kdUp === true,
    kdKUp: stock.kdKUp === true,
    kdDUp: stock.kdDUp === true,
    kdJUp: stock.kdJUp === true,
    rsi5: cleanNumber(stock.rsi5),
    rsi5Prev: cleanNumber(stock.rsi5Prev),
    rsi10: cleanNumber(stock.rsi10),
    rsi10Prev: cleanNumber(stock.rsi10Prev),
    rsiUp: stock.rsiUp === true,
    intradayVolumeBurst: cleanNumber(stock.deltaVolume) >= 50 || volume >= 10000,
    latest1mClose: latestClose,
    latest1mAt: stock.latest1mAt || stock.ma35At || "",
    checks,
  };
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

function scanTaipeiParts() {
  const override = process.env.STRATEGY2_SCAN_TIMESTAMP || process.env.FUMAN_SCAN_TIMESTAMP || "";
  if (override) {
    const parsed = Date.parse(String(override).includes("T") ? String(override) : String(override).replace(" ", "T") + "+08:00");
    if (Number.isFinite(parsed)) return taipeiParts(new Date(parsed));
  }
  return taipeiParts();
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

function normalizeQuoteTime(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 100000000000 ? value : value * 1000;
    return timestampKey(taipeiParts(new Date(milliseconds))).slice(11);
  }
  const text = String(value).trim();
  const timeOnly = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (timeOnly && !/[zZ]|[+-]\d{2}:?\d{2}/.test(text)) {
    return timeOnly[1].length === 5 ? `${timeOnly[1]}:00` : timeOnly[1];
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return timestampKey(taipeiParts(new Date(parsed))).slice(11);
  return "";
}

function quoteAgeSeconds(scanTimestamp, quoteTime) {
  const scanSeconds = secondsOfDay(scanTimestamp);
  const quoteSeconds = secondsOfDay(quoteTime);
  if (scanSeconds == null || quoteSeconds == null) return null;
  return Math.abs(scanSeconds - quoteSeconds);
}

function hasFreshQuote(stock, scanTimestamp) {
  if (secondsSinceIso(stock?.quoteSeenAt) <= MAX_QUOTE_AGE_SECONDS) return true;
  const age = quoteAgeSeconds(scanTimestamp, stock.quoteTime || stock.time);
  return age != null && age <= MAX_QUOTE_AGE_SECONDS;
}

function secondsSinceIso(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return Infinity;
  return Math.max(0, (Date.now() - timestamp) / 1000);
}

function hasUsableQuote(stock, scanTimestamp) {
  if (stock?.sourceHealthOk === true && secondsSinceIso(stock.quoteSeenAt) <= MAX_QUOTE_AGE_SECONDS && cleanNumber(stock.close) > 0) {
    return true;
  }
  if (stock?.recoveredFromQuoteCache) {
    return cleanNumber(stock.close) > 0
      && secondsSinceIso(stock.quoteSeenAt) <= QUOTE_CACHE_MAX_AGE_SECONDS
      && hasFreshQuote(stock, scanTimestamp);
  }
  return hasFreshQuote(stock, scanTimestamp);
}

function marketMinutes(parts = taipeiParts()) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = marketMinutes(parts);
  return minutes >= STRATEGY2_SCAN_START_MINUTES && minutes <= STRATEGY2_SCAN_END_MINUTES;
}

function isStrategy2EntryTime(parts = taipeiParts()) {
  const minutes = marketMinutes(parts);
  return minutes >= STRATEGY2_ENTRY_START_MINUTES && minutes <= STRATEGY2_ENTRY_END_MINUTES;
}

function compactDateKey(value, fallback) {
  const text = String(value || fallback || "");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  return fallback;
}

function compactTradeDate(value) {
  return String(compactDateKey(value, "") || "").replace(/\D/g, "");
}

function previousWeekdayCompact(value) {
  const compact = compactTradeDate(value);
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function payloadTradeDate(payload) {
  return compactTradeDate(payload?.usedDate || payload?.date || payload?.quoteDate || payload?.matches?.[0]?.quoteDate);
}

function readScorecardSource(sourceFile, latestFile, backupFile) {
  const source = readJson(sourceFile, { ok: true, matches: [] });
  if ((source.matches || []).length) return source;
  const latest = readJson(latestFile, { ok: true, matches: [] });
  if ((latest.matches || []).length) return latest;
  return readJson(backupFile, latest);
}

function readStrategy3ScorecardSource(today) {
  const expectedDate = previousWeekdayCompact(today);
  const empty = { ok: true, matches: [] };
  for (const payload of [
    readJson(STRATEGY3_SCORECARD_SOURCE_FILE, empty),
    readJson(STRATEGY3_FILE, empty),
    readJson(STRATEGY3_BACKUP_FILE, empty),
  ]) {
    if ((payload.matches || []).length && payloadTradeDate(payload) === expectedDate) return payload;
  }
  return empty;
}

function readStrategy5ScorecardSource(today) {
  const expectedDate = previousWeekdayCompact(today);
  const empty = { ok: true, matches: [] };
  for (const payload of [
    readJson(STRATEGY5_FILE, empty),
    readJson(STRATEGY5_BACKUP_FILE, empty),
  ]) {
    if ((payload.matches || []).length && payloadTradeDate(payload) === expectedDate) return payload;
  }
  return empty;
}

function updateTrackedExtremes(cache, stock, timestamp, key) {
  const high = cleanNumber(stock.high) || cleanNumber(stock.close);
  const low = cleanNumber(stock.low) || cleanNumber(stock.close);
  const close = cleanNumber(stock.close);
  const latest = cache.records
    .filter((record) => record.date === key && record.code === stock.code)
    .sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")))
    .at(-1);
  if (!latest) return;
  const currentDayHigh = cleanNumber(latest.dayHigh);
  const currentDayLow = cleanNumber(latest.dayLow);
  latest.observedPrice = close || latest.observedPrice;
  latest.observedHigh = close || latest.observedHigh;
  latest.observedHighAt = timestamp;
  latest.observedLow = close || latest.observedLow;
  latest.observedLowAt = timestamp;
  latest.currentVolume = cleanNumber(stock.tradeVolume) || latest.currentVolume || latest.volume;
  latest.currentPercent = cleanNumber(stock.percent) || latest.currentPercent || latest.percent;
  if (high && (!currentDayHigh || high > currentDayHigh)) {
    latest.dayHigh = high;
    latest.dayHighAt = timestamp;
  }
  if (low && (!currentDayLow || low < currentDayLow)) {
    latest.dayLow = low;
    latest.dayLowAt = timestamp;
  }
}

function appendTrackedSnapshot(cache, stock, timestamp, key, options = {}) {
  const rows = cache.records
    .filter((record) => record.date === key && record.code === stock.code)
    .sort((a, b) => String(a.timestamp || a.entryAt || "").localeCompare(String(b.timestamp || b.entryAt || "")));
  const latest = rows.at(-1);
  if (!latest) return false;
  if (String(latest.timestamp || latest.entryAt || "") === timestamp) return false;

  const close = cleanNumber(stock.close) || cleanNumber(latest.observedPrice || latest.entryPrice);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const volume = cleanNumber(stock.tradeVolume) || cleanNumber(latest.currentVolume || latest.volume);
  const previousVolume = cleanNumber(latest.currentVolume || latest.volume);
  const percent = cleanNumber(stock.percent) || cleanNumber(latest.currentPercent || latest.percent);
  const sourceCoverage = cleanNumber(options.sourceCoverage);
  const sourceCoverageHealthy = options.entrySourceHealthy !== false;
  const downgradeEntrySnapshot = isEntryState(latest) && !sourceCoverageHealthy;
  const strategyMeta = options.strategyMeta || {};

  cache.records.push({
    ...latest,
    timestamp,
    entryAt: timestamp,
    stateId: downgradeEntrySnapshot ? "wait" : latest.stateId,
    stateLabel: downgradeEntrySnapshot ? "待確認" : latest.stateLabel,
    stateReason: downgradeEntrySnapshot
      ? `既有進場追蹤保留，但本輪市場來源可用率 ${sourceCoverage.toFixed(2)} 未達 ${MIN_ENTRY_SOURCE_COVERAGE.toFixed(2)}，暫停升級進場區。`
      : latest.stateReason,
    entryPrice: close || cleanNumber(latest.entryPrice),
    observedPrice: close,
    observedHigh: close,
    observedHighAt: timestamp,
    observedLow: close,
    observedLowAt: timestamp,
    dayHigh: high,
    dayHighAt: timestamp,
    dayLow: low,
    dayLowAt: timestamp,
    currentVolume: volume,
    currentPercent: percent,
    volume,
    percent,
    deltaVolume: Math.max(0, volume - previousVolume),
    strategyIds: uniqueCompact([...(latest.strategyIds || []), ...(strategyMeta.strategyIds || [])]),
    strategyTags: uniqueCompact([...(latest.strategyTags || []), ...(strategyMeta.strategyTags || [])]),
    strategyReasons: uniqueCompact([...(latest.strategyReasons || []), ...(strategyMeta.strategyReasons || [])]),
    primaryStrategy: strategyMeta.primaryStrategy || latest.primaryStrategy || "",
    preopenStrategy: strategyMeta.preopenStrategy || latest.preopenStrategy || "",
    preopenSourceDate: strategyMeta.preopenSourceDate || latest.preopenSourceDate || "",
    sourceCoverage,
    sourceCoverageHealthy,
    isSnapshot: true,
  });
  return true;
}

function ensureTradeTrack(tracker, group, item, stock, timestamp, key) {
  const code = String(item.code || stock.code || "");
  if (!code) return null;
  const trackKey = `${group}:${code}`;
  const current = tracker.trades[trackKey] || {};
  const open = cleanNumber(stock.open);
  const close = cleanNumber(stock.close);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const yesterdayKey = compactDateKey(item.quoteDate, key);
  const entryPrice = cleanNumber(current.entryPrice)
    || (group === "openBuy" ? open : 0)
    || (group === "strategy3" ? cleanNumber(item.close) : 0)
    || open
    || cleanNumber(item.close)
    || close;
  const entryAt = current.entryAt || (group === "strategy3" ? `${yesterdayKey} 13:30:00` : `${key} 09:00:00`);
  const next = {
    ...current,
    date: key,
    group,
    code,
    name: item.name || stock.name || current.name || code,
    sourceUpdatedAt: item.updatedAt || current.sourceUpdatedAt || "",
    entryAt,
    entryPrice,
    observedPrice: close || current.observedPrice,
    volume: cleanNumber(stock.tradeVolume) || current.volume,
    percent: cleanNumber(stock.percent) || current.percent,
  };
  const currentHigh = cleanNumber(next.observedHigh);
  const currentLow = cleanNumber(next.observedLow);
  if (high && (!currentHigh || high > currentHigh)) {
    next.observedHigh = high;
    next.observedHighAt = timestamp;
  }
  if (low && (!currentLow || low < currentLow)) {
    next.observedLow = low;
    next.observedLowAt = timestamp;
  }
  tracker.trades[trackKey] = next;
  return next;
}

function strategy5EntrySignal(item, stock) {
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high) || close;
  const volume = cleanNumber(stock.tradeVolume);
  const value = cleanNumber(stock.value) || close * volume * 1000;
  const percent = cleanNumber(stock.percent);
  const sourceScore = cleanNumber(item.score);
  const reasons = [];
  if (!close) reasons.push("無即時價");
  if (percent < 2) reasons.push(`漲幅${percent.toFixed(2)}%不足`);
  if (percent > 8) reasons.push(`漲幅${percent.toFixed(2)}%過熱`);
  if (volume < 2000) reasons.push(`成交量${Math.round(volume)}張不足`);
  if (value < 80000000) reasons.push("成交金額不足");
  if (open && close < open) reasons.push("尚未站回開盤價");
  if (high && close < high * 0.985) reasons.push("現價離盤中高點太遠");
  return {
    pass: reasons.length === 0,
    reasons,
    score: sourceScore || 100,
    reason: reasons.length ? reasons.join("；") : "策略5前日名單，盤中量價符合管家條件",
  };
}

function ensureStrategy5Track(tracker, item, stock, timestamp, key) {
  const code = String(item.code || stock.code || "");
  if (!code) return null;
  const trackKey = `strategy5:${code}`;
  const current = tracker.trades[trackKey] || {};
  const close = cleanNumber(stock.close);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const volume = cleanNumber(stock.tradeVolume);
  const percent = cleanNumber(stock.percent);
  if (!current.entryAt) {
    const signal = strategy5EntrySignal(item, stock);
    if (!signal.pass) return null;
    current.entryAt = timestamp;
    current.entryPrice = close;
    current.entryReason = signal.reason;
    current.score = signal.score;
  }
  const next = {
    ...current,
    date: key,
    group: "strategy5",
    code,
    name: item.name || stock.name || current.name || code,
    sourceDate: compactTradeDate(item.quoteDate || item.date),
    sourceReason: item.activeMatch?.reason || item.matches?.[0]?.reason || item.reason || "",
    observedPrice: close || current.observedPrice,
    volume: volume || current.volume,
    percent: percent || current.percent,
  };
  const currentHigh = cleanNumber(next.observedHigh);
  const currentLow = cleanNumber(next.observedLow);
  if (high && (!currentHigh || high > currentHigh)) {
    next.observedHigh = high;
    next.observedHighAt = timestamp;
  }
  if (low && (!currentLow || low < currentLow)) {
    next.observedLow = low;
    next.observedLowAt = timestamp;
  }
  tracker.trades[trackKey] = next;
  return next;
}

function updateScorecardTradeTracks(tracker, strategy5Tracker, liveStocks, timestamp, key) {
  if (tracker.date !== key) {
    tracker.date = key;
    tracker.trades = {};
  }
  if (strategy5Tracker.date !== key) {
    strategy5Tracker.date = key;
    strategy5Tracker.trades = {};
  }
  const stockMap = new Map(liveStocks.map((stock) => [stock.code, stock]));
  const sources = [
    ["openBuy", readScorecardSource(OPEN_BUY_SCORECARD_SOURCE_FILE, OPEN_BUY_FILE, OPEN_BUY_BACKUP_FILE)],
    ["strategy3", readStrategy3ScorecardSource(key)],
  ];
  sources.forEach(([group, payload]) => {
    (payload.matches || []).forEach((item) => {
      const stock = stockMap.get(String(item.code || ""));
      if (stock) ensureTradeTrack(tracker, group, item, stock, timestamp, key);
    });
  });
  const strategy5Payload = readStrategy5ScorecardSource(key);
  (strategy5Payload.matches || []).forEach((item) => {
    const stock = stockMap.get(String(item.code || ""));
    if (stock) ensureStrategy5Track(strategy5Tracker, item, stock, timestamp, key);
  });
  tracker.updatedAt = new Date().toISOString();
  strategy5Tracker.updatedAt = tracker.updatedAt;
}

function timeLabel(value) {
  const match = String(value || "").match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return match ? `${match[1]}:${match[2]}${match[3] ? `:${match[3]}` : ""}` : "";
}

function timeValue(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function recordTimeLabel(record) {
  return timeLabel(record.entryAt || record.timestamp);
}

function isEntryState(record) {
  return record?.stateId === "entry" || record?.stateId === "go";
}

function mergeStrategy2Events(records, key) {
  const events = {};
  records
    .filter((record) => record.date === key)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.code).localeCompare(String(b.code)))
    .forEach((record) => {
      const code = String(record.code || "");
      if (!code) return;
      const current = events[code] || {
        code,
        name: record.name || code,
        date: key,
        firstBAt: "",
        firstBPrice: 0,
        highAfterB: 0,
        highAfterBAt: "",
        firstAAt: "",
        firstAPrice: 0,
        firstTradableAAt: "",
        firstTradableAPrice: 0,
        latestAAt: "",
        latestAPrice: 0,
        latestBAt: "",
        latestBPrice: 0,
        latestSeenAt: "",
        latestSeenPrice: 0,
        highAfterA: 0,
        highAfterAAt: "",
        highestPrice: 0,
        highestAt: "",
        latestState: "",
        stateId: "wait",
        stateLabel: "待確認",
        maxScore: 0,
        strategies: [],
        strategyIds: [],
        strategyTags: [],
        strategyReasons: [],
        primaryStrategy: "",
        preopenStrategy: "",
        preopenSourceDate: "",
        enhancements: [],
        stateReason: "",
        supportPrice: 0,
        ma35: 0,
        ma35Prev: 0,
        aboveMa35: false,
        ma35TrendUp: false,
        ma35Source: "",
        ma35At: "",
        ma35Symbol: "",
        latestRecord: null,
      };
      const price = cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice);
      const observedHigh = cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice) || price;
      const eventTime = recordTimeLabel(record);
      const highTime = timeLabel(record.observedHighAt || record.timestamp);
      if (eventTime) {
        current.latestSeenAt = eventTime;
        current.latestSeenPrice = price;
      }
      if (!current.firstBAt && eventTime) {
        current.firstBAt = eventTime;
        current.firstBPrice = price;
        current.highAfterB = observedHigh || price;
        current.highAfterBAt = highTime || eventTime;
      }
      if (!isEntryState(record) && eventTime) {
        current.latestBAt = eventTime;
        current.latestBPrice = price;
      }
      if (current.firstBAt && observedHigh > cleanNumber(current.highAfterB)) {
        current.highAfterB = observedHigh;
        current.highAfterBAt = highTime || eventTime;
      }
      if (isEntryState(record) && !current.firstAAt && eventTime) {
        current.firstAAt = eventTime;
        current.firstAPrice = price;
        current.highAfterA = observedHigh || price;
        current.highAfterAAt = highTime || eventTime;
        current.stateReason = record.stateReason || current.stateReason;
      }
      if (isEntryState(record) && eventTime) {
        current.latestAAt = eventTime;
        current.latestAPrice = price;
      }
      if (isEntryState(record) && !current.firstTradableAAt && eventTime && timeValue(eventTime) >= timeValue(MANAGER_MIN_ENTRY_TIME)) {
        current.firstTradableAAt = eventTime;
        current.firstTradableAPrice = price;
      }
      if (current.firstAAt && observedHigh > cleanNumber(current.highAfterA)) {
        current.highAfterA = observedHigh;
        current.highAfterAAt = highTime || eventTime;
      }
      if (observedHigh > cleanNumber(current.highestPrice)) {
        current.highestPrice = observedHigh;
        current.highestAt = highTime || eventTime;
      }
      if (record.strategy && !current.strategies.includes(record.strategy)) {
        current.strategies.push(record.strategy);
      }
      (record.strategyTags || []).forEach((tag) => {
        if (tag && !current.strategies.includes(tag)) current.strategies.push(tag);
        if (tag && !current.strategyTags.includes(tag)) current.strategyTags.push(tag);
      });
      (record.strategyIds || []).forEach((id) => {
        if (id && !current.strategyIds.includes(id)) current.strategyIds.push(id);
      });
      (record.strategyReasons || []).forEach((reason) => {
        if (reason && !current.strategyReasons.includes(reason)) current.strategyReasons.push(reason);
      });
      current.primaryStrategy = current.primaryStrategy || record.primaryStrategy || current.strategyTags[0] || record.strategy || "";
      current.preopenStrategy = current.preopenStrategy || record.preopenStrategy || "";
      current.preopenSourceDate = current.preopenSourceDate || record.preopenSourceDate || "";
      const recordMa35 = cleanNumber(record.ma35);
      const recordAboveMa35 = record.aboveMa35 === true && recordMa35 > 0;
      const recordHasTrustedMa35 = recordAboveMa35 && isTrustedStrategy2Ma35Source(record.ma35Source);
      if (eventTime) {
        current.latestRecord = record;
      }
      if (recordHasTrustedMa35 && (isEntryState(record) || !current.ma35)) {
        current.ma35 = recordMa35;
        current.ma35Prev = cleanNumber(record.ma35Prev);
        current.aboveMa35 = true;
        current.ma35TrendUp = record.ma35TrendUp === true;
        current.ma35Source = record.ma35Source || "";
        current.ma35At = record.ma35At || "";
        current.ma35Symbol = record.ma35Symbol || "";
      }
      const previousMaxScore = cleanNumber(current.maxScore);
      const recordScore = cleanNumber(record.score);
      const deltaVolume = cleanNumber(record.deltaVolume);
      const stillAboveMa35 = record.aboveMa35 !== false && cleanNumber(record.ma35) > 0;
      const ma35TrendUp = record.ma35TrendUp === true;
      const enhancementText = `${record.strategy || ""} ${record.reason || ""}`;
      const enhancementTrigger = deltaVolume >= 50
        ? "volume"
        : /急拉爆量|分時爆量|分時放大|持續放量|爆量|放大/.test(enhancementText)
        ? "text"
        : (recordScore && previousMaxScore && recordScore >= previousMaxScore + 3)
        ? "score"
        : "";
      const isAEnhancement = current.firstAAt
        && eventTime
        && eventTime !== current.firstAAt
        && isEntryState(record)
        && stillAboveMa35
        && ma35TrendUp
        && enhancementTrigger;
      if (isAEnhancement && !current.enhancements.some((item) => item.at === eventTime)) {
        current.enhancements.push({
          at: eventTime,
          price: price || cleanNumber(record.observedPrice),
          score: recordScore,
          deltaVolume,
          totalVolume: cleanNumber(record.volume),
          trigger: enhancementTrigger,
          ma35: cleanNumber(record.ma35),
          ma35Prev: cleanNumber(record.ma35Prev),
          aboveMa35: record.aboveMa35 !== false,
          ma35TrendUp,
          ma35Source: record.ma35Source || "",
          ma35At: record.ma35At || "",
          ma35Symbol: record.ma35Symbol || "",
          strategy: "持續放量",
          reason: `${record.name || code} 持續放量，MA35來源：${ma35SourceLabel(record.ma35Source)}`,
        });
      }
      current.latestState = isEntryState(record) ? "entry" : "wait";
      current.stateId = current.firstAAt ? "entry" : "wait";
      current.stateLabel = current.firstAAt ? "進場區" : "待確認";
      current.maxScore = Math.max(previousMaxScore, recordScore);
      if (isEntryState(record) || !current.firstAAt) {
        current.stateReason = record.stateReason || current.stateReason;
      }
      current.supportPrice = cleanNumber(current.supportPrice) || cleanNumber(record.supportPrice);
      events[code] = current;
    });
  return Object.values(events).sort((a, b) => {
    if (!!b.firstAAt !== !!a.firstAAt) return b.firstAAt ? 1 : -1;
    if (a.firstAAt && b.firstAAt) return String(b.latestAAt || b.firstAAt).localeCompare(String(a.latestAAt || a.firstAAt)) || String(a.code).localeCompare(String(b.code));
    return cleanNumber(b.maxScore) - cleanNumber(a.maxScore) || String(a.code).localeCompare(String(b.code));
  });
}

function inferLegacyRecordState(record) {
  const pct = cleanNumber(record.percent);
  const strategy = String(record.strategy || "");
  return {
    stateId: "wait",
    stateLabel: "待確認",
    stateReason: `${strategy || "盤中轉強"}，舊紀錄未附完整1分K站上MA35證據，降級為待確認。`,
    score: cleanNumber(record.score) || Math.min(88, Math.round(Math.max(pct, 0) * 8 + 42)),
  };
}

function isActionableStrategy2Rebound(record) {
  const ma35 = cleanNumber(record?.ma35);
  const hasTrustedMa35 = isTrustedStrategy2Ma35Source(record?.ma35Source) && ma35 > 0;
  const hasMomentum = record?.macdUp === true || record?.macdHistUp === true || record?.kdUp === true || record?.rsiUp === true;
  return String(record?.signalId || record?.signal?.id || record?.id || "") === "rebound"
    && record?.aboveMa35 === true
    && hasTrustedMa35
    && hasMomentum
    && record?.intradayVolumeBurst === true;
}

function isStrictStrategy2Ma35Record(record) {
  const ma35 = cleanNumber(record?.ma35);
  const hasIntradaySma35 = isTrustedStrategy2Ma35Source(record?.ma35Source) && ma35 > 0;
  const recordSourceCoverage = cleanNumber(record?.sourceCoverage);
  const createdUnderUnhealthySource = recordSourceCoverage > 0 && recordSourceCoverage < MIN_ENTRY_SOURCE_COVERAGE;
  const signalId = String(record?.signalId || record?.signal?.id || record?.id || "");
  const isOpenBurstEntry = signalId === "ma35_buy" || signalId === "open_burst_entry";
  if (createdUnderUnhealthySource) return false;
  if (isActionableStrategy2Rebound(record)) return true;
  return isOpenBurstEntry
    && record?.aboveMa35 === true
    && hasIntradaySma35
    && record?.macdUp === true
    && record?.kdUp === true
    && record?.intradayVolumeBurst === true;
}

function isStrategy2ConditionEntryRecord(record) {
  const strategyIds = Array.isArray(record?.strategyIds) ? record.strategyIds : [];
  return strategyIds.some((id) => [
    "star",
    "preopen_watch",
    "open_rush",
    "early_attack",
    "intraday_continuation",
    "triggered_still_strong",
    "rebound_turn",
    "confirmed_re_rise",
    "early_re_rise_entry",
    "creeping_re_rise",
    "deep_rebound",
    "opening_breakout",
  ].includes(id));
}

function isStrategy2RecordWithinBaseGate(record) {
  if (isStrictStrategy2Ma35Record(record)) return true;
  const strategyIds = Array.isArray(record?.strategyIds) ? record.strategyIds : [];
  const pct = cleanNumber(record?.percent);
  const volume = cleanNumber(record?.volume) || cleanNumber(record?.tradeVolume);
  const value = cleanNumber(record?.value);
  if (strategyIds.includes("star") || strategyIds.includes("preopen_watch")) return true;
  if (strategyIds.includes("deep_rebound")) {
    return pct >= -8 && pct < -1 && (volume >= STRATEGY2_MIN_CUMULATIVE_VOLUME_ENTRY || value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY);
  }
  if (strategyIds.includes("creeping_re_rise")) {
    return pct >= -1 && value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY;
  }
  if (strategyIds.includes("triggered_still_strong") || strategyIds.includes("rebound_turn")) {
    return pct >= 1 && volume >= 500;
  }
  if (strategyIds.some((id) => ["early_re_rise_entry"].includes(id))) {
    return pct >= -1 && (volume >= STRATEGY2_MIN_CUMULATIVE_VOLUME_ENTRY || value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY);
  }
  if (strategyIds.some((id) => ["open_rush", "early_attack", "intraday_continuation", "confirmed_re_rise", "opening_breakout"].includes(id))) {
    return pct >= 2 && (volume >= 500 || value >= STRATEGY2_MIN_TRADE_VALUE_ENTRY);
  }
  return pct >= 2 && volume >= 2000;
}

function normalizeStrategy2Records(records) {
  let dropped = 0;
  const normalized = (records || []).map((record) => {
    if (!isEntryState(record) && isStrategy2ConditionEntryRecord(record)) {
      return {
        ...record,
        stateId: "entry",
        stateLabel: "進場區",
        stateReason: (record.strategyReasons || [])[0] || record.stateReason || `${record.primaryStrategy || record.strategy || "策略2"} 條件成立，列入 A 進場區。`,
      };
    }
    if (!isEntryState(record) && isStrictStrategy2Ma35Record(record)) {
      const signalId = String(record.signalId || record?.signal?.id || "");
      return {
        ...record,
        stateId: "entry",
        stateLabel: "進場區",
        stateReason: signalId === "rebound"
          ? "反彈進場：1分K回踩MA35後重新站上，且量能放大、MACD/KD/RSI 任一轉強。"
          : "開彈進場：1分K close > MA35，MACD/DIF/K/D/J 全部向上。",
      };
    }
    if (record.stateId && record.stateLabel) {
      if ((record.stateId === "entry" || record.stateId === "go") && !isStrictStrategy2Ma35Record(record) && !isStrategy2ConditionEntryRecord(record)) {
        return {
          ...record,
          stateId: "wait",
          stateLabel: "待確認",
          stateReason: `${record.strategy || "盤中轉強"}，量價轉強但尚未通過1分K站上MA35完整進場條件。`,
        };
      }
      return record;
    }
    return {
      ...record,
      ...inferLegacyRecordState(record),
    };
  }).filter((record) => {
    const keep = isStrategy2RecordWithinBaseGate(record);
    if (!keep) dropped += 1;
    return keep;
  });
  if (dropped) {
    console.warn(`strategy2 base gate dropped stale records=${dropped}`);
  }
  return normalized;
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "FumanIntradayScorecard/1.0" } });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStocks(options = {}) {
  const result = await fetchActiveCommonStockQuotes({
    maxQuoteAgeSeconds: options.maxQuoteAgeSeconds || SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS,
    minQuotes: options.minQuotes ?? SUPABASE_SOURCE_MIN_QUOTES,
    minActiveSymbols: SUPABASE_SOURCE_MIN_ACTIVE_SYMBOLS,
    allowWarmupSource: options.allowWarmupSource,
  });
  if (!result.ok) throw new Error(result.error || SUPABASE_SHARED_SOURCE_ERROR_MESSAGE);
  return result.quotes.map((quote) => {
    const close = cleanNumber(quote.close);
    const prevClose = cleanNumber(quote.prevClose);
    const change = close && prevClose ? close - prevClose : 0;
    return {
      code: String(quote.code || ""),
      name: String(quote.name || ""),
      close,
      change,
      percent: cleanNumber(quote.percent),
      prevClosePercent: cleanNumber(quote.percent),
      value: cleanNumber(quote.value),
      tradeVolume: normalizeVolumeLots(quote.tradeVolume),
      open: cleanNumber(quote.open),
      high: cleanNumber(quote.high),
      low: cleanNumber(quote.low),
      prevClose,
      limitUp: cleanNumber(quote.limitUp || quote.limit_up_price || quote.limitUpPrice),
      quoteTime: quote.quoteTime || quote.time || quote.updatedAt || "",
      quoteSource: quote.quoteSource || "supabase-public-slot",
      realtimeFallback: quote.realtimeFallback || "supabase-public-slot",
      stockType: quote.stockType || "",
      session: quote.session || "",
      isHalted: quote.isHalted === true,
      isTrial: quote.isTrial === true,
      cumulativeBidVolume: cleanNumber(quote.cumulativeBidVolume),
      cumulativeAskVolume: cleanNumber(quote.cumulativeAskVolume),
      cumulativeBidAskVolume: cleanNumber(quote.cumulativeBidAskVolume),
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
}

async function annotateDailyVolumeAverages(stocks) {
  const codes = stocks.map((stock) => stock.code).filter(Boolean);
  if (!codes.length) return stocks;
  const result = await fetchDailyVolumeAverages(codes, 5).catch((error) => ({
    ok: false,
    byCode: new Map(),
    error: error?.message || String(error),
  }));
  if (!result.ok) {
    console.warn(`strategy2 daily volume read skipped: ${result.error || "unknown error"}`);
    return stocks;
  }
  const annotated = stocks.map((stock) => {
    const info = result.byCode.get(String(stock.code)) || {};
    return {
      ...stock,
      avg5dVolume: cleanNumber(info.avgVolume),
      avg5dVolumeDays: cleanNumber(info.days),
    };
  });
  if (MIN_AVG_5D_VOLUME <= 0) return annotated;
  const filtered = annotated.filter((stock) => cleanNumber(stock.avg5dVolume) >= MIN_AVG_5D_VOLUME);
  console.log(`strategy2 daily volume gate: kept ${filtered.length}/${annotated.length}, minAvg5dVolume=${MIN_AVG_5D_VOLUME}`);
  return filtered;
}

function buildStrategy2SharedSourceAbnormalReport(cache, key, timestamp, health) {
  const updatedAt = new Date().toISOString();
  const statusPayload = health?.payload && typeof health.payload === "object" ? health.payload : {};
  const statusText = health?.status?.status || "missing";
  const retainedRecords = normalizeStrategy2Records((cache.records || []).filter((record) => record.date === key));
  const retainedEvents = mergeStrategy2Events(retainedRecords, key);
  cache.date = key;
  cache.records = retainedRecords;
  cache.updatedAt = updatedAt;
  cache.realtime = {
    source: "supabase-public-slot",
    sourceName: "fugle_daytrade_source",
    sourceStatus: statusText,
    sourceStatusPayload: statusPayload,
    sourceStatusUpdatedAt: health?.status?.updated_at || health?.status?.checked_at || "",
    sourceAgeSeconds: Number.isFinite(Number(health?.sourceAgeSeconds)) ? Number(health.sourceAgeSeconds) : null,
    entrySourceHealthy: false,
    sourceCoverageHealthy: false,
    supabaseOnly: true,
    skippedSupabaseSharedSourceUnhealthy: true,
    message: SUPABASE_SHARED_SOURCE_ERROR_MESSAGE,
    reason: health?.reason || health?.message || "source_status missing",
    scanTimestamp: timestamp,
  };
  return enforceStrategy2EntryGuards({
    source: "strategy2-supabase-first",
    date: key,
    updatedAt,
    status: "supabase_shared_source_unhealthy",
    message: SUPABASE_SHARED_SOURCE_ERROR_MESSAGE,
    reason: cache.realtime.reason,
    realtime: cache.realtime,
    records: retainedRecords,
    events: retainedEvents,
    entryCount: retainedEvents.filter((event) => event.firstAAt).length,
    aCount: retainedEvents.filter((event) => event.firstAAt).length,
    bOnlyCount: 0,
    publishBlocked: true,
    publishBlockedReason: cache.realtime.reason,
  });
}

function readRetainableStrategy2EntryReport(key) {
  if (RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS <= 0) return null;
  const report = readJson(STRATEGY2_REPORT_FILE, null);
  if (!report || report.date !== key) return null;
  const entryCount = cleanNumber(report.entryCount || report.aCount);
  const updatedAtMs = Date.parse(report.updatedAt || report.generatedAt || "");
  if (!(entryCount > 0) || !Number.isFinite(updatedAtMs)) return null;
  const ageSeconds = (Date.now() - updatedAtMs) / 1000;
  if (ageSeconds < 0 || ageSeconds > RETAIN_LAST_GOOD_ON_SOURCE_UNHEALTHY_SECONDS) return null;
  return { report, ageSeconds };
}

async function fetchRealtime(stocks, scanTimestamp = timestampKey()) {
  const quotes = new Map();
  const recoveredCodes = new Set();
  const failedBatches = [];
  const retryBatches = [];
  const missedCodes = new Set();
  const fallbackCandidateCodes = new Set(
    [...stocks]
      .filter((stock) => /^\d{4}$/.test(String(stock.code || "")) && !String(stock.code).startsWith("00"))
      .sort((a, b) =>
        (cleanNumber(b.percent) - cleanNumber(a.percent))
        || (cleanNumber(b.tradeVolume) - cleanNumber(a.tradeVolume))
        || String(a.code).localeCompare(String(b.code))
      )
      .slice(0, REALTIME_FALLBACK_CANDIDATE_LIMIT)
      .map((stock) => String(stock.code))
  );
  let fugleRateLimited = false;
  const fallbackStats = {
    supabasePublicSlot: { requested: 0, recovered: 0, failed: 0, healthy: false, sourceAgeSeconds: null, error: "" },
    fugleWs: { available: 0, used: 0 },
    fugle: { configured: Boolean(FUGLE_API_KEY), requested: 0, recovered: 0, empty: 0, failed: 0, skippedNoKey: 0, rateLimited: false },
    finmind: { configured: Boolean(FINMIND_API_TOKEN), enabled: ENABLE_FINMIND_REALTIME, rescueEnabled: ENABLE_FINMIND_RESCUE, requested: 0, recovered: 0, failed: 0 },
    yahoo: { requested: 0, recovered: 0, failed: 0 },
    rescue: { threshold: REALTIME_RESCUE_COVERAGE, limit: REALTIME_RESCUE_LIMIT, cooldownMs: REALTIME_RESCUE_COOLDOWN_MS, requested: 0, recovered: 0 },
  };

  const supabaseCodes = [...fallbackCandidateCodes];
  if (supabaseCodes.length) {
    fallbackStats.supabasePublicSlot.requested = supabaseCodes.length;
    const supabaseResult = await fetchSupabaseFugleQuotes(supabaseCodes, {
      maxQuoteAgeSeconds: SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS,
      maxSourceAgeSeconds: SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS,
    }).catch((error) => ({ ok: false, error: error?.message || String(error), byCode: new Map() }));
    fallbackStats.supabasePublicSlot.healthy = supabaseResult.sourceHealthy === true;
    fallbackStats.supabasePublicSlot.sourceAgeSeconds = Number.isFinite(Number(supabaseResult.sourceAgeSeconds))
      ? Number(supabaseResult.sourceAgeSeconds)
      : null;
    if (supabaseResult.ok && supabaseResult.byCode instanceof Map) {
      for (const [code, quote] of supabaseResult.byCode.entries()) {
        if (!fallbackCandidateCodes.has(String(code))) continue;
        quotes.set(String(code), quote);
        recoveredCodes.add(String(code));
        fallbackStats.supabasePublicSlot.recovered += 1;
      }
    } else {
      fallbackStats.supabasePublicSlot.failed = supabaseCodes.length;
      fallbackStats.supabasePublicSlot.error = String(supabaseResult.error || "supabase fugle slot unavailable").slice(0, 160);
      console.log(`realtime supabase fugle slot skipped: ${fallbackStats.supabasePublicSlot.error}`);
    }
  }

  const supabaseDiagnostics = quoteDiagnostics();
  stocks.forEach((stock) => {
    const code = String(stock.code || "");
    if (!quotes.has(code) && /^\d{4}$/.test(code) && !code.startsWith("00")) missedCodes.add(code);
  });
  fetchRealtime.lastStats = {
    requested: stocks.length,
    received: quotes.size,
    usableBeforeRescue: supabaseDiagnostics.usableCount,
    coverageBeforeRescue: Number(supabaseDiagnostics.usableCoverage.toFixed(4)),
    usableAfterRescue: supabaseDiagnostics.usableCount,
    coverageAfterRescue: Number(supabaseDiagnostics.usableCoverage.toFixed(4)),
    unusableBreakdown: supabaseDiagnostics.breakdown,
    sourceHealth: supabaseDiagnostics.sourceHealth,
    failed: fallbackStats.supabasePublicSlot.failed ? 1 : 0,
    failedBatches,
    retryBatches,
    batchConcurrency: 0,
    fallbackCandidateLimit: REALTIME_FALLBACK_CANDIDATE_LIMIT,
    fallbackCandidateCount: fallbackCandidateCodes.size,
    yahooFallbackConcurrency: 0,
    fugleRateLimited: false,
    fallbackStats,
    finmindRealtimeEnabled: false,
    finmindRescueEnabled: false,
    recoveredCodes: [...recoveredCodes],
    missedCodes: [...missedCodes],
    staleCodes: [...supabaseDiagnostics.staleCodes].slice(0, 80),
    noTimeCodes: [...supabaseDiagnostics.noTimeCodes].slice(0, 80),
    noCloseCodes: [...supabaseDiagnostics.noCloseCodes].slice(0, 80),
    missedCount: missedCodes.size,
    supabaseOnly: true,
  };
  console.log(
    `realtime supabase-first stats: requested=${fallbackStats.supabasePublicSlot.requested} recovered=${fallbackStats.supabasePublicSlot.recovered} healthy=${fallbackStats.supabasePublicSlot.healthy} age=${fallbackStats.supabasePublicSlot.sourceAgeSeconds ?? "--"} failed=${fallbackStats.supabasePublicSlot.failed}; `
    + `usable=${supabaseDiagnostics.usableCount}/${stocks.length} coverage=${Number(supabaseDiagnostics.usableCoverage.toFixed(4))}`
  );
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return { ...stock, isRealtime: false };
    const quoteVolume = normalizeRealtimeQuoteVolume(quote);
    const value = quoteVolume && cleanNumber(quote.close)
      ? quoteVolume * cleanNumber(quote.close)
      : stock.value;
    return {
      ...stock,
      ...quote,
      avg5dVolume: cleanNumber(quote.avg5dVolume) || cleanNumber(stock.avg5dVolume),
      avg5dVolumeDays: cleanNumber(quote.avg5dVolumeDays) || cleanNumber(stock.avg5dVolumeDays),
      prevClosePercent: cleanNumber(quote.percent) || cleanNumber(stock.prevClosePercent),
      limitUp: cleanNumber(quote.limitUp || quote.limitUpPrice) || cleanNumber(stock.limitUp),
      quoteTime: quote.time,
      tradeVolume: quoteVolume,
      value,
      isRealtime: true,
      recoveredFromRealtimeFallback: recoveredCodes.has(stock.code),
    };
  });

  const wsCodes = stocks
    .map((stock) => String(stock.code || ""))
    .filter((code) => /^\d{4}$/.test(code) && !code.startsWith("00"));
  if (wsCodes.length) {
    const fugleWs = overlayFugleWebSocketQuoteMap(wsCodes, {
      source: "strategy2-intraday",
      scanTimestamp,
      maxAgeMs: MAX_QUOTE_AGE_SECONDS * 1000,
    });
    fallbackStats.fugleWs.available = fugleWs.available;
    fallbackStats.fugleWs.used = fugleWs.used;
    for (const [code, quote] of fugleWs.map) quotes.set(code, quote);
  }

  async function fetchRealtimeBatch(codes) {
    if (!codes.length) return;
    const requestedCodes = new Set(codes.map((code) => String(code)));
    const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 12000);
    (payload.quotes || []).forEach((quote) => {
      const code = String(quote.code || "");
      if (!requestedCodes.has(code)) return;
      const current = quotes.get(code);
      if (current && hasFreshQuote(current, scanTimestamp) && !hasFreshQuote(quote, scanTimestamp)) return;
      quotes.set(code, quote);
    });
    if (codes.length > 1 && (payload.quotes || []).length === 0) throw new Error("api/realtime returned no quotes");
  }

  function quoteDiagnostics() {
    const usableCodes = new Set();
    const staleCodes = new Set();
    const noTimeCodes = new Set();
    const noCloseCodes = new Set();
    const missingCodes = new Set();
    const sourceHealth = {};
    function sourceKey(quote) {
      return String(quote?.realtimeFallback || quote?.closeSource || quote?.quoteSource || "api/realtime");
    }
    function noteSource(quote, bucket) {
      const key = sourceKey(quote);
      sourceHealth[key] = sourceHealth[key] || { received: 0, usable: 0, stale: 0, noTime: 0, noClose: 0 };
      if (bucket !== "missing") sourceHealth[key].received += 1;
      sourceHealth[key][bucket] = (sourceHealth[key][bucket] || 0) + 1;
    }
    stocks.forEach((stock) => {
      const code = String(stock.code || "");
      if (!code) return;
      const quote = quotes.get(code);
      if (!quote) {
        missingCodes.add(code);
        return;
      }
      if (cleanNumber(quote.close) <= 0) {
        noCloseCodes.add(code);
        noteSource(quote, "noClose");
        return;
      }
      if (quote.sourceHealthOk === true && secondsSinceIso(quote.quoteSeenAt) <= MAX_QUOTE_AGE_SECONDS) {
        usableCodes.add(code);
        noteSource(quote, "usable");
        return;
      }
      const age = quoteAgeSeconds(scanTimestamp, quote.quoteTime || quote.time);
      if (age == null) {
        noTimeCodes.add(code);
        noteSource(quote, "noTime");
        return;
      }
      if (age > MAX_QUOTE_AGE_SECONDS) {
        staleCodes.add(code);
        noteSource(quote, "stale");
        return;
      }
      usableCodes.add(code);
      noteSource(quote, "usable");
    });
    const usableCoverage = stocks.length ? usableCodes.size / stocks.length : 1;
    return {
      usableCodes,
      staleCodes,
      noTimeCodes,
      noCloseCodes,
      missingCodes,
      usableCount: usableCodes.size,
      usableCoverage,
      breakdown: {
        usable: usableCodes.size,
        stale: staleCodes.size,
        noTime: noTimeCodes.size,
        noClose: noCloseCodes.size,
        missing: missingCodes.size,
      },
      sourceHealth,
    };
  }

  async function fetchFugleRealtimeQuote(code) {
    if (!FUGLE_API_KEY || !/^\d{4}$/.test(String(code))) return null;
    const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${code}`;
    const timer = setTimeout(() => {}, 0);
    clearTimeout(timer);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "FumanStrategy2Realtime/1.0",
        "X-API-KEY": FUGLE_API_KEY,
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
    if (!response.ok) throw new Error(`fugle quote HTTP ${response.status}`);
    const payload = await response.json();
    const close = cleanNumber(payload.closePrice || payload.close || payload.lastPrice || payload.price);
    const prevClose = cleanNumber(payload.referencePrice || payload.previousClose || payload.prevClose || payload.previousPrice);
    if (!close || !prevClose) return null;
    const change = cleanNumber(payload.change) || (close - prevClose);
    const quoteTime = normalizeQuoteTime(payload.lastUpdated || payload.lastTradeTime || payload.time || payload.lastUpdatedAt || payload.updatedAt || payload.timestamp);
    return {
      code: String(payload.symbol || code),
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
      quoteTime,
      time: quoteTime || payload.lastUpdated || payload.lastTradeTime || payload.time || "",
      realtimeFallback: "fugle",
    };
  }

  async function fetchFugleFallback(codes, parentLabel, options = {}) {
    const replaceExisting = options.replaceExisting === true;
    const targetCodes = codes.filter((code) => fallbackCandidateCodes.has(String(code)) && (replaceExisting || !quotes.has(String(code))));
    fallbackStats.fugle.requested += targetCodes.length;
    if (!FUGLE_API_KEY) {
      fallbackStats.fugle.skippedNoKey += targetCodes.length;
      return;
    }
    for (const code of targetCodes) {
      if (fugleRateLimited) break;
      if (!replaceExisting && quotes.has(code)) continue;
      try {
        const quote = await fetchFugleRealtimeQuote(code);
        if (quote?.close) {
          quotes.set(String(code), quote);
          recoveredCodes.add(String(code));
          fallbackStats.fugle.recovered += 1;
        } else {
          fallbackStats.fugle.empty += 1;
        }
      } catch (error) {
        if (String(error.message || "").includes("HTTP 429")) {
          fugleRateLimited = true;
          fallbackStats.fugle.rateLimited = true;
          console.log(`realtime fugle rate limited at ${code} from ${parentLabel}; fallback paused this round`);
          break;
        }
        fallbackStats.fugle.failed += 1;
        console.log(`realtime fugle failed ${code} from ${parentLabel}: ${error.message}`);
      }
    }
  }

  async function fetchYahooFallback(codes, parentLabel, options = {}) {
    const replaceExisting = options.replaceExisting === true;
    const targetCodes = codes.filter((code) => fallbackCandidateCodes.has(String(code)) && (replaceExisting || !quotes.has(String(code))));
    fallbackStats.yahoo.requested += targetCodes.length;
    let yahooCursor = 0;
    async function fetchYahooCode(code) {
      for (const suffix of ["TW", "TWO"]) {
        try {
          const symbol = `${code}.${suffix}`;
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
          const payload = await fetchJson(url, 9000);
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
          quotes.set(String(code), {
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
            time: timestamps[lastIndex] ? new Date(Number(timestamps[lastIndex]) * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour12: false }) : "",
            realtimeFallback: "yahoo-chart",
          });
          recoveredCodes.add(String(code));
          fallbackStats.yahoo.recovered += 1;
          break;
        } catch (error) {
          if (suffix === "TWO") {
            fallbackStats.yahoo.failed += 1;
            console.log(`realtime yahoo failed ${code} from ${parentLabel}: ${error.message}`);
          }
        }
      }
    }
    async function yahooWorker() {
      while (yahooCursor < targetCodes.length) {
        const code = targetCodes[yahooCursor++];
        if (replaceExisting || !quotes.has(String(code))) await fetchYahooCode(code);
      }
    }
    await Promise.all(Array.from({ length: Math.min(REALTIME_YAHOO_FALLBACK_CONCURRENCY, targetCodes.length) }, () => yahooWorker()));
  }

  async function fetchFinMindFallback(codes, parentLabel, options = {}) {
    const replaceExisting = options.replaceExisting === true;
    const enabled = ENABLE_FINMIND_REALTIME || (options.rescue === true && ENABLE_FINMIND_RESCUE);
    if (!enabled || !FINMIND_API_TOKEN) return;
    for (let i = 0; i < codes.length; i += 20) {
      const chunk = codes.slice(i, i + 20).filter((code) => replaceExisting || !quotes.has(code));
      if (!chunk.length) continue;
      fallbackStats.finmind.requested += chunk.length;
      try {
        const url = new URL("https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot");
        chunk.forEach((code) => url.searchParams.append("data_id", code));
        const response = await fetch(url.toString(), {
          headers: {
            "User-Agent": "FumanStrategy2Realtime/1.0",
            Authorization: `Bearer ${FINMIND_API_TOKEN}`,
          },
          signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
        });
        if (!response.ok) throw new Error(`finmind quote HTTP ${response.status}`);
        const payload = await response.json();
        const scanDate = compactDateKey(scanTimestamp, "").slice(0, 10);
        for (const item of payload?.data || []) {
          const code = String(item.stock_id || "");
          if (!/^\d{4}$/.test(code) || (!replaceExisting && quotes.has(code))) continue;
          const itemDate = compactDateKey(item.date || item.datetime || item.date_time, "");
          if (scanDate && itemDate && itemDate !== scanDate) continue;
          const close = cleanNumber(item.close);
          const change = cleanNumber(item.change_price);
          const percent = cleanNumber(item.change_rate);
          const prevClose = close && change ? close - change : close && percent ? close / (1 + percent / 100) : 0;
          if (!close || !prevClose) continue;
          quotes.set(code, {
            code,
            name: code,
            close,
            closeSource: "finmind",
            change: close - prevClose,
            percent: prevClose ? ((close - prevClose) / prevClose) * 100 : percent,
            open: cleanNumber(item.open),
            high: cleanNumber(item.high) || close,
            low: cleanNumber(item.low) || close,
            prevClose,
            tradeVolume: cleanNumber(item.total_volume),
            market: "",
            time: item.time || item.last_updated || item.date_time || scanTimestamp,
            realtimeFallback: "finmind",
          });
          recoveredCodes.add(code);
          fallbackStats.finmind.recovered += 1;
        }
      } catch (error) {
        fallbackStats.finmind.failed += chunk.length;
        console.log(`realtime finmind failed ${chunk[0]}-${chunk.at(-1)} from ${parentLabel}: ${error.message}`);
      }
    }
  }

  async function fetchSmallRetries(codes, parentLabel) {
    const stillFailed = [];
    const missingCodes = codes.filter((code) => !quotes.has(String(code)));
    for (let i = 0; i < missingCodes.length; i += REALTIME_RETRY_BATCH_SIZE) {
      const retryCodes = missingCodes.slice(i, i + REALTIME_RETRY_BATCH_SIZE);
      const label = `${retryCodes[0]}-${retryCodes.at(-1)}`;
      try {
        await fetchRealtimeBatch(retryCodes);
        retryCodes.forEach((code) => {
          if (quotes.has(code)) recoveredCodes.add(code);
        });
        retryBatches.push({ range: label, size: retryCodes.length, parent: parentLabel, ok: true });
      } catch (error) {
        console.log(`realtime retry batch failed ${label} (${retryCodes.length}) from ${parentLabel}: ${error.message}`);
        retryBatches.push({ range: label, size: retryCodes.length, parent: parentLabel, ok: false, error: error.message });
        stillFailed.push(...retryCodes);
      }
    }
    return stillFailed;
  }

  async function fetchSingleRetries(codes, parentLabel) {
    await fetchFugleFallback(codes, parentLabel);
    if (!REALTIME_FUGLE_ONLY) {
      await fetchFinMindFallback(codes, parentLabel);
      await fetchYahooFallback(codes, parentLabel);
    }
    for (const code of codes) {
      if (!quotes.has(code) && /^\d{4}$/.test(String(code)) && !String(code).startsWith("00")) missedCodes.add(code);
    }
  }

  if (REALTIME_FUGLE_ONLY) await fetchFugleFallback([...fallbackCandidateCodes], "fugle-only-initial", { replaceExisting: true });
  const requests = [];
  if (!REALTIME_FUGLE_ONLY) for (let i = 0; i < stocks.length; i += REALTIME_BATCH_SIZE) {
    const codes = stocks.slice(i, i + REALTIME_BATCH_SIZE).map((stock) => stock.code).filter((code) => !quotes.has(String(code)));
    if (!codes.length) continue;
    requests.push({ codes });
  }
  const results = new Array(requests.length);
  let cursor = 0;
  async function worker() {
    while (cursor < requests.length) {
      const index = cursor++;
      try {
        await fetchRealtimeBatch(requests[index].codes);
        results[index] = { status: "fulfilled" };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REALTIME_BATCH_CONCURRENCY, requests.length) }, () => worker()));
  const failed = results
    .map((result, index) => ({ result, codes: requests[index].codes }))
    .filter((item) => item.result.status === "rejected");
  failed.forEach((item) => {
    const error = item.result.reason?.message || String(item.result.reason || "");
    const label = `${item.codes[0]}-${item.codes.at(-1)}`;
    failedBatches.push({ range: label, size: item.codes.length, codes: item.codes, error });
    console.log(`realtime batch failed ${label} (${item.codes.length}): ${error}`);
  });
  for (const item of failed) {
    const label = `${item.codes[0]}-${item.codes.at(-1)}`;
    const stillFailed = await fetchSmallRetries(item.codes, label);
    await fetchSingleRetries(stillFailed, label);
  }
  const diagnosticsBeforeRescue = quoteDiagnostics();
  let diagnosticsAfterRescue = diagnosticsBeforeRescue;
  if (
    REALTIME_RESCUE_LIMIT > 0
    && stocks.length
    && diagnosticsBeforeRescue.usableCoverage < REALTIME_RESCUE_COVERAGE
  ) {
    const now = Date.now();
    const cooldownRemainingMs = Math.max(0, lastRealtimeCoverageRescueAt + REALTIME_RESCUE_COOLDOWN_MS - now);
    const unusableCodes = new Set([
      ...diagnosticsBeforeRescue.staleCodes,
      ...diagnosticsBeforeRescue.noTimeCodes,
      ...diagnosticsBeforeRescue.noCloseCodes,
      ...diagnosticsBeforeRescue.missingCodes,
    ]);
    const rescueCodes = [...fallbackCandidateCodes]
      .filter((code) => unusableCodes.has(String(code)))
      .slice(0, REALTIME_RESCUE_LIMIT);
    fallbackStats.rescue.coverageBefore = Number(diagnosticsBeforeRescue.usableCoverage.toFixed(4));
    fallbackStats.rescue.usableBefore = diagnosticsBeforeRescue.usableCount;
    fallbackStats.rescue.requested = rescueCodes.length;
    fallbackStats.rescue.skippedCooldown = cooldownRemainingMs > 0;
    fallbackStats.rescue.cooldownRemainingMs = cooldownRemainingMs;
    if (rescueCodes.length && cooldownRemainingMs <= 0) {
      lastRealtimeCoverageRescueAt = now;
      if (REALTIME_FUGLE_ONLY) {
        await fetchFugleFallback(rescueCodes, "low-usable-coverage", { replaceExisting: true, rescue: true });
        diagnosticsAfterRescue = quoteDiagnostics();
        fallbackStats.rescue.recovered = Math.max(0, diagnosticsAfterRescue.usableCount - diagnosticsBeforeRescue.usableCount);
      } else {
        await fetchYahooFallback(rescueCodes, "low-usable-coverage", { replaceExisting: true, rescue: true });
        diagnosticsAfterRescue = quoteDiagnostics();
        const remainingUnusable = new Set([...diagnosticsAfterRescue.staleCodes, ...diagnosticsAfterRescue.noTimeCodes, ...diagnosticsAfterRescue.noCloseCodes, ...diagnosticsAfterRescue.missingCodes]);
        const finmindRescueCodes = rescueCodes.filter((code) => remainingUnusable.has(String(code)));
        await fetchFinMindFallback(finmindRescueCodes, "low-usable-coverage", { replaceExisting: true, rescue: true });
        diagnosticsAfterRescue = quoteDiagnostics();
        fallbackStats.rescue.finmindRequested = finmindRescueCodes.length;
        fallbackStats.rescue.recovered = Math.max(0, diagnosticsAfterRescue.usableCount - diagnosticsBeforeRescue.usableCount);
      }
    }
    fallbackStats.rescue.coverageAfter = Number(diagnosticsAfterRescue.usableCoverage.toFixed(4));
    fallbackStats.rescue.usableAfter = diagnosticsAfterRescue.usableCount;
  }
  stocks.forEach((stock) => {
    const code = String(stock.code || "");
    if (!quotes.has(code) && /^\d{4}$/.test(code) && !code.startsWith("00")) missedCodes.add(code);
  });
  const finalDiagnostics = quoteDiagnostics();
  fetchRealtime.lastStats = {
    requested: stocks.length,
    received: quotes.size,
    usableBeforeRescue: diagnosticsBeforeRescue.usableCount,
    coverageBeforeRescue: Number(diagnosticsBeforeRescue.usableCoverage.toFixed(4)),
    usableAfterRescue: finalDiagnostics.usableCount,
    coverageAfterRescue: Number(finalDiagnostics.usableCoverage.toFixed(4)),
    unusableBreakdown: finalDiagnostics.breakdown,
    sourceHealth: finalDiagnostics.sourceHealth,
    failed: failed.length,
    failedBatches,
    retryBatches,
    batchConcurrency: REALTIME_BATCH_CONCURRENCY,
    fallbackCandidateLimit: REALTIME_FALLBACK_CANDIDATE_LIMIT,
    fallbackCandidateCount: fallbackCandidateCodes.size,
    yahooFallbackConcurrency: REALTIME_YAHOO_FALLBACK_CONCURRENCY,
    fugleRateLimited,
    fallbackStats,
    finmindRealtimeEnabled: ENABLE_FINMIND_REALTIME,
    finmindRescueEnabled: ENABLE_FINMIND_RESCUE,
    recoveredCodes: [...recoveredCodes],
    missedCodes: [...missedCodes],
    staleCodes: [...finalDiagnostics.staleCodes].slice(0, 80),
    noTimeCodes: [...finalDiagnostics.noTimeCodes].slice(0, 80),
    noCloseCodes: [...finalDiagnostics.noCloseCodes].slice(0, 80),
    missedCount: missedCodes.size,
  };
  console.log(
    `realtime fallback stats: supabaseFugle requested=${fallbackStats.supabasePublicSlot.requested} recovered=${fallbackStats.supabasePublicSlot.recovered} healthy=${fallbackStats.supabasePublicSlot.healthy} age=${fallbackStats.supabasePublicSlot.sourceAgeSeconds ?? "--"} failed=${fallbackStats.supabasePublicSlot.failed}; `
    + `fugle configured=${fallbackStats.fugle.configured} requested=${fallbackStats.fugle.requested} recovered=${fallbackStats.fugle.recovered} empty=${fallbackStats.fugle.empty} failed=${fallbackStats.fugle.failed} noKey=${fallbackStats.fugle.skippedNoKey} rateLimited=${fallbackStats.fugle.rateLimited}; `
    + `finmind enabled=${fallbackStats.finmind.enabled} rescue=${fallbackStats.finmind.rescueEnabled} configured=${fallbackStats.finmind.configured} requested=${fallbackStats.finmind.requested} recovered=${fallbackStats.finmind.recovered} failed=${fallbackStats.finmind.failed}; `
    + `yahoo requested=${fallbackStats.yahoo.requested} recovered=${fallbackStats.yahoo.recovered} failed=${fallbackStats.yahoo.failed}; `
    + `rescue usable=${diagnosticsBeforeRescue.usableCount}/${stocks.length}->${finalDiagnostics.usableCount}/${stocks.length} coverage=${Number(diagnosticsBeforeRescue.usableCoverage.toFixed(4))}->${Number(finalDiagnostics.usableCoverage.toFixed(4))} requested=${fallbackStats.rescue.requested || 0} recovered=${fallbackStats.rescue.recovered || 0}`
  );
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return { ...stock, isRealtime: false };
    const quoteVolume = normalizeRealtimeQuoteVolume(quote);
    const value = quoteVolume && cleanNumber(quote.close)
      ? quoteVolume * cleanNumber(quote.close)
      : stock.value;
    return {
      ...stock,
      ...quote,
      avg5dVolume: cleanNumber(quote.avg5dVolume) || cleanNumber(stock.avg5dVolume),
      avg5dVolumeDays: cleanNumber(quote.avg5dVolumeDays) || cleanNumber(stock.avg5dVolumeDays),
      prevClosePercent: cleanNumber(quote.percent) || cleanNumber(stock.prevClosePercent),
      limitUp: cleanNumber(quote.limitUp || quote.limitUpPrice) || cleanNumber(stock.limitUp),
      quoteTime: quote.time,
      tradeVolume: quoteVolume,
      value,
      isRealtime: true,
      recoveredFromRealtimeFallback: recoveredCodes.has(stock.code),
    };
  });
}

function taipeiMinuteFromUnix(seconds) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(seconds * 1000));
  const dict = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dict.year}-${dict.month}-${dict.day} ${dict.hour}:${dict.minute}`;
}

function minuteKey(value) {
  const match = String(value || "").match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function buildSma35Info(rows, targetMinute, source, extra = {}) {
  const sorted = rows
    .filter((row) => row.minute && cleanNumber(row.close) > 0)
    .sort((a, b) => a.minute.localeCompare(b.minute));
  const index = sorted.findLastIndex((row) => row.minute <= targetMinute);
  if (index < 19) return null;
  const ma20Window = sorted.slice(index - 19, index + 1).map((row) => cleanNumber(row.close));
  const ma20PreviousWindow = sorted.slice(index - 20, index).map((row) => cleanNumber(row.close));
  const window = index >= 34 ? sorted.slice(index - 34, index + 1).map((row) => cleanNumber(row.close)) : [];
  const previousWindow = index >= 35 ? sorted.slice(index - 35, index).map((row) => cleanNumber(row.close)) : [];
  const indicatorRows = sorted.slice(0, index + 1);
  const ma20 = avg(ma20Window);
  const ma20Prev = ma20PreviousWindow.length >= 20 ? avg(ma20PreviousWindow) : 0;
  const ma35 = avg(window);
  const ma35Prev = previousWindow.length >= 35 ? avg(previousWindow) : 0;
  if (ma20 <= 0 && ma35 <= 0) return null;
  const closes = indicatorRows.map((row) => row.close);
  const macd = macdInfo(closes);
  const kd = kdInfo(indicatorRows);
  const rsi = rsiInfo(closes);
  const npsy = npsyInfo(closes);
  return {
    ma20,
    ma20Prev,
    ma20TrendUp: ma20Prev > 0 && ma20 > ma20Prev,
    ma20Source: source,
    ma35,
    ma35Prev,
    ma35TrendUp: ma35Prev > 0 && ma35 > ma35Prev,
    ma35Source: source,
    ma35At: `${sorted[index].minute}:00`,
    latest1mAt: `${sorted[index].minute}:00`,
    latest1mOpen: cleanNumber(sorted[index].open),
    latest1mHigh: cleanNumber(sorted[index].high),
    latest1mLow: cleanNumber(sorted[index].low),
    latest1mClose: cleanNumber(sorted[index].close),
    latest1mPrevClose: index > 0 ? cleanNumber(sorted[index - 1].close) : 0,
    latest1mVolume: cleanNumber(sorted[index].volume),
    ...macd,
    ...kd,
    ...rsi,
    ...npsy,
    ...extra,
  };
}

function storeStrategy2MinuteCandles(cache, code, rows, key, source) {
  if (!cache.minuteCandles || typeof cache.minuteCandles !== "object" || cache.minuteCandlesDate !== key) {
    cache.minuteCandlesDate = key;
    cache.minuteCandles = {};
  }
  const bucket = Array.isArray(cache.minuteCandles[String(code)]) ? cache.minuteCandles[String(code)] : [];
  const byMinute = new Map(bucket.map((row) => [row.minute, row]));
  rows.forEach((row) => {
    if (!row.minute || !String(row.minute).startsWith(key) || cleanNumber(row.close) <= 0) return;
    byMinute.set(row.minute, { code: String(code), ...row, source, updatedAt: new Date().toISOString() });
  });
  cache.minuteCandles[String(code)] = [...byMinute.values()].sort((a, b) => String(a.minute).localeCompare(String(b.minute))).slice(-330);
}

async function upsertStrategy2MinuteCandlesToSupabase(cache, key) {
  return false;
}

function updateMinuteCloseCache(cache, stocks, scanTimestamp, key) {
  const minute = minuteKey(scanTimestamp);
  if (!minute) return;
  if (cache.minuteClosesDate !== key || !cache.minuteCloses || typeof cache.minuteCloses !== "object") {
    cache.minuteClosesDate = key;
    cache.minuteCloses = {};
  }
  for (const stock of stocks) {
    const code = String(stock.code || "");
    const close = cleanNumber(stock.close);
    if (!code || close <= 0) continue;
    const rows = Array.isArray(cache.minuteCloses[code]) ? cache.minuteCloses[code] : [];
    if (rows.at(-1)?.minute === minute) {
      rows[rows.length - 1] = { minute, close };
    } else {
      rows.push({ minute, close });
    }
    cache.minuteCloses[code] = rows.filter((row) => String(row.minute || "").startsWith(key)).slice(-90);
  }
}

function updateRealtimeQuoteCache(cache, stocks, key, scanTimestamp) {
  if (cache.quoteSnapshotsDate !== key || !cache.quoteSnapshots || typeof cache.quoteSnapshots !== "object") {
    cache.quoteSnapshotsDate = key;
    cache.quoteSnapshots = {};
  }
  const seenAt = new Date().toISOString();
  for (const stock of stocks) {
    const code = String(stock.code || "");
    const close = cleanNumber(stock.close);
    if (!code || close <= 0 || stock.isRealtime !== true) continue;
    if (!hasFreshQuote(stock, scanTimestamp)) continue;
    cache.quoteSnapshots[code] = {
      code,
      name: stock.name || code,
      close,
      change: cleanNumber(stock.change),
      percent: cleanNumber(stock.percent),
      open: cleanNumber(stock.open),
      high: cleanNumber(stock.high),
      low: cleanNumber(stock.low),
      prevClose: cleanNumber(stock.prevClose),
      limitUp: cleanNumber(stock.limitUp),
      limitDown: cleanNumber(stock.limitDown),
      tradeVolume: cleanNumber(stock.tradeVolume),
      value: cleanNumber(stock.value),
      market: stock.market || "",
      time: stock.quoteTime || stock.time || "",
      quoteTime: stock.quoteTime || stock.time || "",
      closeSource: stock.closeSource || "",
      quoteSeenAt: seenAt,
    };
  }
}

function mergeRealtimeQuoteCache(cache, stocks, key, scanTimestamp) {
  if (cache.quoteSnapshotsDate !== key || !cache.quoteSnapshots || typeof cache.quoteSnapshots !== "object") return stocks;
  return stocks.map((stock) => {
    if (stock.isRealtime === true && cleanNumber(stock.close) > 0) return stock;
    const snapshot = cache.quoteSnapshots[String(stock.code || "")];
    if (
      !snapshot
      || cleanNumber(snapshot.close) <= 0
      || secondsSinceIso(snapshot.quoteSeenAt) > QUOTE_CACHE_MAX_AGE_SECONDS
      || !hasFreshQuote(snapshot, scanTimestamp)
    ) return stock;
    return {
      ...stock,
      ...snapshot,
      quoteTime: snapshot.quoteTime || snapshot.time || "",
      isRealtime: true,
      recoveredFromQuoteCache: true,
    };
  });
}

function enforceStrategy2EntryGuards(report) {
  let downgradedRecords = 0;
  let downgradedEvents = 0;
  const sourceCoverage = cleanNumber(report?.realtime?.coverage);
  const sourceThreshold = cleanNumber(report?.realtime?.entrySourceCoverageThreshold) || MIN_ENTRY_SOURCE_COVERAGE;
  const sourceBlocksEntry = report?.realtime?.entrySourceHealthy === false && sourceCoverage > 0 && sourceCoverage < sourceThreshold;
  const technicalBlocksEntry = report?.realtime?.entrySourceHealthy === false && !sourceBlocksEntry;
  const records = (report.records || []).map((record) => {
    const recordSourceCoverage = cleanNumber(record?.sourceCoverage);
    const createdUnderUnhealthySource = recordSourceCoverage > 0 && recordSourceCoverage < sourceThreshold;
    const validEntryRecord = isStrictStrategy2Ma35Record(record) || isStrategy2ConditionEntryRecord(record);
    if ((record.stateId === "entry" || record.stateId === "go") && (!validEntryRecord || createdUnderUnhealthySource)) {
      downgradedRecords += 1;
      return {
        ...record,
        stateId: "wait",
        stateLabel: "待確認",
        stateReason: createdUnderUnhealthySource
          ? `${record.strategy || "盤中轉強"}，產生時市場來源可用率 ${recordSourceCoverage.toFixed(2)} 未達 ${sourceThreshold.toFixed(2)}，降級為待確認。`
          : `${record.strategy || "盤中轉強"}，未通過進場區硬條件，降級為待確認。`,
      };
    }
    return record;
  });
  const events = (report.events || []).map((event) => {
    const entryRecords = sourceBlocksEntry
      ? []
      : records.filter((record) => String(record.code || "") === String(event.code || "") && (isStrictStrategy2Ma35Record(record) || isStrategy2ConditionEntryRecord(record)));
    const entryRecord = entryRecords[0] || null;
    const latestEntryRecord = entryRecords.length
      ? entryRecords.reduce((latest, record) => (String(record.timestamp || record.entryAt || "") > String(latest.timestamp || latest.entryAt || "") ? record : latest), entryRecords[0])
      : null;
    const firstTradableEntryRecord = entryRecords.find((record) => timeValue(recordTimeLabel(record)) >= timeValue(MANAGER_MIN_ENTRY_TIME)) || null;
    const entryPrice = cleanNumber(entryRecord?.entryPrice) || cleanNumber(entryRecord?.observedPrice);
    const latestEntryPrice = cleanNumber(latestEntryRecord?.entryPrice) || cleanNumber(latestEntryRecord?.observedPrice) || entryPrice;
    const tradableEntryPrice = cleanNumber(firstTradableEntryRecord?.entryPrice) || cleanNumber(firstTradableEntryRecord?.observedPrice) || 0;
    const entryTime = entryRecord ? recordTimeLabel(entryRecord) : "";
    const latestEntryTime = latestEntryRecord ? recordTimeLabel(latestEntryRecord) : "";
    const tradableEntryTime = firstTradableEntryRecord ? recordTimeLabel(firstTradableEntryRecord) : "";
    const highAfterA = entryRecords.reduce((max, record) => Math.max(max, cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice) || cleanNumber(record.entryPrice)), 0);
    const highAfterARecord = entryRecords.reduce((best, record) => {
      const bestHigh = cleanNumber(best?.observedHigh) || cleanNumber(best?.observedPrice) || cleanNumber(best?.entryPrice);
      const high = cleanNumber(record.observedHigh) || cleanNumber(record.observedPrice) || cleanNumber(record.entryPrice);
      return high > bestHigh ? record : best;
    }, entryRecord);
    const entryRecordForFields = latestEntryRecord || entryRecord;
    const legacyEntryRecord = sourceBlocksEntry
      ? null
      : records.find((record) => String(record.code || "") === String(event.code || "") && (isStrictStrategy2Ma35Record(record) || isStrategy2ConditionEntryRecord(record)));
    if (!legacyEntryRecord) {
      if (event.firstAAt || event.latestAAt) downgradedEvents += 1;
      return {
        ...event,
        firstAAt: "",
        firstAPrice: 0,
        firstTradableAAt: "",
        firstTradableAPrice: 0,
        latestAAt: "",
        latestAPrice: 0,
        latestState: "wait",
        stateId: "wait",
        stateLabel: "待確認",
        stateReason: sourceBlocksEntry
          ? `市場來源可用率 ${sourceCoverage.toFixed(2)} 未達 ${sourceThreshold.toFixed(2)}，暫停進場區顯示。`
          : technicalBlocksEntry
          ? "1分K/技術確認未就緒，暫停升級進場區。"
          : event.stateReason && /^1分K站上MA35/.test(String(event.stateReason))
          ? "未通過進場區硬條件，降級為待確認。"
          : event.stateReason,
      };
    }
    return {
      ...event,
      firstAAt: entryTime,
      firstAPrice: entryPrice,
      firstTradableAAt: tradableEntryTime,
      firstTradableAPrice: tradableEntryPrice,
      latestAAt: latestEntryTime,
      latestAPrice: latestEntryPrice,
      highAfterA: highAfterA || cleanNumber(event.highAfterA),
      highAfterAAt: timeLabel(highAfterARecord?.observedHighAt || highAfterARecord?.timestamp) || event.highAfterAAt,
      latestState: "entry",
      stateId: "entry",
      stateLabel: "進場區",
      stateReason: entryRecordForFields.stateReason || event.stateReason,
      ma35: cleanNumber(entryRecordForFields.ma35),
      ma35Prev: cleanNumber(entryRecordForFields.ma35Prev),
      aboveMa35: entryRecordForFields.aboveMa35 === true,
      ma35TrendUp: entryRecordForFields.ma35TrendUp === true,
      ma35Source: entryRecordForFields.ma35Source || "",
      ma35At: entryRecordForFields.ma35At || "",
      ma35Symbol: entryRecordForFields.ma35Symbol || "",
      latestRecord: entryRecordForFields,
    };
  });
  const guarded = {
    ...report,
    records,
    events,
    entryCount: events.filter((event) => event.stateId === "entry" || event.stateId === "go").length,
    aCount: events.filter((event) => event.stateId === "entry" || event.stateId === "go").length,
    bOnlyCount: events.filter((event) => !(event.stateId === "entry" || event.stateId === "go") && event.firstBAt).length,
  };
  if (downgradedRecords || downgradedEvents) {
    console.warn(`strategy2 entry guard downgraded records=${downgradedRecords}, events=${downgradedEvents}`);
  }
  return guarded;
}

function fetchLocalIntradaySma35(cache, code, scanTimestamp) {
  const targetMinute = minuteKey(scanTimestamp);
  const rows = Array.isArray(cache?.minuteCloses?.[String(code)]) ? cache.minuteCloses[String(code)] : [];
  return buildSma35Info(rows, targetMinute, "local-1m", { ma35Symbol: String(code) });
}

async function fetchSupabaseFugleIntradaySma35(code, scanTimestamp, cache, options = {}) {
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  const result = await fetchSupabaseFugleIntraday1m(code, 240, {
    maxSourceAgeSeconds: SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS,
    allowWarmupSource: options.allowWarmupSource,
  });
  if (!result.ok) throw new Error(result.error || "supabase fugle 1m unavailable");
  const rows = (result.candles || [])
    .map((row) => ({
      minute: minuteKey(String(row.candleTime || row.time || "").replace("T", " ")),
      open: cleanNumber(row.open),
      high: cleanNumber(row.high),
      low: cleanNumber(row.low),
      close: cleanNumber(row.close),
      volume: cleanNumber(row.volume),
    }))
    .filter((row) => row.minute <= targetMinute && row.close > 0);
  storeStrategy2MinuteCandles(cache, code, rows.filter((row) => row.minute.startsWith(targetDate)), targetDate, "supabase-fugle");
  return buildSma35Info(rows, targetMinute, "supabase-fugle-1m", {
    ma35Symbol: String(code),
    sourceAgeSeconds: Number.isFinite(Number(result.sourceAgeSeconds)) ? Number(result.sourceAgeSeconds) : undefined,
  });
}

async function fetchFugleIntradaySma35(code, scanTimestamp, cache) {
  if (!FUGLE_API_KEY) return null;
  if (fugleMa35BlockedReason) return null;
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${code}?timeframe=1&sort=asc`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "FumanIntradaySma35/1.0",
        "X-API-KEY": FUGLE_API_KEY,
      },
    });
    if (!response.ok) throw new Error(`fugle HTTP ${response.status}`);
    const payload = await response.json();
    const rows = (payload.data || [])
      .map((row) => ({
        minute: minuteKey(String(row.date || "").replace("T", " ")),
        open: cleanNumber(row.open),
        high: cleanNumber(row.high),
        low: cleanNumber(row.low),
        close: cleanNumber(row.close),
        volume: cleanNumber(row.volume),
      }))
      .filter((row) => row.minute.startsWith(targetDate));
    storeStrategy2MinuteCandles(cache, code, rows, targetDate, "fugle");
    return buildSma35Info(rows, targetMinute, "fugle-1m", { ma35Symbol: String(payload.symbol || code) });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTwelveDataIntradaySma35(code, scanTimestamp) {
  if (!TWELVE_DATA_API_KEY) return null;
  if (twelveDataBlockedReason) return null;
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  const symbols = [
    { symbol: code, exchange: "TWSE", label: `${code}:TWSE` },
    { symbol: `${code}:TWSE`, label: `${code}:TWSE` },
    { symbol: `${code}:TPEX`, label: `${code}:TPEX` },
  ];
  for (const request of symbols) {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", request.symbol);
    if (request.exchange) url.searchParams.set("exchange", request.exchange);
    url.searchParams.set("interval", "1min");
    url.searchParams.set("outputsize", "90");
    url.searchParams.set("timezone", "Asia/Taipei");
    url.searchParams.set("apikey", TWELVE_DATA_API_KEY);
    try {
      const payload = await fetchJson(url.toString(), 20000);
      if (payload?.status === "error" || payload?.code) {
        const message = payload?.message || "twelve data error";
        if (/Pro or Venture plan|upgrade/i.test(message)) {
          twelveDataBlockedReason = "plan-blocked";
          console.log(`sma35 1m twelve disabled for this scan: ${message}`);
          return null;
        }
        throw new Error(message);
      }
      const rows = (payload.values || [])
        .map((row) => ({
          minute: minuteKey(String(row.datetime || "").replace("T", " ")),
          high: cleanNumber(row.high),
          low: cleanNumber(row.low),
          close: cleanNumber(row.close),
          volume: cleanNumber(row.volume),
        }))
        .filter((row) => row.minute.startsWith(targetDate) && row.close > 0);
      const info = buildSma35Info(rows, targetMinute, "twelve-1m", { ma35Symbol: request.label });
      if (cleanNumber(info?.ma35) > 0) return info;
    } catch (error) {
      console.log(`sma35 1m failed ${request.label}: ${error.message}`);
      noteMa35ProviderFailure("twelve", error.message);
      if (twelveDataBlockedReason) return null;
    }
  }
  return null;
}

async function fetchIntradaySma35WithFallback(code, scanTimestamp, cache, options = {}) {
  const attempts = [];
  try {
    const supabaseFugle = await fetchSupabaseFugleIntradaySma35(code, scanTimestamp, cache, options);
    attempts.push({ source: "supabase-fugle-1m", ok: Boolean(supabaseFugle) });
    if (supabaseFugle) return { ...supabaseFugle, ma35Attempts: attempts };
  } catch (error) {
    attempts.push({ source: "supabase-fugle-1m", ok: false, error: error.message });
  }
  return { ma35Attempts: attempts, supabaseOnly: true };
  if (fugleMa35BlockedReason) {
    attempts.push({ source: "fugle-1m", ok: false, configured: Boolean(FUGLE_API_KEY), skipped: true, error: fugleMa35BlockedReason });
  } else {
    try {
      const fugle = await fetchFugleIntradaySma35(code, scanTimestamp, cache);
      attempts.push({ source: "fugle-1m", ok: Boolean(fugle), configured: Boolean(FUGLE_API_KEY) });
      if (fugle) {
        fugleMa35Failures = 0;
        return { ...fugle, ma35Attempts: attempts };
      }
      if (FUGLE_API_KEY) noteMa35ProviderFailure("fugle", "empty");
    } catch (error) {
      attempts.push({ source: "fugle-1m", ok: false, configured: Boolean(FUGLE_API_KEY), error: error.message });
      noteMa35ProviderFailure("fugle", error.message);
    }
  }
  if (yahooMa35BlockedReason) {
    attempts.push({ source: "yahoo-1m", ok: false, skipped: true, error: yahooMa35BlockedReason });
  } else {
    try {
      const yahoo = await fetchYahooIntradaySma35(code, scanTimestamp);
      attempts.push({ source: "yahoo-1m", ok: Boolean(yahoo) });
      if (yahoo) {
        yahooMa35Failures = 0;
        return { ...yahoo, ma35Attempts: attempts };
      }
      noteMa35ProviderFailure("yahoo", "empty");
    } catch (error) {
      attempts.push({ source: "yahoo-1m", ok: false, error: error.message });
      noteMa35ProviderFailure("yahoo", error.message);
    }
  }
  const local = fetchLocalIntradaySma35(cache, code, scanTimestamp);
  attempts.push({ source: "local-1m", ok: Boolean(local) });
  if (local) return { ...local, ma35Attempts: attempts };
  try {
    const twelve = await fetchTwelveDataIntradaySma35(code, scanTimestamp);
    attempts.push({ source: "twelve-1m", ok: Boolean(twelve), configured: Boolean(TWELVE_DATA_API_KEY), skipped: Boolean(twelveDataBlockedReason), error: twelveDataBlockedReason || undefined });
    if (twelve) return { ...twelve, ma35Attempts: attempts };
  } catch (error) {
    attempts.push({ source: "twelve-1m", ok: false, configured: Boolean(TWELVE_DATA_API_KEY), error: error.message });
  }
  return { ma35Attempts: attempts };
}

async function fetchYahooIntradaySma35(code, scanTimestamp) {
  if (yahooMa35BlockedReason) return null;
  const targetMinute = minuteKey(scanTimestamp);
  const targetDate = targetMinute.slice(0, 10);
  if (!targetMinute || !targetDate) return null;
  for (const suffix of ["TW", "TWO"]) {
    const symbol = `${code}.${suffix}`;
    if (yahooMa35NotFoundSymbols.has(symbol)) continue;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
      const payload = await fetchJson(url, 20000);
      const result = payload?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const quote = result?.indicators?.quote?.[0] || {};
      const closes = quote.close || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const volumes = quote.volume || [];
      const rows = timestamps
        .map((timestamp, index) => ({
          minute: taipeiMinuteFromUnix(timestamp),
          high: cleanNumber(highs[index]),
          low: cleanNumber(lows[index]),
          close: cleanNumber(closes[index]),
          volume: cleanNumber(volumes[index]),
        }))
        .filter((row) => row.minute.startsWith(targetDate) && row.close > 0)
        .sort((a, b) => a.minute.localeCompare(b.minute));
      const info = buildSma35Info(rows, targetMinute, "yahoo-1m", { ma35Symbol: symbol });
      if (cleanNumber(info?.ma35) > 0) {
        return {
          ...info,
          ma35Symbol: symbol,
        };
      }
    } catch (error) {
      if (/HTTP 404/.test(error.message || "")) {
        yahooMa35NotFoundSymbols.add(symbol);
        console.log(`sma35 1m unavailable ${symbol}: HTTP 404; fallback providers will be used`);
      } else {
        console.log(`sma35 1m failed ${symbol}: ${error.message}`);
      }
    }
  }
  return null;
}

async function fetchMa35Map(stocks, scanTimestamp, cache) {
  const candidates = stocks
    .filter(isIntradayTradable)
    .map((stock) => stock.code);
  const map = new Map();
  const statusResult = await fetchIntraday1mStatus(candidates);
  const statusByCode = statusResult.ok ? statusResult.byCode : new Map();
  if (!statusResult.ok) console.log(`strategy2 1m status skipped: ${statusResult.error}`);
  const concurrency = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const code = candidates[cursor++];
      const status = statusByCode.get(String(code));
      const candleCount = cleanNumber(status?.today_candle_count ?? status?.candle_count ?? status?.rows_today);
      const continuousCandleCount = cleanNumber(status?.continuous_candle_count ?? status?.candle_count);
      const latestCandleAge = cleanNumber(status?.latest_candle_age_seconds);
      const readyGe35 = status?.ready_ma35_continuous === true || status?.ready_ge_35 === true || continuousCandleCount >= 35;
      const staleLatestCandle = latestCandleAge > STRATEGY2_1M_STATUS_MAX_AGE_SECONDS;
      if (status && (!readyGe35 || status.has_today_data === false || staleLatestCandle)) {
        map.set(String(code), {
          ma35Attempts: [{
            source: "v_fugle_intraday_1m_status",
            ok: false,
            skipped: true,
            error: `1m_not_ready ready_ma35_continuous=${status.ready_ma35_continuous ?? status.ready_ge_35} today_candle_count=${candleCount} continuous_candle_count=${continuousCandleCount} has_today_data=${status.has_today_data} latest_age=${status.latest_candle_age_seconds ?? ""}`,
          }],
        });
        continue;
      }
      const info = await fetchIntradaySma35WithFallback(code, scanTimestamp, cache);
      if (cleanNumber(info?.ma35) > 0) map.set(String(code), info);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return map;
}

async function warmStrategy2MinuteCandles(stocks, scanTimestamp, cache, key) {
  const candidates = stocks.filter(isIntradayTradable).map((stock) => String(stock.code || "")).filter(Boolean).sort();
  const cursor = Number(cache.minuteCandleWarmupCursor || 0) % Math.max(candidates.length, 1);
  const batch = [];
  for (let i = 0; i < Math.min(STRATEGY2_1M_WARMUP_LIMIT, candidates.length); i += 1) batch.push(candidates[(cursor + i) % candidates.length]);
  cache.minuteCandleWarmupCursor = candidates.length ? (cursor + batch.length) % candidates.length : 0;
  let warmed = 0;
  let index = 0;
  async function worker() {
    while (index < batch.length) {
      const code = batch[index++];
      const info = await fetchIntradaySma35WithFallback(code, scanTimestamp, cache, { allowWarmupSource: true });
      if (cleanNumber(info?.latest1mClose) > 0) warmed += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, batch.length) }, () => worker()));
  return warmed;
}

async function main() {
  const parts = scanTaipeiParts();
  const key = dateKey(parts);
  if (!isMarketTime(parts)) {
    console.log(`skip intraday scan outside market time: ${timestampKey(parts)}`);
    return;
  }
  const cache = readJson(SIGNAL_FILE, { date: key, records: [], previous: {} });
  const scorecardTracker = readJson(SCORECARD_TRACK_FILE, { date: key, trades: {} });
  const strategy5Tracker = readJson(STRATEGY5_TRACK_FILE, { date: key, trades: {} });
  if (cache.date !== key) {
    cache.date = key;
    cache.records = [];
    cache.previous = {};
  }
  cache.records = normalizeStrategy2Records(cache.records || []);

  const timestamp = timestampKey(parts);
  const entryWindow = isStrategy2EntryTime(parts);
  const sharedSourceHealth = await getStrategy2SourceHealth({
    maxQuoteAgeSeconds: SUPABASE_SOURCE_MAX_QUOTE_AGE_SECONDS,
    minQuotes: SUPABASE_SOURCE_MIN_QUOTES,
    minActiveSymbols: SUPABASE_SOURCE_MIN_ACTIVE_SYMBOLS,
    requireIntraday1m: entryWindow,
    verifyAnonReadAccess: true,
  }).catch((error) => ({
    ok: false,
    message: SUPABASE_SHARED_SOURCE_ERROR_MESSAGE,
    reason: error?.message || String(error),
    status: null,
    payload: {},
    sourceAgeSeconds: Infinity,
  }));
  const sharedSourceCanPublishUniverse = sharedSourceHealth.canPublishUniverse === true;
  const sharedSourceCanUpgradeTechnicalEntry = !entryWindow || sharedSourceHealth.canUpgradeTechnicalEntry === true;
  if (!sharedSourceCanPublishUniverse && !entryWindow) {
    console.log("strategy2 pre-entry warmup continuing with shared source warning: " + (sharedSourceHealth.reason || sharedSourceHealth.message || "unknown"));
  } else if (!sharedSourceCanPublishUniverse) {
    const retained = readRetainableStrategy2EntryReport(key);
    if (retained) {
      console.log(`strategy2 quote source unhealthy; retain last good A report age=${Math.round(retained.ageSeconds)}s reason=${sharedSourceHealth.reason || sharedSourceHealth.message || "unknown"}`);
      return;
    }
    const strategy2Report = buildStrategy2SharedSourceAbnormalReport(cache, key, timestamp, sharedSourceHealth);
    writeJson(SIGNAL_FILE, cache);
    if (!STRATEGY2_API_ONLY) writeJson(STRATEGY2_REPORT_FILE, strategy2Report);
    publishStaticDataJson("strategy2-intraday-latest.json", strategy2Report);
    const strategy2LiveLedgerReport = writeStrategy2HistorySnapshot(strategy2Report, key) || strategy2Report;
    await upsertStrategy2LatestToSupabase(strategy2LiveLedgerReport);
    console.log(`strategy2 quote source unhealthy: ${sharedSourceHealth.reason || sharedSourceHealth.message || "unknown"}`);
    return;
  }
  if (entryWindow && sharedSourceCanPublishUniverse && !sharedSourceCanUpgradeTechnicalEntry) {
    console.log(`strategy2 shared source degraded; quote universe will publish but A-zone technical upgrade is disabled: ${sharedSourceHealth.reason || sharedSourceHealth.message || sharedSourceHealth.degradationMode || "intraday_1m_not_ready"}`);
  }

  const rawStocks = await annotateDailyVolumeAverages(await fetchStocks(!entryWindow ? {
    allowWarmupSource: true,
    maxQuoteAgeSeconds: QUOTE_CACHE_MAX_AGE_SECONDS,
    minQuotes: 1,
  } : {}));
  const realtimeSourceStocks = filterFormalDaytradePool(rawStocks.filter(isIntradayTradable));
  if (!entryWindow) {
    const warmed = await warmStrategy2MinuteCandles(realtimeSourceStocks, timestamp, cache, key);
    cache.updatedAt = new Date().toISOString();
    writeJson(SIGNAL_FILE, cache);
    await upsertStrategy2MinuteCandlesToSupabase(cache, key);
    console.log(`strategy2 1m warmup ${key}: warmed ${warmed}, cursor ${cache.minuteCandleWarmupCursor || 0}`);
    return;
  }
  const realtimePayload = await fetchRealtime(realtimeSourceStocks, timestamp);
  const realtimeStats = fetchRealtime.lastStats || { requested: rawStocks.length, received: 0, failed: 0 };
  updateRealtimeQuoteCache(cache, realtimePayload, key, timestamp);
  const realtimeWithCache = mergeRealtimeQuoteCache(cache, realtimePayload, key, timestamp);
  const realtimeStocks = realtimeWithCache
    .filter((stock) => stock.isRealtime === true)
    .filter((stock) => hasUsableQuote(stock, timestamp))
    .filter(isIntradayTradable);
  const coverage = realtimeSourceStocks.length ? realtimeStocks.length / realtimeSourceStocks.length : 0;
  const quoteUsable = realtimeStocks.length;
  const fugleWsUsable = cleanNumber(realtimeStats?.fallbackStats?.fugleWs?.used);
  const fugleWsCoverage = realtimeSourceStocks.length ? cleanNumber(realtimeStats?.fallbackStats?.fugleWs?.used) / realtimeSourceStocks.length : 0;
  const entrySourceCoverage = Math.max(coverage, fugleWsCoverage);
  const entrySourceUsable = Math.max(quoteUsable, fugleWsUsable);
  const quoteEntrySourceHealthy = entrySourceCoverage >= MIN_ENTRY_SOURCE_COVERAGE;
  const technicalEntryHealthy = quoteEntrySourceHealthy && sharedSourceCanUpgradeTechnicalEntry;
  const entrySourceHealthy = technicalEntryHealthy;
  const cachedRecovered = realtimeStocks.filter((stock) => stock.recoveredFromQuoteCache).length;
  const realtimeSummaryBase = {
    ...realtimeStats,
    coverage: Number(entrySourceCoverage.toFixed(4)),
    quoteCoverage: Number(coverage.toFixed(4)),
    fugleWsCoverage: Number(fugleWsCoverage.toFixed(4)),
    usable: entrySourceUsable,
    quoteUsable,
    entrySourceUsable,
    cachedRecovered,
    quoteCacheMaxAgeSeconds: QUOTE_CACHE_MAX_AGE_SECONDS,
    entrySourceCoverageThreshold: MIN_ENTRY_SOURCE_COVERAGE,
    entrySourceHealthy,
    quoteEntrySourceHealthy,
    technicalEntryHealthy,
    intraday1mHealthy: sharedSourceHealth.intraday1mOk === true,
    canPublishUniverse: sharedSourceCanPublishUniverse,
    canUpgradeTechnicalEntry: sharedSourceCanUpgradeTechnicalEntry,
    healthGateMode: sharedSourceHealth.degradationMode || (sharedSourceCanUpgradeTechnicalEntry ? "ok" : "degraded_intraday_1m"),
    healthLayers: sharedSourceHealth.healthLayers || null,
    sharedSourceReason: sharedSourceHealth.reason || sharedSourceHealth.message || "",
    initialBatchSize: REALTIME_BATCH_SIZE,
    retryBatchSize: REALTIME_RETRY_BATCH_SIZE,
  };
  if (realtimeSourceStocks.length && entrySourceCoverage < MIN_REALTIME_COVERAGE) {
    cache.updatedAt = new Date().toISOString();
    cache.realtime = { ...realtimeSummaryBase, skippedPartialCoverage: true };
    const strategy2Events = mergeStrategy2Events(cache.records || [], key);
    const strategy2Report = enforceStrategy2EntryGuards({
      source: "strategy2-0900-1200-live-patrol",
      date: key,
      updatedAt: cache.updatedAt,
      realtime: cache.realtime,
      records: cache.records,
      events: strategy2Events,
      entryCount: strategy2Events.filter((event) => event.stateId === "entry" || event.stateId === "go").length,
      aCount: strategy2Events.filter((event) => event.stateId === "entry" || event.stateId === "go").length,
      bOnlyCount: 0,
    });
    cache.records = strategy2Report.records;
    writeJson(SIGNAL_FILE, cache);
    if (!STRATEGY2_API_ONLY) writeJson(STRATEGY2_REPORT_FILE, strategy2Report);
    publishStaticDataJson("strategy2-intraday-latest.json", strategy2Report);
    const strategy2LiveLedgerReport = writeStrategy2HistorySnapshot(strategy2Report, key) || strategy2Report;
    await upsertStrategy2MinuteCandlesToSupabase(cache, key);
  await upsertStrategy2LatestToSupabase(strategy2LiveLedgerReport);
    console.log(`intraday signals ${key}: skipped partial realtime coverage ${realtimeStocks.length}/${realtimeSourceStocks.length} (entry coverage ${entrySourceCoverage.toFixed(4)}, received ${realtimeStats.received}, failed ${realtimeStats.failed}, missed ${realtimeStats.missedCount || 0})`);
    return;
  }
  updateMinuteCloseCache(cache, realtimeStocks, timestamp, key);
  const ma35Map = await fetchMa35Map(realtimeStocks, timestamp, cache);
  const liveStocks = realtimeStocks.map((stock) => {
    const ma35Info = ma35Map.get(stock.code) || {};
    const merged = {
      ...stock,
      ma35: ma35Info.ma35 || 0,
      ma35Prev: ma35Info.ma35Prev || 0,
      ma35TrendUp: Boolean(ma35Info.ma35TrendUp),
      ma35Source: ma35Info.ma35Source || "",
      ma35Symbol: ma35Info.ma35Symbol || "",
      ma35At: ma35Info.ma35At || "",
      ma35Attempts: ma35Info.ma35Attempts || [],
      latest1mOpen: ma35Info.latest1mOpen || 0,
      latest1mHigh: ma35Info.latest1mHigh || 0,
      latest1mLow: ma35Info.latest1mLow || 0,
      latest1mClose: ma35Info.latest1mClose || 0,
      latest1mPrevClose: ma35Info.latest1mPrevClose || 0,
      latest1mVolume: ma35Info.latest1mVolume || 0,
      recent60High: ma35Info.recent60High || 0,
      previousTwoHigh: ma35Info.previousTwoHigh || 0,
      breakoutPreviousTwoHigh: Boolean(ma35Info.breakoutPreviousTwoHigh),
      nearRecent60High: Boolean(ma35Info.nearRecent60High),
      macdDif: ma35Info.macdDif || 0,
      macdDifPrev: ma35Info.macdDifPrev || 0,
      macdSignal: ma35Info.macdSignal || 0,
      macdSignalPrev: ma35Info.macdSignalPrev || 0,
      macdHist: ma35Info.macdHist || 0,
      macdHistPrev: ma35Info.macdHistPrev || 0,
      macdUp: Boolean(ma35Info.macdUp),
      macdDifUp: Boolean(ma35Info.macdDifUp),
      macdHistUp: Boolean(ma35Info.macdHistUp),
      kdK: ma35Info.kdK || 0,
      kdKPrev: ma35Info.kdKPrev || 0,
      kdD: ma35Info.kdD || 0,
      kdDPrev: ma35Info.kdDPrev || 0,
      kdJ: ma35Info.kdJ || 0,
      kdJPrev: ma35Info.kdJPrev || 0,
      kdUp: Boolean(ma35Info.kdUp),
      kdKUp: Boolean(ma35Info.kdKUp),
      kdDUp: Boolean(ma35Info.kdDUp),
      kdJUp: Boolean(ma35Info.kdJUp),
      rsi5: ma35Info.rsi5 || 0,
      rsi5Prev: ma35Info.rsi5Prev || 0,
      rsi10: ma35Info.rsi10 || 0,
      rsi10Prev: ma35Info.rsi10Prev || 0,
      rsiUp: Boolean(ma35Info.rsiUp),
      npsy: ma35Info.npsy || 0,
      npsyPrev: ma35Info.npsyPrev || 0,
      npsyUp: Boolean(ma35Info.npsyUp),
    };
    const amplitude = openAmplitudePercent(merged);
    return {
      ...merged,
      prevClosePercent: cleanNumber(stock.percent),
      amplitudePercent: amplitude,
      percent: amplitude,
    };
  });
  const ranks = buildRanks(liveStocks);
  const volumeTop100Codes = new Set(
    [...liveStocks]
      .sort((a, b) => cleanNumber(b.tradeVolume) - cleanNumber(a.tradeVolume))
      .slice(0, 100)
      .map((stock) => String(stock.code || ""))
      .filter(Boolean)
  );
  let added = 0;
  const preopenStrategyMap = buildPreopenStrategyMap(key);

  updateScorecardTradeTracks(scorecardTracker, strategy5Tracker, liveStocks, timestamp, key);

  for (const stock of liveStocks) {
    const previous = cache.previous[stock.code] || null;
    const deltaVolume = Math.max(0, cleanNumber(stock.tradeVolume) - cleanNumber(previous?.tradeVolume));
    const scanStock = { ...stock, deltaVolume };
    updateTrackedExtremes(cache, scanStock, timestamp, key);
    const previousRows = cache.records.filter((record) => record.date === key && record.code === scanStock.code);
    const hadTriggeredStrong = previousRows.some((record) => (
      isEntryState(record)
      || (record.strategyIds || []).some((id) => [
        "open_rush",
        "early_attack",
        "intraday_continuation",
        "rebound_turn",
        "confirmed_re_rise",
        "early_re_rise_entry",
        "creeping_re_rise",
        "deep_rebound",
        "opening_breakout",
      ].includes(id))
    ));
    const preopen = preopenStrategyMap.get(String(scanStock.code || ""));
    const signals = [detectOpenBurstEntrySignal(scanStock), detectReboundEntrySignal(scanStock)].filter(Boolean);
    cache.previous[stock.code] = {
      close: scanStock.close,
      high: scanStock.high,
      low: scanStock.low,
      quoteTime: scanStock.quoteTime || scanStock.time || "",
      tradeVolume: scanStock.tradeVolume,
      percent: scanStock.percent,
    };
    const standaloneMeta = buildStrategy2ConditionMeta(scanStock, { timestamp, preopen, hadTriggeredStrong });
    const hasStandaloneDuplicate = cache.records.some((record) => (
      record.code === scanStock.code
      && record.timestamp === timestamp
      && (record.strategyIds || []).some((id) => (standaloneMeta.strategyIds || []).includes(id))
    ));
    if (!signals.length && standaloneMeta.strategyTags.length && !hasStandaloneDuplicate) {
      cache.records.push({
        date: key,
        timestamp,
        entryAt: timestamp,
        code: scanStock.code,
        name: scanStock.name,
        strategy: standaloneMeta.primaryStrategy || "策略2觀察",
        stateId: technicalEntryHealthy ? "entry" : "wait",
        stateLabel: technicalEntryHealthy ? "進場區" : "待確認",
        stateReason: technicalEntryHealthy ? (standaloneMeta.strategyReasons[0] || "策略2七條件成立，列入 A 進場區。") : `${standaloneMeta.strategyReasons[0] || "策略2母池條件成立"}；quote 母池保留，但 1分K/技術確認未就緒，暫不升級 A 區。`,
        score: Math.min(96, Math.max(55, cleanNumber(preopen?.score) || Math.round(50 + Math.max(0, cleanNumber(scanStock.percent)) * 6))),
        entryPrice: scanStock.close,
        observedPrice: scanStock.close,
        quoteTime: scanStock.quoteTime || scanStock.time || "",
        quoteSource: scanStock.quoteSource || scanStock.realtimeFallback || scanStock.closeSource || "api/realtime",
        sourceCoverage: Number(entrySourceCoverage.toFixed(4)),
        sourceCoverageHealthy: technicalEntryHealthy,
        observedHigh: scanStock.close,
        observedHighAt: timestamp,
        observedLow: scanStock.close,
        observedLowAt: timestamp,
        dayHigh: scanStock.high || scanStock.close,
        dayHighAt: timestamp,
        dayLow: scanStock.low || scanStock.close,
        dayLowAt: timestamp,
        volume: scanStock.tradeVolume,
        value: scanStock.value,
        avg5dVolume: scanStock.avg5dVolume,
        cumulativeBidVolume: scanStock.cumulativeBidVolume,
        cumulativeAskVolume: scanStock.cumulativeAskVolume,
        percent: scanStock.percent,
        reason: standaloneMeta.strategyReasons.join("；"),
        signalId: standaloneMeta.strategyIds[0] || "strategy2_watch",
        deltaVolume,
        ma35: scanStock.ma35,
        ma35Prev: scanStock.ma35Prev,
        aboveMa35: strategy2TechFlags(scanStock).aboveMa35,
        ma35TrendUp: strategy2TechFlags(scanStock).ma35Rising,
        ma35Source: scanStock.ma35Source,
        ma35Symbol: scanStock.ma35Symbol,
        ma35At: scanStock.ma35At,
        macdDif: scanStock.macdDif,
        macdSignal: scanStock.macdSignal,
        macdHist: scanStock.macdHist,
        macdUp: scanStock.macdUp,
        kdK: scanStock.kdK,
        kdD: scanStock.kdD,
        kdUp: scanStock.kdUp,
        rsi5: scanStock.rsi5,
        rsi5Prev: scanStock.rsi5Prev,
        rsi10: scanStock.rsi10,
        rsi10Prev: scanStock.rsi10Prev,
        rsiUp: scanStock.rsiUp,
        npsy: scanStock.npsy,
        npsyPrev: scanStock.npsyPrev,
        npsyUp: scanStock.npsyUp,
        intradayVolumeBurst: deltaVolume >= 50 || cleanNumber(scanStock.tradeVolume) >= 10000,
        recoveredFromRealtimeFallback: Boolean(scanStock.recoveredFromRealtimeFallback),
        ...standaloneMeta,
      });
      broadcastStrategy2CandidateHit(cache.records[cache.records.length - 1]).catch(() => {});
      added += 1;
    }
    const motherPoolMeta = buildStrategy2MotherPoolMeta(scanStock, { volumeTop100Codes });
    const hasMotherPoolDuplicate = cache.records.some((record) => (
      record.code === scanStock.code
      && record.timestamp === timestamp
      && (record.strategyIds || []).includes("strategy2_mother_pool")
    ));
    if (motherPoolMeta.ok && !hasMotherPoolDuplicate) {
      cache.records.push({
        date: key,
        timestamp,
        entryAt: timestamp,
        code: scanStock.code,
        name: scanStock.name,
        strategy: motherPoolMeta.primaryStrategy,
        stateId: "watch",
        stateLabel: "待確認",
        stateReason: motherPoolMeta.strategyReasons[0] || "符合策略2母池，等待 1分K/MA35/MACD/KD 進一步確認。",
        score: Math.min(88, Math.max(50, Math.round(48 + Math.max(0, cleanNumber(scanStock.percent)) * 4))),
        entryPrice: scanStock.close,
        observedPrice: scanStock.close,
        quoteTime: scanStock.quoteTime || scanStock.time || "",
        quoteSource: scanStock.quoteSource || scanStock.realtimeFallback || scanStock.closeSource || "api/realtime",
        sourceCoverage: Number(entrySourceCoverage.toFixed(4)),
        sourceCoverageHealthy: technicalEntryHealthy,
        observedHigh: scanStock.close,
        observedHighAt: timestamp,
        observedLow: scanStock.close,
        observedLowAt: timestamp,
        dayHigh: scanStock.high || scanStock.close,
        dayHighAt: timestamp,
        dayLow: scanStock.low || scanStock.close,
        dayLowAt: timestamp,
        volume: scanStock.tradeVolume,
        value: scanStock.value,
        avg5dVolume: scanStock.avg5dVolume,
        cumulativeBidVolume: scanStock.cumulativeBidVolume,
        cumulativeAskVolume: scanStock.cumulativeAskVolume,
        percent: scanStock.percent,
        reason: motherPoolMeta.strategyReasons.join("；"),
        signalId: "strategy2_mother_pool",
        deltaVolume,
        ma35: scanStock.ma35,
        ma35Prev: scanStock.ma35Prev,
        aboveMa35: strategy2TechFlags(scanStock).aboveMa35,
        ma35TrendUp: strategy2TechFlags(scanStock).ma35Rising,
        ma35Source: scanStock.ma35Source,
        ma35Symbol: scanStock.ma35Symbol,
        ma35At: scanStock.ma35At,
        macdDif: scanStock.macdDif,
        macdSignal: scanStock.macdSignal,
        macdHist: scanStock.macdHist,
        macdUp: scanStock.macdUp,
        kdK: scanStock.kdK,
        kdD: scanStock.kdD,
        kdUp: scanStock.kdUp,
        rsi5: scanStock.rsi5,
        rsi5Prev: scanStock.rsi5Prev,
        rsi10: scanStock.rsi10,
        rsi10Prev: scanStock.rsi10Prev,
        rsiUp: scanStock.rsiUp,
        npsy: scanStock.npsy,
        npsyPrev: scanStock.npsyPrev,
        npsyUp: scanStock.npsyUp,
        intradayVolumeBurst: deltaVolume >= 50 || cleanNumber(scanStock.tradeVolume) >= 10000,
        recoveredFromRealtimeFallback: Boolean(scanStock.recoveredFromRealtimeFallback),
        ...motherPoolMeta,
      });
      added += 1;
    }
    signals.forEach((signal) => {
      const state = classifyStrategy2State(scanStock, signal, { entrySourceHealthy: technicalEntryHealthy, sourceCoverage: entrySourceCoverage });
      if (!state) return;
      const strategyMeta = buildStrategy2ConditionMeta(scanStock, {
        timestamp,
        preopen,
        hadTriggeredStrong,
        signalId: signal.id,
        stateId: state.stateId,
        strictEntry: isEntryState(state),
      });
      const duplicate = cache.records.some((record) => (
        record.code === scanStock.code &&
        record.strategy === signal.label &&
        record.timestamp === timestamp
      ));
      if (duplicate) return;
      cache.records.push({
        date: key,
        timestamp,
        entryAt: timestamp,
        code: scanStock.code,
        name: scanStock.name,
        strategy: signal.label,
        stateId: state.stateId,
        stateLabel: state.stateLabel,
        stateReason: state.stateReason,
        score: state.score,
        entryPrice: signal.entryPrice,
        supportPrice: signal.supportPrice,
        entryLow: signal.entryLow,
        entryHigh: signal.entryHigh,
        stopLoss: signal.stopLoss,
        chaseLimit: signal.chaseLimit,
        observedPrice: scanStock.close,
        quoteTime: scanStock.quoteTime || scanStock.time || "",
        quoteSource: scanStock.quoteSource || scanStock.realtimeFallback || scanStock.closeSource || "api/realtime",
        sourceCoverage: Number(entrySourceCoverage.toFixed(4)),
        sourceCoverageHealthy: technicalEntryHealthy,
        observedHigh: scanStock.close,
        observedHighAt: timestamp,
        observedLow: scanStock.close,
        observedLowAt: timestamp,
        dayHigh: scanStock.high || scanStock.close,
        dayHighAt: timestamp,
        dayLow: scanStock.low || scanStock.close,
        dayLowAt: timestamp,
        volume: scanStock.tradeVolume,
        value: scanStock.value,
        avg5dVolume: scanStock.avg5dVolume,
        cumulativeBidVolume: scanStock.cumulativeBidVolume,
        cumulativeAskVolume: scanStock.cumulativeAskVolume,
        percent: scanStock.percent,
        reason: signal.reason,
        signalId: signal.id,
        deltaVolume: signal.deltaVolume,
        volumeMilestone: signal.volumeMilestone,
        ma35: signal.ma35,
        ma35Prev: signal.ma35Prev,
        aboveMa35: signal.aboveMa35,
        ma35TrendUp: signal.ma35TrendUp,
        ma35Source: signal.ma35Source,
        ma35Symbol: signal.ma35Symbol,
        ma35At: signal.ma35At,
        ma35Attempts: signal.ma35Attempts,
        macdDif: signal.macdDif,
        macdSignal: signal.macdSignal,
        macdHist: signal.macdHist,
        macdUp: signal.macdUp,
        kdK: signal.kdK,
        kdD: signal.kdD,
        kdUp: signal.kdUp,
        rsi5: signal.rsi5,
        rsi5Prev: signal.rsi5Prev,
        rsi10: signal.rsi10,
        rsi10Prev: signal.rsi10Prev,
        rsiUp: signal.rsiUp,
        npsy: scanStock.npsy,
        npsyPrev: scanStock.npsyPrev,
        npsyUp: scanStock.npsyUp,
        intradayVolumeBurst: signal.intradayVolumeBurst,
        recoveredFromRealtimeFallback: Boolean(scanStock.recoveredFromRealtimeFallback),
        ...strategyMeta,
      });
      broadcastStrategy2CandidateHit(cache.records[cache.records.length - 1]).catch(() => {});
      added += 1;
    });
    const snapshotMeta = buildStrategy2ConditionMeta(scanStock, { timestamp, preopen, hadTriggeredStrong });
    if (appendTrackedSnapshot(cache, scanStock, timestamp, key, { entrySourceHealthy: technicalEntryHealthy, sourceCoverage: entrySourceCoverage, strategyMeta: snapshotMeta })) {
      added += 1;
    }
  }

  cache.records = normalizeStrategy2Records(cache.records || []);
  cache.updatedAt = new Date().toISOString();
  const strategy2Events = mergeStrategy2Events(cache.records || [], key);
  const realtimeSummary = {
    ...realtimeSummaryBase,
    tradable: Math.max(liveStocks.length, realtimeSummaryBase.entrySourceUsable || 0),
    tradableByQuote: liveStocks.length,
  };
  const strategy2Report = enforceStrategy2EntryGuards({
    source: "strategy2-0900-1200-live-patrol",
    date: key,
    updatedAt: cache.updatedAt,
    realtime: realtimeSummary,
    records: cache.records,
    events: strategy2Events,
    entryCount: strategy2Events.filter((event) => event.firstAAt).length,
    aCount: strategy2Events.filter((event) => event.firstAAt).length,
    bOnlyCount: 0,
  });
  cache.records = strategy2Report.records;
  writeJson(SIGNAL_FILE, cache);
  if (!STRATEGY2_API_ONLY) writeJson(STRATEGY2_REPORT_FILE, strategy2Report);
  publishStaticDataJson("strategy2-intraday-latest.json", strategy2Report);
  const strategy2LiveLedgerReport = writeStrategy2HistorySnapshot(strategy2Report, key) || strategy2Report;
  await upsertStrategy2LatestToSupabase(strategy2LiveLedgerReport);
  const rotationMessages = rotateStrategy2IntradayCache({ currentDateKey: key });
  rotationMessages.forEach((message) => console.log(`strategy2 cache rotation: ${message}`));
  writeJson(SCORECARD_TRACK_FILE, scorecardTracker);
  writeJson(STRATEGY5_TRACK_FILE, strategy5Tracker);
  console.log(`intraday signals ${key}: added ${added}, total ${cache.records.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


