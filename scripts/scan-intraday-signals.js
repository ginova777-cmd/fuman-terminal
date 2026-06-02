const fs = require("fs");
const path = require("path");
const { buildRanks, cleanNumber, detectSignals, isIntradayTradable, ma35SourceLabel } = require("./intraday-radar-rules");
const { rotateStrategy2IntradayCache } = require("./strategy2-cache-rotation");

const { ROOT, dataPath, cachePath, repoPath } = require("./runtime-paths");
const CACHE_DIR = cachePath("intraday");
const SIGNAL_FILE = path.join(CACHE_DIR, "signals.json");
const SCORECARD_TRACK_FILE = path.join(CACHE_DIR, "scorecard-trades.json");
const STRATEGY5_TRACK_FILE = path.join(CACHE_DIR, "strategy5-scorecard-trades.json");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const STRATEGY2_SCORECARD_SOURCE_FILE = dataPath("strategy2-scorecard-source.json");
const STRATEGY2_HISTORY_DIR = dataPath("strategy2-intraday-history");
const STRATEGY2_HISTORY_WRITE_INTERVAL_MS = Math.max(0, Number(process.env.STRATEGY2_HISTORY_WRITE_INTERVAL_MS || 5 * 60 * 1000));
const OPEN_BUY_SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");
const OPEN_BUY_FILE = dataPath("open-buy-latest.json");
const OPEN_BUY_BACKUP_FILE = dataPath("open-buy-backup.json");
const STRATEGY3_SCORECARD_SOURCE_FILE = dataPath("strategy3-scorecard-source.json");
const STRATEGY3_FILE = dataPath("strategy3-latest.json");
const STRATEGY3_BACKUP_FILE = dataPath("strategy3-backup.json");
const STRATEGY5_FILE = dataPath("strategy5-latest.json");
const STRATEGY5_BACKUP_FILE = dataPath("strategy5-backup.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const MANAGER_MIN_ENTRY_TIME = process.env.TRADE_MANAGER_MIN_ENTRY_TIME || "09:05:00";
const MAX_QUOTE_AGE_SECONDS = Number(process.env.STRATEGY2_MAX_QUOTE_AGE_SECONDS || 150);
const QUOTE_CACHE_MAX_AGE_SECONDS = Number(process.env.STRATEGY2_QUOTE_CACHE_MAX_AGE_SECONDS || 15 * 60);
const MIN_REALTIME_COVERAGE = Number(process.env.STRATEGY2_MIN_REALTIME_COVERAGE || 0.5);
const REALTIME_BATCH_SIZE = Number(process.env.STRATEGY2_REALTIME_BATCH_SIZE || 8);
const REALTIME_RETRY_BATCH_SIZE = Number(process.env.STRATEGY2_REALTIME_RETRY_BATCH_SIZE || 4);
const REALTIME_BATCH_CONCURRENCY = Math.max(1, Number(process.env.STRATEGY2_REALTIME_BATCH_CONCURRENCY || 4));
const REALTIME_FALLBACK_CANDIDATE_LIMIT = Math.max(0, Number(process.env.STRATEGY2_REALTIME_FALLBACK_CANDIDATE_LIMIT || 180));
const REALTIME_YAHOO_FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.STRATEGY2_REALTIME_YAHOO_FALLBACK_CONCURRENCY || 6));
const ENABLE_FINMIND_REALTIME = process.env.STRATEGY2_ENABLE_FINMIND_REALTIME === "1";
const MA35_PROVIDER_FAILURE_LIMIT = Math.max(1, Number(process.env.STRATEGY2_MA35_PROVIDER_FAILURE_LIMIT || 8));

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const FUGLE_API_KEY = process.env.FUGLE_API_KEY
  || process.env.FUGLE_MARKETDATA_API_KEY
  || readSecretText(path.join(ROOT, "secrets", "fugle-api-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "fugle-api-key.txt"));
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY
  || process.env.TWELVEDATA_API_KEY
  || readSecretText(path.join(ROOT, "secrets", "twelve-data-api-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "twelve-data-api-key.txt"));
const FINMIND_API_TOKEN = process.env.FINMIND_API_TOKEN
  || process.env.FINMIND_TOKEN
  || readSecretText(path.join(ROOT, "secrets", "finmind-api-token.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "finmind-api-token.txt"));
const SUPABASE_URL = process.env.SUPABASE_URL
  || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-url.txt"));
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-service-role-key.txt"));
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
  const hist = dif[last] - dea[last];
  const prevHist = dif[prev] - dea[prev];
  return {
    macdDif: dif[last],
    macdSignal: dea[last],
    macdHist: hist,
    macdDifPrev: dif[prev],
    macdSignalPrev: dea[prev],
    macdHistPrev: prevHist,
    macdUp: dif[last] > dif[prev] && dea[last] >= dea[prev] && hist >= prevHist,
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
  return {
    kdK: k,
    kdD: d,
    kdKPrev: prevK,
    kdDPrev: prevD,
    kdUp: k > prevK && d >= prevD && k >= d,
  };
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
    "volume",
    "tradeVolume",
    "deltaVolume",
    "score",
    "strategy",
    "reason",
    "stateReason",
    "supportPrice",
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
    source: report.source || "strategy2-09-to-1330-patrol",
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
  const events = (slim.events || [])
    .sort((a, b) => (Number(b.maxScore) || 0) - (Number(a.maxScore) || 0) || String(b.latestSeenAt || b.latestAAt || "").localeCompare(String(a.latestSeenAt || a.latestAAt || "")))
    .slice(0, eventLimit);
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
function shouldWriteStrategy2History(file) {
  if (STRATEGY2_HISTORY_WRITE_INTERVAL_MS <= 0) return true;
  try {
    const stat = fs.statSync(file);
    return Date.now() - stat.mtimeMs >= STRATEGY2_HISTORY_WRITE_INTERVAL_MS;
  } catch {
    return true;
  }
}

function writeStaticDataTargets(name, payload, options = {}) {
  const targets = [];
  if (!options.skipRuntime) targets.push(dataPath(name));
  targets.push(repoPath("data", name));
  const syncRoot = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal-sync";
  if (fs.existsSync(syncRoot)) targets.push(path.join(syncRoot, "data", name));
  [...new Set(targets.map((file) => path.resolve(file)))].forEach((file) => {
    writeJson(file, payload);
  });
}

function publishStaticDataJson(name, value) {
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

async function upsertStrategy2LatestToSupabase(report) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const payload = report;
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
  const body = {
    id: "latest",
    date: payload.date || "",
    updated_at: payload.updatedAt || new Date().toISOString(),
    payload,
    entry_count: Number(payload.entryCount || 0),
    record_count: Array.isArray(payload.records) ? payload.records.length : 0,
    event_count: Array.isArray(payload.events) ? payload.events.length : 0,
  };
  try {
    const response = await fetch(`${baseUrl}/rest/v1/strategy2_latest?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(`strategy2 supabase upsert failed: HTTP ${response.status} ${text.slice(0, 160)}`);
      return false;
    }
    console.log(`strategy2 supabase upsert ok: records ${body.record_count}, events ${body.event_count}`);
    return true;
  } catch (error) {
    console.warn(`strategy2 supabase upsert failed: ${error?.message || error}`);
    return false;
  }
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
  return new Set(["fugle-1m", "yahoo-1m", "local-1m", "twelve-1m"]).has(String(source || ""));
}

function classifyStrategy2State(stock, signal) {
  const pct = cleanNumber(stock.percent);
  const volume = cleanNumber(stock.tradeVolume);
  const close = cleanNumber(stock.close);
  const high = cleanNumber(stock.high) || close;
  const open = cleanNumber(stock.open);
  const hasIntradaySma35 = isTrustedStrategy2Ma35Source(signal.ma35Source) && cleanNumber(signal.ma35) > 0;
  const strictMa35Entry = signal.id === "ma35_buy"
    && signal.aboveMa35 === true
    && hasIntradaySma35
    && signal.macdUp === true
    && signal.kdUp === true
    && signal.intradayVolumeBurst === true;
  const earlyEntrySignal = new Set(["volume_burst", "limit_lock", "gap", "breakout", "diamond"]).has(String(signal.id || ""));
  const nearHigh = high > 0 && close > 0 ? close >= high * 0.985 : true;
  const aboveOpen = !open || close >= open;
  const fallbackWatch = earlyEntrySignal
    && pct >= 2
    && pct <= 8.8
    && volume >= 2000
    && nearHigh
    && aboveOpen;
  if (!strictMa35Entry && !fallbackWatch) return null;
  const score = Math.min(100, Math.round(pct * 8 + (volume >= 10000 ? 56 : 42) + (earlyEntrySignal ? 6 : 0)));
  if (!strictMa35Entry) {
    return {
      stateId: "wait",
      stateLabel: "待確認",
      stateReason: `${signal.label || "盤中轉強"}，量價轉強但尚未通過1分K站上MA35完整進場條件。`,
      score,
    };
  }
  return {
    stateId: "entry",
    stateLabel: "進場區",
    stateReason: `1分K站上MA35，MACD/KD同步向上且爆量，偏進場區。MA35來源：${ma35SourceLabel(signal.ma35Source)}。`,
    score,
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

function secondsSinceIso(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return Infinity;
  return Math.max(0, (Date.now() - timestamp) / 1000);
}

function hasUsableQuote(stock, scanTimestamp) {
  if (stock?.recoveredFromQuoteCache) {
    return cleanNumber(stock.close) > 0 && secondsSinceIso(stock.quoteSeenAt) <= QUOTE_CACHE_MAX_AGE_SECONDS;
  }
  return hasFreshQuote(stock, scanTimestamp);
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 45;
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

function appendTrackedSnapshot(cache, stock, timestamp, key) {
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

  cache.records.push({
    ...latest,
    timestamp,
    entryAt: timestamp,
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

function isStrictStrategy2Ma35Record(record) {
  const ma35 = cleanNumber(record?.ma35);
  const hasIntradaySma35 = isTrustedStrategy2Ma35Source(record?.ma35Source) && ma35 > 0;
  return String(record?.signalId || record?.signal?.id || "") === "ma35_buy"
    && record?.aboveMa35 === true
    && hasIntradaySma35
    && record?.macdUp === true
    && record?.kdUp === true
    && record?.intradayVolumeBurst === true;
}

function isStrategy2RecordWithinBaseGate(record) {
  if (isStrictStrategy2Ma35Record(record)) return true;
  const pct = cleanNumber(record?.percent);
  const volume = cleanNumber(record?.volume) || cleanNumber(record?.tradeVolume);
  return pct >= 2 && volume >= 2000;
}

function normalizeStrategy2Records(records) {
  let dropped = 0;
  const normalized = (records || []).map((record) => {
    if (record.stateId && record.stateLabel) {
      if ((record.stateId === "entry" || record.stateId === "go") && !isStrictStrategy2Ma35Record(record)) {
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
        tradeVolume: normalizeVolumeLots(stock.volume ?? stock.tradeVolume),
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
      tradeVolume: normalizeVolumeLots(stock.TradeVolume || stock["成交股數"]),
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
}

async function fetchRealtime(stocks) {
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
    fugle: { configured: Boolean(FUGLE_API_KEY), requested: 0, recovered: 0, empty: 0, failed: 0, skippedNoKey: 0, rateLimited: false },
    finmind: { configured: Boolean(FINMIND_API_TOKEN), enabled: ENABLE_FINMIND_REALTIME, requested: 0, recovered: 0, failed: 0 },
    yahoo: { requested: 0, recovered: 0, failed: 0 },
  };

  async function fetchRealtimeBatch(codes) {
    if (!codes.length) return;
    const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 12000);
    (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
    if (codes.length > 1 && (payload.quotes || []).length === 0) throw new Error("api/realtime returned no quotes");
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
      time: payload.lastUpdated || payload.lastTradeTime || payload.time || "",
      realtimeFallback: "fugle",
    };
  }

  async function fetchFugleFallback(codes, parentLabel) {
    const targetCodes = codes.filter((code) => fallbackCandidateCodes.has(String(code)));
    fallbackStats.fugle.requested += targetCodes.length;
    if (!FUGLE_API_KEY) {
      fallbackStats.fugle.skippedNoKey += targetCodes.length;
      return;
    }
    for (const code of targetCodes) {
      if (fugleRateLimited) break;
      if (quotes.has(code)) continue;
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

  async function fetchYahooFallback(codes, parentLabel) {
    const targetCodes = codes.filter((code) => fallbackCandidateCodes.has(String(code)) && !quotes.has(String(code)));
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
        if (!quotes.has(String(code))) await fetchYahooCode(code);
      }
    }
    await Promise.all(Array.from({ length: Math.min(REALTIME_YAHOO_FALLBACK_CONCURRENCY, targetCodes.length) }, () => yahooWorker()));
  }

  async function fetchFinMindFallback(codes, parentLabel) {
    if (!ENABLE_FINMIND_REALTIME || !FINMIND_API_TOKEN) return;
    for (let i = 0; i < codes.length; i += 20) {
      const chunk = codes.slice(i, i + 20).filter((code) => !quotes.has(code));
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
        for (const item of payload?.data || []) {
          const code = String(item.stock_id || "");
          if (!/^\d{4}$/.test(code) || quotes.has(code)) continue;
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
            time: item.date || "",
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
    for (let i = 0; i < codes.length; i += REALTIME_RETRY_BATCH_SIZE) {
      const retryCodes = codes.slice(i, i + REALTIME_RETRY_BATCH_SIZE);
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
    await fetchFinMindFallback(codes, parentLabel);
    await fetchYahooFallback(codes, parentLabel);
    for (const code of codes) {
      if (!quotes.has(code) && /^\d{4}$/.test(String(code)) && !String(code).startsWith("00")) missedCodes.add(code);
    }
  }

  const requests = [];
  for (let i = 0; i < stocks.length; i += REALTIME_BATCH_SIZE) {
    const codes = stocks.slice(i, i + REALTIME_BATCH_SIZE).map((stock) => stock.code);
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
  stocks.forEach((stock) => {
    const code = String(stock.code || "");
    if (!quotes.has(code) && /^\d{4}$/.test(code) && !code.startsWith("00")) missedCodes.add(code);
  });
  fetchRealtime.lastStats = {
    requested: stocks.length,
    received: quotes.size,
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
    recoveredCodes: [...recoveredCodes],
    missedCodes: [...missedCodes],
    missedCount: missedCodes.size,
  };
  console.log(
    `realtime fallback stats: fugle configured=${fallbackStats.fugle.configured} requested=${fallbackStats.fugle.requested} recovered=${fallbackStats.fugle.recovered} empty=${fallbackStats.fugle.empty} failed=${fallbackStats.fugle.failed} noKey=${fallbackStats.fugle.skippedNoKey} rateLimited=${fallbackStats.fugle.rateLimited}; `
    + `finmind enabled=${fallbackStats.finmind.enabled} configured=${fallbackStats.finmind.configured} requested=${fallbackStats.finmind.requested} recovered=${fallbackStats.finmind.recovered} failed=${fallbackStats.finmind.failed}; `
    + `yahoo requested=${fallbackStats.yahoo.requested} recovered=${fallbackStats.yahoo.recovered} failed=${fallbackStats.yahoo.failed}`
  );
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return { ...stock, isRealtime: false };
    const quoteVolume = normalizeRealtimeQuoteVolume(quote);
    const value = quoteVolume && cleanNumber(quote.close)
      ? quoteVolume * cleanNumber(quote.close)
      : stock.value;
    return { ...stock, ...quote, quoteTime: quote.time, tradeVolume: quoteVolume, value, isRealtime: true, recoveredFromRealtimeFallback: recoveredCodes.has(stock.code) };
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
  if (index < 34) return null;
  const window = sorted.slice(index - 34, index + 1).map((row) => cleanNumber(row.close));
  const previousWindow = sorted.slice(index - 35, index).map((row) => cleanNumber(row.close));
  const indicatorRows = sorted.slice(0, index + 1);
  const ma35 = avg(window);
  const ma35Prev = previousWindow.length >= 35 ? avg(previousWindow) : 0;
  if (ma35 <= 0) return null;
  const macd = macdInfo(indicatorRows.map((row) => row.close));
  const kd = kdInfo(indicatorRows);
  return {
    ma35,
    ma35Prev,
    ma35TrendUp: ma35Prev > 0 && ma35 > ma35Prev,
    ma35Source: source,
    ma35At: `${sorted[index].minute}:00`,
    ...macd,
    ...kd,
    ...extra,
  };
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

function updateRealtimeQuoteCache(cache, stocks, key) {
  if (cache.quoteSnapshotsDate !== key || !cache.quoteSnapshots || typeof cache.quoteSnapshots !== "object") {
    cache.quoteSnapshotsDate = key;
    cache.quoteSnapshots = {};
  }
  const seenAt = new Date().toISOString();
  for (const stock of stocks) {
    const code = String(stock.code || "");
    const close = cleanNumber(stock.close);
    if (!code || close <= 0 || stock.isRealtime !== true) continue;
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

function mergeRealtimeQuoteCache(cache, stocks, key) {
  if (cache.quoteSnapshotsDate !== key || !cache.quoteSnapshots || typeof cache.quoteSnapshots !== "object") return stocks;
  return stocks.map((stock) => {
    if (stock.isRealtime === true && cleanNumber(stock.close) > 0) return stock;
    const snapshot = cache.quoteSnapshots[String(stock.code || "")];
    if (!snapshot || cleanNumber(snapshot.close) <= 0 || secondsSinceIso(snapshot.quoteSeenAt) > QUOTE_CACHE_MAX_AGE_SECONDS) return stock;
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
  const records = (report.records || []).map((record) => {
    if ((record.stateId === "entry" || record.stateId === "go") && !isStrictStrategy2Ma35Record(record)) {
      downgradedRecords += 1;
      return {
        ...record,
        stateId: "wait",
        stateLabel: "待確認",
        stateReason: `${record.strategy || "盤中轉強"}，未通過進場區硬條件，降級為待確認。`,
      };
    }
    return record;
  });
  const events = (report.events || []).map((event) => {
    const entryRecord = records.find((record) => String(record.code || "") === String(event.code || "") && isStrictStrategy2Ma35Record(record));
    if (!entryRecord) {
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
        stateReason: event.stateReason && /^1分K站上MA35/.test(String(event.stateReason))
          ? "未通過進場區硬條件，降級為待確認。"
          : event.stateReason,
      };
    }
    return {
      ...event,
      firstAAt: event.firstAAt || recordTimeLabel(entryRecord),
      firstAPrice: event.firstAPrice || cleanNumber(entryRecord.entryPrice) || cleanNumber(entryRecord.observedPrice),
      latestAAt: event.latestAAt || recordTimeLabel(entryRecord),
      latestAPrice: event.latestAPrice || cleanNumber(entryRecord.entryPrice) || cleanNumber(entryRecord.observedPrice),
      latestState: "entry",
      stateId: "entry",
      stateLabel: "進場區",
      stateReason: entryRecord.stateReason || event.stateReason,
      ma35: cleanNumber(entryRecord.ma35),
      ma35Prev: cleanNumber(entryRecord.ma35Prev),
      aboveMa35: entryRecord.aboveMa35 === true,
      ma35TrendUp: entryRecord.ma35TrendUp === true,
      ma35Source: entryRecord.ma35Source || "",
      ma35At: entryRecord.ma35At || "",
      ma35Symbol: entryRecord.ma35Symbol || "",
      latestRecord: entryRecord,
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

async function fetchFugleIntradaySma35(code, scanTimestamp) {
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
        high: cleanNumber(row.high),
        low: cleanNumber(row.low),
        close: cleanNumber(row.close),
        volume: cleanNumber(row.volume),
      }))
      .filter((row) => row.minute.startsWith(targetDate));
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

async function fetchIntradaySma35WithFallback(code, scanTimestamp, cache) {
  const attempts = [];
  if (fugleMa35BlockedReason) {
    attempts.push({ source: "fugle-1m", ok: false, configured: Boolean(FUGLE_API_KEY), skipped: true, error: fugleMa35BlockedReason });
  } else {
    try {
      const fugle = await fetchFugleIntradaySma35(code, scanTimestamp);
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
  try {
    const twelve = await fetchTwelveDataIntradaySma35(code, scanTimestamp);
    attempts.push({ source: "twelve-1m", ok: Boolean(twelve), configured: Boolean(TWELVE_DATA_API_KEY), skipped: Boolean(twelveDataBlockedReason), error: twelveDataBlockedReason || undefined });
    if (twelve) return { ...twelve, ma35Attempts: attempts };
  } catch (error) {
    attempts.push({ source: "twelve-1m", ok: false, configured: Boolean(TWELVE_DATA_API_KEY), error: error.message });
  }
  const local = fetchLocalIntradaySma35(cache, code, scanTimestamp);
  attempts.push({ source: "local-1m", ok: Boolean(local) });
  return local ? { ...local, ma35Attempts: attempts } : { ma35Attempts: attempts };
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
    .filter((stock) => cleanNumber(stock.percent) > 2 && cleanNumber(stock.tradeVolume) >= 2000)
    .map((stock) => stock.code);
  const map = new Map();
  const concurrency = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const code = candidates[cursor++];
      const info = await fetchIntradaySma35WithFallback(code, scanTimestamp, cache);
      if (cleanNumber(info?.ma35) > 0) map.set(String(code), info);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return map;
}

async function main() {
  const parts = taipeiParts();
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

  const rawStocks = await fetchStocks();
  const realtimeSourceStocks = rawStocks.filter(isIntradayTradable);
  const realtimePayload = await fetchRealtime(realtimeSourceStocks);
  const timestamp = timestampKey();
  const realtimeStats = fetchRealtime.lastStats || { requested: rawStocks.length, received: 0, failed: 0 };
  updateRealtimeQuoteCache(cache, realtimePayload, key);
  const realtimeWithCache = mergeRealtimeQuoteCache(cache, realtimePayload, key);
  const realtimeStocks = realtimeWithCache
    .filter((stock) => stock.isRealtime === true)
    .filter((stock) => hasUsableQuote(stock, timestamp))
    .filter(isIntradayTradable);
  const coverage = realtimeSourceStocks.length ? realtimeStocks.length / realtimeSourceStocks.length : 0;
  const cachedRecovered = realtimeStocks.filter((stock) => stock.recoveredFromQuoteCache).length;
  const realtimeSummaryBase = {
    ...realtimeStats,
    coverage: Number(coverage.toFixed(4)),
    usable: realtimeStocks.length,
    cachedRecovered,
    quoteCacheMaxAgeSeconds: QUOTE_CACHE_MAX_AGE_SECONDS,
    initialBatchSize: REALTIME_BATCH_SIZE,
    retryBatchSize: REALTIME_RETRY_BATCH_SIZE,
  };
  if (realtimeSourceStocks.length && coverage < MIN_REALTIME_COVERAGE) {
    cache.updatedAt = new Date().toISOString();
    cache.realtime = { ...realtimeSummaryBase, skippedPartialCoverage: true };
    const strategy2Events = mergeStrategy2Events(cache.records || [], key);
    const strategy2Report = enforceStrategy2EntryGuards({
      source: "strategy2-09-to-1330-patrol",
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
    writeJson(STRATEGY2_REPORT_FILE, strategy2Report);
    publishStaticDataJson("strategy2-intraday-latest.json", strategy2Report);
    await upsertStrategy2LatestToSupabase(strategy2Report);
    console.log(`intraday signals ${key}: skipped partial realtime coverage ${realtimeStocks.length}/${realtimeSourceStocks.length} (received ${realtimeStats.received}, failed ${realtimeStats.failed}, missed ${realtimeStats.missedCount || 0})`);
    return;
  }
  updateMinuteCloseCache(cache, realtimeStocks, timestamp, key);
  const ma35Map = await fetchMa35Map(realtimeStocks, timestamp, cache);
  const liveStocks = realtimeStocks.map((stock) => {
    const ma35Info = ma35Map.get(stock.code) || {};
    return {
      ...stock,
      ma35: ma35Info.ma35 || 0,
      ma35Prev: ma35Info.ma35Prev || 0,
      ma35TrendUp: Boolean(ma35Info.ma35TrendUp),
      ma35Source: ma35Info.ma35Source || "",
      ma35Symbol: ma35Info.ma35Symbol || "",
      ma35At: ma35Info.ma35At || "",
      ma35Attempts: ma35Info.ma35Attempts || [],
      macdDif: ma35Info.macdDif || 0,
      macdSignal: ma35Info.macdSignal || 0,
      macdHist: ma35Info.macdHist || 0,
      macdUp: Boolean(ma35Info.macdUp),
      kdK: ma35Info.kdK || 0,
      kdD: ma35Info.kdD || 0,
      kdUp: Boolean(ma35Info.kdUp),
    };
  });
  const ranks = buildRanks(liveStocks);
  let added = 0;

  updateScorecardTradeTracks(scorecardTracker, strategy5Tracker, liveStocks, timestamp, key);

  for (const stock of liveStocks) {
    updateTrackedExtremes(cache, stock, timestamp, key);
    const previous = cache.previous[stock.code] || null;
    const signals = detectSignals(stock, previous || { tradeVolume: stock.tradeVolume }, ranks);
    cache.previous[stock.code] = {
      close: stock.close,
      high: stock.high,
      low: stock.low,
      quoteTime: stock.quoteTime || stock.time || "",
      tradeVolume: stock.tradeVolume,
      percent: stock.percent,
    };
    signals.forEach((signal) => {
      const state = classifyStrategy2State(stock, signal);
      if (!state) return;
      const duplicate = cache.records.some((record) => (
        record.code === stock.code &&
        record.strategy === signal.label &&
        record.timestamp === timestamp
      ));
      if (duplicate) return;
      cache.records.push({
        date: key,
        timestamp,
        entryAt: timestamp,
        code: stock.code,
        name: stock.name,
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
        observedPrice: stock.close,
        quoteTime: stock.quoteTime || stock.time || "",
        quoteSource: "api/realtime",
        observedHigh: stock.close,
        observedHighAt: timestamp,
        observedLow: stock.close,
        observedLowAt: timestamp,
        dayHigh: stock.high || stock.close,
        dayHighAt: timestamp,
        dayLow: stock.low || stock.close,
        dayLowAt: timestamp,
        volume: stock.tradeVolume,
        percent: stock.percent,
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
        intradayVolumeBurst: signal.intradayVolumeBurst,
        recoveredFromRealtimeFallback: Boolean(stock.recoveredFromRealtimeFallback),
      });
      added += 1;
    });
    if (appendTrackedSnapshot(cache, stock, timestamp, key)) {
      added += 1;
    }
  }

  cache.records = normalizeStrategy2Records(cache.records || []);
  cache.updatedAt = new Date().toISOString();
  const strategy2Events = mergeStrategy2Events(cache.records || [], key);
  const realtimeSummary = {
    ...realtimeSummaryBase,
    tradable: liveStocks.length,
  };
  const strategy2Report = enforceStrategy2EntryGuards({
    source: "strategy2-09-to-1330-patrol",
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
  writeJson(STRATEGY2_REPORT_FILE, strategy2Report);
  publishStaticDataJson("strategy2-intraday-latest.json", strategy2Report);
  await upsertStrategy2LatestToSupabase(strategy2Report);
  const strategy2HistoryFile = path.join(STRATEGY2_HISTORY_DIR, `${key}.json`);
  if (shouldWriteStrategy2History(strategy2HistoryFile)) {
    writeJson(strategy2HistoryFile, strategy2Report);
  }
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



