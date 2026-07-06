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
const FINMIND_TOKEN_FILES = [
  path.join(RUNTIME_DIR, "secrets", "finmind-api-token.txt"),
  "C:/fuman-terminal/secrets/finmind-api-token.txt",
];
const LOOP_MS = Math.max(1000, Number(process.env.FUGLE_COLLECTOR_LOOP_MS || 1000));
const BATCH_SIZE = Math.max(1, Number(process.env.FUGLE_COLLECTOR_BATCH_SIZE || 120));
const PER_SYMBOL_DELAY_MS = Math.max(0, Number(process.env.FUGLE_COLLECTOR_REQUEST_DELAY_MS || process.env.FUGLE_COLLECTOR_PER_SYMBOL_DELAY_MS || 80));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.FUGLE_COLLECTOR_CONCURRENCY || 2)));
const QUOTE_TTL_MS = Math.max(30000, Number(process.env.FUGLE_COLLECTOR_QUOTE_TTL_MS || 120000));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.FUGLE_COLLECTOR_REQUEST_TIMEOUT_MS || 15000));
const REQUEST_RETRIES = Math.max(0, Number(process.env.FUGLE_COLLECTOR_REQUEST_RETRIES || 2));
const REQUEST_RETRY_BACKOFF_MS = Math.max(100, Number(process.env.FUGLE_COLLECTOR_RETRY_BACKOFF_MS || 500));
const FINMIND_RECOVERY_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED || "0"));
const FINMIND_RECOVERY_TIMEOUT_MS = Math.max(3000, Number(process.env.FUGLE_COLLECTOR_FINMIND_RECOVERY_TIMEOUT_MS || 30000));
const FINMIND_IP_BAN_COOLDOWN_MS = Math.max(600000, Number(process.env.FUGLE_COLLECTOR_FINMIND_IP_BAN_COOLDOWN_MS || 21600000));
const FINMIND_QUOTA_COOLDOWN_MS = Math.max(FINMIND_IP_BAN_COOLDOWN_MS, Number(process.env.FUGLE_COLLECTOR_FINMIND_QUOTA_COOLDOWN_MS || 21600000));
const OPENING_BOOST_START = process.env.FUGLE_COLLECTOR_OPENING_BOOST_START || "08:45";
const OPENING_BOOST_END = process.env.FUGLE_COLLECTOR_OPENING_BOOST_END || "13:30";
const OPENING_BOOST_BATCH_SIZE = Math.max(BATCH_SIZE, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE || 120));
const OPENING_BOOST_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_CONCURRENCY || 2)));
const OPENING_BOOST_DELAY_MS = Math.max(0, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_DELAY_MS || 80));
const OPENING_BOOST_TARGET_COVERAGE = Math.max(0.5, Math.min(1, Number(process.env.FUGLE_COLLECTOR_OPENING_BOOST_TARGET_COVERAGE || 0.95)));
const STATE_DIR = path.dirname(FUGLE_WS_STATUS_FILE);
const RATE_STATE_FILE = path.join(STATE_DIR, "fugle-rest-collector-rate-state.json");
const UNSUPPORTED_STATE_FILE = path.join(STATE_DIR, "fugle-rest-collector-unsupported-symbols.json");
const PRIORITY_SYMBOLS_FILE = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-ws-priority-symbols.json");
const ADAPTIVE_INITIAL_RPM = Math.max(10, Number(process.env.FUGLE_COLLECTOR_ADAPTIVE_INITIAL_RPM || 60));
const ADAPTIVE_MIN_RPM = Math.max(5, Number(process.env.FUGLE_COLLECTOR_ADAPTIVE_MIN_RPM || 20));
const ADAPTIVE_MAX_RPM = Math.max(ADAPTIVE_MIN_RPM, Number(process.env.FUGLE_COLLECTOR_ADAPTIVE_MAX_RPM || 180));
const ADAPTIVE_429_COOLDOWN_MS = Math.max(10000, Number(process.env.FUGLE_COLLECTOR_429_COOLDOWN_MS || 60000));
const ADAPTIVE_429_WINDOW_MS = Math.max(60000, Number(process.env.FUGLE_COLLECTOR_429_WINDOW_MS || 900000));
const ADAPTIVE_429_BUDGET = Math.max(1, Number(process.env.FUGLE_COLLECTOR_429_BUDGET || 1));
const ADAPTIVE_429_MAX_COOLDOWN_MS = Math.max(ADAPTIVE_429_COOLDOWN_MS, Number(process.env.FUGLE_COLLECTOR_429_MAX_COOLDOWN_MS || 900000));
const ADAPTIVE_PRIORITY_ONLY_AFTER_429_MS = Math.max(
  ADAPTIVE_429_COOLDOWN_MS,
  Number(process.env.FUGLE_COLLECTOR_PRIORITY_ONLY_AFTER_429_MS || 600000),
);

let cursor = 0;
let lastMessageAt = "";
let last429At = "";
let cooldownUntil = 0;
let finmindCooldownUntil = 0;
let lastFinmindError = "";

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
    primarySource: "fugle",
    fallbackSource: "finmind",
    finmindPolicy: "diagnostic_low_frequency_only_not_formal_publish",
    finmindFormalPublishAllowed: false,
    finmindFallbackBlocksLatest: true,
    finmindFallbackPreservePreviousGood: true,
    finmindStopRetryOn402403: true,
    finmindRecoveryEnabled: FINMIND_RECOVERY_ENABLED,
    finmindRecoveryTimeoutMs: FINMIND_RECOVERY_TIMEOUT_MS,
    finmindRecoveryCooldownUntil: finmindCooldownUntil ? new Date(finmindCooldownUntil).toISOString() : "",
    finmindRecoveryLastError: lastFinmindError,
    openingBoostStart: OPENING_BOOST_START,
    openingBoostEnd: OPENING_BOOST_END,
    openingBoostBatchSize: OPENING_BOOST_BATCH_SIZE,
    openingBoostConcurrency: OPENING_BOOST_CONCURRENCY,
    openingBoostDelayMs: OPENING_BOOST_DELAY_MS,
    lastMessageAt,
    last429At,
    cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : "",
    adaptive429Budget: ADAPTIVE_429_BUDGET,
    adaptive429WindowMs: ADAPTIVE_429_WINDOW_MS,
    adaptive429BaseCooldownMs: ADAPTIVE_429_COOLDOWN_MS,
    adaptive429MaxCooldownMs: ADAPTIVE_429_MAX_COOLDOWN_MS,
    adaptivePriorityOnlyAfter429Ms: ADAPTIVE_PRIORITY_ONLY_AFTER_429_MS,
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
  const end = minutesFromHHmm(OPENING_BOOST_END, 13 * 60 + 30);
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

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function readRateState() {
  const state = readJson(RATE_STATE_FILE, {});
  return {
    allowedRpm: clampNumber(state.allowedRpm || ADAPTIVE_INITIAL_RPM, ADAPTIVE_MIN_RPM, ADAPTIVE_MAX_RPM),
    stableTicks: Math.max(0, Number(state.stableTicks || 0)),
    last429At: state.last429At || "",
    cooldownUntil: state.cooldownUntil || "",
    consecutive429Count: Math.max(0, Number(state.consecutive429Count || 0)),
    windowStartedAt: state.windowStartedAt || "",
    window429Count: Math.max(0, Number(state.window429Count || 0)),
    last429BudgetExceeded: Boolean(state.last429BudgetExceeded),
    last429CooldownMs: Math.max(0, Number(state.last429CooldownMs || 0)),
    priorityOnlyUntil: state.priorityOnlyUntil || "",
    updatedAt: state.updatedAt || "",
  };
}

function writeRateState(state) {
  writeJson(RATE_STATE_FILE, {
    allowedRpm: clampNumber(state.allowedRpm, ADAPTIVE_MIN_RPM, ADAPTIVE_MAX_RPM),
    stableTicks: Math.max(0, Number(state.stableTicks || 0)),
    last429At: state.last429At || "",
    cooldownUntil: state.cooldownUntil || "",
    consecutive429Count: Math.max(0, Number(state.consecutive429Count || 0)),
    windowStartedAt: state.windowStartedAt || "",
    window429Count: Math.max(0, Number(state.window429Count || 0)),
    last429BudgetExceeded: Boolean(state.last429BudgetExceeded),
    last429CooldownMs: Math.max(0, Number(state.last429CooldownMs || 0)),
    priorityOnlyUntil: state.priorityOnlyUntil || "",
    updatedAt: nowIso(),
  });
}

function adaptiveDelayMs(baseDelayMs, concurrency, allowedRpm) {
  const rpm = clampNumber(allowedRpm, ADAPTIVE_MIN_RPM, ADAPTIVE_MAX_RPM);
  const delay = Math.ceil((60000 * Math.max(1, concurrency)) / rpm);
  return Math.max(baseDelayMs, delay);
}

function applyRateSuccess(state, fetched) {
  const next = { ...state };
  if (fetched > 0) next.stableTicks += 1;
  if (next.stableTicks >= 3) {
    next.allowedRpm = clampNumber(Math.ceil(next.allowedRpm * 1.08 + 5), ADAPTIVE_MIN_RPM, ADAPTIVE_MAX_RPM);
    next.consecutive429Count = Math.max(0, Number(next.consecutive429Count || 0) - 1);
    next.stableTicks = 0;
  }
  const windowStarted = Date.parse(next.windowStartedAt || "");
  if (Number.isFinite(windowStarted) && Date.now() - windowStarted > ADAPTIVE_429_WINDOW_MS) {
    next.windowStartedAt = "";
    next.window429Count = 0;
    next.last429BudgetExceeded = false;
  }
  const priorityOnlyUntilMs = Date.parse(next.priorityOnlyUntil || "");
  if (Number.isFinite(priorityOnlyUntilMs) && Date.now() >= priorityOnlyUntilMs) {
    next.priorityOnlyUntil = "";
  }
  next.cooldownUntil = "";
  writeRateState(next);
  return next;
}

function applyRateLimited(state) {
  const now = Date.now();
  const nowText = new Date(now).toISOString();
  const windowStarted = Date.parse(state.windowStartedAt || "");
  const windowExpired = !Number.isFinite(windowStarted) || now - windowStarted > ADAPTIVE_429_WINDOW_MS;
  const windowStartedAt = windowExpired ? nowText : state.windowStartedAt;
  const window429Count = (windowExpired ? 0 : Math.max(0, Number(state.window429Count || 0))) + 1;
  const consecutive429Count = Math.max(0, Number(state.consecutive429Count || 0)) + 1;
  const budgetExceeded = window429Count > ADAPTIVE_429_BUDGET;
  const multiplier = budgetExceeded ? Math.pow(2, Math.min(consecutive429Count - 1, 6)) : 1;
  const cooldownMs = Math.min(ADAPTIVE_429_MAX_COOLDOWN_MS, ADAPTIVE_429_COOLDOWN_MS * multiplier);
  const priorityOnlyMs = Math.min(
    ADAPTIVE_429_MAX_COOLDOWN_MS,
    Math.max(cooldownMs, ADAPTIVE_PRIORITY_ONLY_AFTER_429_MS * multiplier),
  );
  const next = {
    ...state,
    allowedRpm: clampNumber(Math.floor(state.allowedRpm * 0.55), ADAPTIVE_MIN_RPM, ADAPTIVE_MAX_RPM),
    stableTicks: 0,
    last429At: nowText,
    cooldownUntil: new Date(now + cooldownMs).toISOString(),
    consecutive429Count,
    windowStartedAt,
    window429Count,
    last429BudgetExceeded: budgetExceeded,
    last429CooldownMs: cooldownMs,
    priorityOnlyUntil: new Date(now + priorityOnlyMs).toISOString(),
  };
  writeRateState(next);
  return next;
}

function readUnsupportedState() {
  const today = currentTaipeiDate();
  const state = readJson(UNSUPPORTED_STATE_FILE, {});
  const symbols = state.tradeDate === today && Array.isArray(state.symbols) ? state.symbols : [];
  return {
    tradeDate: today,
    symbols: new Set(symbols.map(normalizeCode).filter((code) => /^\d{4}$/.test(code))),
  };
}

function writeUnsupportedState(state) {
  writeJson(UNSUPPORTED_STATE_FILE, {
    tradeDate: state.tradeDate || currentTaipeiDate(),
    count: state.symbols.size,
    symbols: [...state.symbols].sort(),
    updatedAt: nowIso(),
  });
}

function freshCachedCodeSet(symbols) {
  const symbolSet = new Set(symbols);
  const payload = readJson(FUGLE_WS_QUOTES_FILE, {});
  const rows = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const cutoff = Date.now() - QUOTE_TTL_MS;
  const fresh = new Set();
  for (const row of rows) {
    const code = normalizeCode(row?.code);
    const seen = Date.parse(row?.quoteSeenAt || row?.updatedAt || payload?.updatedAt || "");
    if (symbolSet.has(code) && Number.isFinite(seen) && seen >= cutoff) fresh.add(code);
  }
  return fresh;
}

function readPrioritySymbols(symbols) {
  const payload = readJson(PRIORITY_SYMBOLS_FILE, {});
  const universe = new Set(symbols);
  const seen = new Set();
  const ordered = [];
  const prioritySeen = new Set();
  const priorityOrdered = [];
  const counts = {
    strategy1: 0,
    strategy2: 0,
    strategy3: 0,
    strategy4: 0,
    strategy5: 0,
    institution: 0,
    warrant: 0,
    cb: 0,
    realtimeRadar: 0,
    threeDayOpenHighFade: 0,
    dynamic: 0,
    hot: 0,
    terminalPriority: 0,
    openingPriority: 0,
    symbols: 0,
  };
  const addMany = (key, values, options = {}) => {
    const list = Array.isArray(values) ? values : [];
    let count = 0;
    for (const value of list) {
      const code = normalizeCode(value?.symbol || value?.code || value);
      if (!/^\d{4}$/.test(code) || !universe.has(code)) continue;
      count += 1;
      if (!seen.has(code)) {
        seen.add(code);
        ordered.push(code);
      }
      if (options.priority && !prioritySeen.has(code)) {
        prioritySeen.add(code);
        priorityOrdered.push(code);
      }
    }
    counts[key] = count;
  };

  addMany("terminalPriority", payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, { priority: true });
  addMany("openingPriority", payload.openingPrioritySymbols || payload.primaryPrioritySymbols, { priority: true });
  addMany("strategy1", payload.strategy1 || payload.strategy1Symbols, { priority: true });
  addMany("strategy2", payload.strategy2 || payload.strategy2Symbols, { priority: true });
  addMany("strategy3", payload.strategy3 || payload.strategy3Symbols, { priority: true });
  addMany("strategy4", payload.strategy4 || payload.strategy4Symbols, { priority: true });
  addMany("strategy5", payload.strategy5 || payload.strategy5Symbols, { priority: true });
  addMany("institution", payload.institution || payload.institutionSymbols, { priority: true });
  addMany("warrant", payload.warrant || payload.warrantSymbols, { priority: true });
  addMany("cb", payload.cb || payload.cbSymbols, { priority: true });
  addMany("realtimeRadar", payload.realtimeRadar || payload.realtimeRadarSymbols, { priority: true });
  addMany("threeDayOpenHighFade", payload.threeDayOpenHighFade || payload.openHighFadeSymbols, { priority: true });
  addMany("dynamic", payload.dynamic || payload.dynamicMotherPoolSymbols, { priority: true });
  addMany("hot", payload.hot || payload.daytradeHotSymbols || payload.priorityStrongSymbols, { priority: true });
  addMany("symbols", payload.symbols);

  return {
    symbols: priorityOrdered.length ? priorityOrdered : ordered,
    allSymbols: ordered,
    counts,
    updatedAt: payload.updatedAt || "",
    source: payload.source || "",
  };
}

function currentTaipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    delayMs: openingBoostActive ? Math.max(PER_SYMBOL_DELAY_MS, OPENING_BOOST_DELAY_MS) : PER_SYMBOL_DELAY_MS,
  };
}

function selectStaleFirstBatch(symbols, batchSize, unsupported, prioritySymbols = []) {
  const fresh = freshCachedCodeSet(symbols);
  const universe = new Set(symbols);
  const prioritySet = new Set(prioritySymbols.filter((code) => universe.has(code) && !unsupported.has(code)));
  const priorityList = prioritySymbols.filter((code, index, array) => prioritySet.has(code) && array.indexOf(code) === index);
  const batch = [];
  const batchSet = new Set();
  const limit = Math.min(batchSize, symbols.length);
  const addCandidate = (code) => {
    if (batch.length >= limit || unsupported.has(code) || batchSet.has(code)) return false;
    batch.push(code);
    batchSet.add(code);
    return true;
  };
  let priorityAttempted = 0;
  for (const code of priorityList) {
    if (!fresh.has(code) && addCandidate(code)) priorityAttempted += 1;
  }
  let scanned = 0;
  while (batch.length < limit && scanned < symbols.length) {
    const code = symbols[(cursor + scanned) % symbols.length];
    scanned += 1;
    if (prioritySet.has(code) || unsupported.has(code)) continue;
    if (fresh.has(code)) continue;
    addCandidate(code);
  }
  scanned = 0;
  for (const code of priorityList) {
    if (fresh.has(code) && addCandidate(code)) priorityAttempted += 1;
  }
  while (batch.length < limit && scanned < symbols.length) {
    const code = symbols[(cursor + scanned) % symbols.length];
    scanned += 1;
    if (prioritySet.has(code) || unsupported.has(code)) continue;
    addCandidate(code);
  }
  let priorityFreshCount = 0;
  for (const code of priorityList) {
    if (fresh.has(code)) priorityFreshCount += 1;
  }
  return {
    batch,
    scanned,
    freshCount: fresh.size,
    unsupportedCount: unsupported.size,
    prioritySymbols: priorityList.length,
    priorityAttempted,
    priorityFreshCount,
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

function normalizeFinMindQuote(row, today) {
  const code = normalizeCode(row?.stock_id);
  if (!/^\d{4}$/.test(code)) return null;
  const quoteDate = String(row?.date || row?.datetime || row?.date_time || "").slice(0, 10);
  if (today && quoteDate && quoteDate !== today) return null;
  const close = cleanNumber(row?.close ?? row?.last_price ?? row?.lastPrice ?? row?.price);
  if (!close) return null;
  const change = cleanNumber(row?.change_price ?? row?.change ?? row?.spread);
  const changeRate = cleanNumber(row?.change_rate ?? row?.change_percent);
  const prevClose = close && change
    ? close - change
    : close && changeRate
      ? close / (1 + changeRate / 100)
      : close;
  if (!prevClose) return null;
  const now = nowIso();
  return {
    code,
    name: row?.stock_name || row?.name || code,
    close,
    closeSource: "finmind",
    change: change || close - prevClose,
    percent: changeRate || (prevClose ? ((close - prevClose) / prevClose) * 100 : 0),
    open: cleanNumber(row?.open),
    high: cleanNumber(row?.high || close),
    low: cleanNumber(row?.low || close),
    prevClose,
    tradeVolume: volumeToLots(row?.total_volume ?? row?.volume),
    tradeValue: cleanNumber(row?.total_amount || row?.amount),
    bidPrice: cleanNumber(row?.buy_price),
    bidSize: volumeToLots(row?.buy_volume),
    askPrice: cleanNumber(row?.sell_price),
    askSize: volumeToLots(row?.sell_volume),
    market: row?.type || row?.market || "",
    time: row?.date || row?.datetime || row?.date_time || now,
    quoteTime: row?.date || row?.datetime || row?.date_time || now,
    quoteSeenAt: now,
    updatedAt: now,
    quoteSource: "finmind",
    realtimeFallback: "finmind",
    recoveredFromRealtimeFallback: true,
    fallbackUsed: true,
    fallbackScope: ["finmind_realtime_snapshot_recovery"],
    fallbackAllowed: false,
    fallbackDetails: [{ source: "finmind", rule: "diagnostic-only; never formal daytrade publish" }],
    formalPublishEligible: false,
    preservePreviousGood: true,
  };
}

function applyFinMindCooldown(status, payload) {
  const retryAfterSeconds = Number(payload?.retry_after || payload?.retryAfter || 0);
  const message = String(payload?.msg || payload?.message || payload?.error || "").toLowerCase();
  if (status === 402) {
    finmindCooldownUntil = Date.now() + FINMIND_QUOTA_COOLDOWN_MS;
    return;
  }
  if (status === 403 && message.includes("ban")) {
    finmindCooldownUntil = Date.now() + FINMIND_IP_BAN_COOLDOWN_MS;
    return;
  }
  if ((status === 403 || status === 429 || retryAfterSeconds > 0) && retryAfterSeconds >= 0) {
    const floorSeconds = status === 403 ? Math.ceil(FINMIND_IP_BAN_COOLDOWN_MS / 1000) : status === 429 ? 60 : 0;
    finmindCooldownUntil = Date.now() + Math.max(floorSeconds, retryAfterSeconds) * 1000;
  }
}

async function fetchFinMindRecoveryQuotes(symbols, token) {
  if (!FINMIND_RECOVERY_ENABLED) return { quotes: [], requested: 0, recovered: 0, skipped: true, error: "" };
  if (!token) return { quotes: [], requested: 0, recovered: 0, skipped: true, error: "missing FinMind token" };
  const normalized = [...new Set((symbols || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code) && !code.startsWith("00")))];
  const fresh = freshCachedCodeSet(normalized);
  const missing = new Set(normalized.filter((code) => !fresh.has(code)));
  if (!missing.size) return { quotes: [], requested: 0, recovered: 0, skipped: true, error: "" };
  if (finmindCooldownUntil && Date.now() < finmindCooldownUntil) {
    return {
      quotes: [],
      requested: missing.size,
      recovered: 0,
      skipped: true,
      error: `FinMind cooldown until ${new Date(finmindCooldownUntil).toISOString()}: ${lastFinmindError}`,
      cooldownUntil: new Date(finmindCooldownUntil).toISOString(),
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FINMIND_RECOVERY_TIMEOUT_MS);
  try {
    const url = new URL("https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot");
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "FumanPublicSlotFinMindRecovery/1.0",
        "Referer": "https://finmindtrade.com/",
        "Accept": "application/json,text/plain,*/*",
      },
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      applyFinMindCooldown(response.status, payload);
      throw new Error(`FinMind snapshot HTTP ${response.status}${payload?.msg ? `: ${payload.msg}` : ""}`);
    }
    if (payload?.status && Number(payload.status) >= 400) {
      applyFinMindCooldown(Number(payload.status), payload);
      throw new Error(`FinMind snapshot status ${payload.status}: ${payload.msg || ""}`);
    }
    const today = currentTaipeiDate();
    const quotes = [];
    for (const row of Array.isArray(payload?.data) ? payload.data : []) {
      const quote = normalizeFinMindQuote(row, today);
      if (quote && missing.has(quote.code)) quotes.push(quote);
    }
    lastFinmindError = "";
    finmindCooldownUntil = 0;
    return { quotes, requested: missing.size, recovered: quotes.length, skipped: false, error: "" };
  } catch (error) {
    lastFinmindError = error?.message || String(error);
    return {
      quotes: [],
      requested: missing.size,
      recovered: 0,
      skipped: false,
      error: lastFinmindError,
      cooldownUntil: finmindCooldownUntil ? new Date(finmindCooldownUntil).toISOString() : "",
    };
  } finally {
    clearTimeout(timer);
  }
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
        cooldownUntil = Date.now() + ADAPTIVE_429_COOLDOWN_MS;
        const error = new Error("429 Too Many Requests");
        error.status = 429;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    } catch (error) {
      lastError = error?.name === "AbortError" ? new Error(`timeout ${REQUEST_TIMEOUT_MS}ms`) : error;
      if (Number(lastError?.status) === 429 || Number(lastError?.status) === 404) break;
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
  const finmindToken = readSecret(FINMIND_TOKEN_FILES);
  const symbols = readSymbols();
  if (!apiKey) {
    writeStatus({ ok: false, subscribed: symbols.length, error: "fugle api key missing" });
    return;
  }
  if (!symbols.length) {
    writeStatus({ ok: false, subscribed: 0, error: "symbols missing" });
    return;
  }
  const beforeFugle = effectiveCollectorConfig(symbols);
  const rateState = readRateState();
  if (rateState.last429At) last429At = rateState.last429At;
  const rateCooldownUntil = Date.parse(rateState.cooldownUntil || "");
  if (Number.isFinite(rateCooldownUntil) && Date.now() < rateCooldownUntil) {
    cooldownUntil = Math.max(cooldownUntil || 0, rateCooldownUntil);
  }
  const shouldUseFinMind = beforeFugle.openingBoostActive || Date.now() < cooldownUntil;
  const finmindRecovery = shouldUseFinMind
    ? await fetchFinMindRecoveryQuotes(symbols, finmindToken)
    : { quotes: [], requested: 0, recovered: 0, skipped: true, error: "" };
  const finmindMergedCount = finmindRecovery.quotes.length ? mergeQuotes(finmindRecovery.quotes) : 0;
  if (Date.now() < cooldownUntil) {
    const existing = readJson(FUGLE_WS_QUOTES_FILE, {});
    const cooldownPriority = readPrioritySymbols(symbols);
    const cooldownDelayMs = adaptiveDelayMs(beforeFugle.delayMs, beforeFugle.concurrency, rateState.allowedRpm);
    const priorityOnlyUntilMs = Date.parse(rateState.priorityOnlyUntil || "");
    const priorityOnlyActive = Number.isFinite(priorityOnlyUntilMs) && Date.now() < priorityOnlyUntilMs;
    writeStatus({
      subscribed: symbols.length,
      quotes: finmindMergedCount || existing.count || 0,
      cooldown: true,
      prioritySymbols: cooldownPriority.symbols.length,
      priorityAttempted: 0,
      priorityFreshCount: 0,
      prioritySource: cooldownPriority.source,
      priorityFileUpdatedAt: cooldownPriority.updatedAt,
      priorityTerminalSymbols: cooldownPriority.counts.terminalPriority,
      priorityOpeningSymbols: cooldownPriority.counts.openingPriority,
      priorityStrategy1Symbols: cooldownPriority.counts.strategy1,
      priorityStrategy2Symbols: cooldownPriority.counts.strategy2,
      priorityStrategy3Symbols: cooldownPriority.counts.strategy3,
      priorityStrategy4Symbols: cooldownPriority.counts.strategy4,
      priorityStrategy5Symbols: cooldownPriority.counts.strategy5,
      priorityInstitutionSymbols: cooldownPriority.counts.institution,
      priorityWarrantSymbols: cooldownPriority.counts.warrant,
      priorityCbSymbols: cooldownPriority.counts.cb,
      priorityRealtimeRadarSymbols: cooldownPriority.counts.realtimeRadar,
      priorityThreeDayOpenHighFadeSymbols: cooldownPriority.counts.threeDayOpenHighFade,
      priorityDynamicSymbols: cooldownPriority.counts.dynamic,
      priorityHotSymbols: cooldownPriority.counts.hot,
      adaptiveRpm: rateState.allowedRpm,
      adaptiveDelayMs: cooldownDelayMs,
      adaptiveStableTicks: rateState.stableTicks,
      adaptiveRateLimited: true,
      adaptiveCooldownUntil: new Date(cooldownUntil).toISOString(),
      adaptiveConsecutive429Count: rateState.consecutive429Count,
      adaptive429WindowCount: rateState.window429Count,
      adaptive429WindowStartedAt: rateState.windowStartedAt,
      adaptive429BudgetExceeded: rateState.last429BudgetExceeded,
      adaptiveLast429CooldownMs: rateState.last429CooldownMs,
      adaptivePriorityOnly: priorityOnlyActive,
      adaptivePriorityOnlyUntil: rateState.priorityOnlyUntil || "",
      openingBoostActive: beforeFugle.openingBoostActive,
      openingBoostFreshCount: beforeFugle.freshCount,
      openingBoostCoverage: Number(beforeFugle.coverage.toFixed(4)),
      batchSize: beforeFugle.batchSize,
      concurrency: beforeFugle.concurrency,
      perSymbolDelayMs: cooldownDelayMs,
      finmindRecoveryRequested: finmindRecovery.requested,
      finmindRecoveryFetched: finmindRecovery.recovered,
      finmindRecoverySkipped: finmindRecovery.skipped,
      finmindRecoveryError: finmindRecovery.error,
      finmindRecoveryCooldownUntil: finmindRecovery.cooldownUntil || (finmindCooldownUntil ? new Date(finmindCooldownUntil).toISOString() : ""),
    });
    return;
  }

  if (cursor < 0 || cursor >= symbols.length) cursor = 0;
  const effective = effectiveCollectorConfig(symbols);
  const unsupportedState = readUnsupportedState();
  const priority = readPrioritySymbols(symbols);
  const currentRateState = readRateState();
  const priorityOnlyUntilMs = Date.parse(currentRateState.priorityOnlyUntil || "");
  const priorityOnlyActive = Number.isFinite(priorityOnlyUntilMs) && Date.now() < priorityOnlyUntilMs;
  const universeSet = new Set(symbols);
  const priorityOnlySymbols = priority.symbols.filter((code) => universeSet.has(code) && !unsupportedState.symbols.has(code));
  const priorityOnlyFallback = priorityOnlyActive && priorityOnlySymbols.length === 0;
  const selectionSymbols = priorityOnlyActive ? priorityOnlySymbols : symbols;
  const selectionBatchSize = priorityOnlyActive
    ? Math.min(effective.batchSize, Math.max(0, priorityOnlySymbols.length))
    : effective.batchSize;
  const selected = priorityOnlyFallback
    ? {
        batch: [],
        scanned: 0,
        freshCount: freshCachedCodeSet(symbols).size,
        unsupportedCount: unsupportedState.symbols.size,
        prioritySymbols: priority.symbols.length,
        priorityAttempted: 0,
        priorityFreshCount: 0,
      }
    : selectStaleFirstBatch(selectionSymbols, selectionBatchSize, unsupportedState.symbols, priority.symbols);
  const batch = selected.batch;
  const pacingDelayMs = adaptiveDelayMs(effective.delayMs, effective.concurrency, currentRateState.allowedRpm);

  const quotes = [];
  let rateLimited = false;
  let unsupportedThisLoop = 0;
  for (let offset = 0; offset < batch.length; offset += effective.concurrency) {
    const chunk = batch.slice(offset, offset + effective.concurrency);
    const results = await Promise.all(chunk.map(async (code) => {
      try {
        const payload = await fetchQuote(code, apiKey);
        return normalizeQuote(payload, code);
      } catch (error) {
        if (Number(error?.status) === 404 || String(error?.message || "").includes("404")) {
          if (!unsupportedState.symbols.has(code)) {
            unsupportedState.symbols.add(code);
            unsupportedThisLoop += 1;
          }
        }
        if (Number(error?.status) === 429 || String(error?.message || "").includes("429")) {
          last429At = nowIso();
          cooldownUntil = Date.now() + ADAPTIVE_429_COOLDOWN_MS;
          rateLimited = true;
        }
        return null;
      }
    }));
    for (const quote of results) {
      if (quote) quotes.push(quote);
    }
    if (cooldownUntil && Date.now() < cooldownUntil) break;
    if (pacingDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pacingDelayMs));
    }
  }
  const cursorModulo = Math.max(1, selectionSymbols.length || symbols.length);
  cursor = (cursor + Math.max(1, selected.scanned || batch.length)) % cursorModulo;
  if (quotes.length) lastMessageAt = nowIso();
  const count = mergeQuotes(quotes);
  writeUnsupportedState(unsupportedState);
  const nextRateState = rateLimited ? applyRateLimited(currentRateState) : applyRateSuccess(currentRateState, quotes.length);
  if (rateLimited) {
    last429At = nextRateState.last429At || last429At;
    const nextCooldownUntil = Date.parse(nextRateState.cooldownUntil || "");
    if (Number.isFinite(nextCooldownUntil)) cooldownUntil = Math.max(cooldownUntil || 0, nextCooldownUntil);
  }
  writeStatus({
    subscribed: symbols.length,
    pending: Math.max(0, symbols.length - count),
    quotes: count,
    fetched: quotes.length,
    fugleFetched: quotes.length,
    finmindRecoveryRequested: finmindRecovery.requested,
    finmindRecoveryFetched: finmindRecovery.recovered,
    finmindRecoverySkipped: finmindRecovery.skipped,
    finmindRecoveryError: finmindRecovery.error,
    finmindRecoveryCooldownUntil: finmindRecovery.cooldownUntil || (finmindCooldownUntil ? new Date(finmindCooldownUntil).toISOString() : ""),
    attempted: batch.length,
    scanned: selected.scanned,
    staleFirstFreshCount: selected.freshCount,
    prioritySymbols: selected.prioritySymbols,
    priorityAttempted: selected.priorityAttempted,
    priorityFreshCount: selected.priorityFreshCount,
    prioritySource: priority.source,
    priorityFileUpdatedAt: priority.updatedAt,
    priorityTerminalSymbols: priority.counts.terminalPriority,
    priorityOpeningSymbols: priority.counts.openingPriority,
    priorityStrategy1Symbols: priority.counts.strategy1,
    priorityStrategy2Symbols: priority.counts.strategy2,
    priorityStrategy3Symbols: priority.counts.strategy3,
    priorityStrategy4Symbols: priority.counts.strategy4,
    priorityStrategy5Symbols: priority.counts.strategy5,
    priorityInstitutionSymbols: priority.counts.institution,
    priorityWarrantSymbols: priority.counts.warrant,
    priorityCbSymbols: priority.counts.cb,
    priorityRealtimeRadarSymbols: priority.counts.realtimeRadar,
    priorityThreeDayOpenHighFadeSymbols: priority.counts.threeDayOpenHighFade,
    priorityDynamicSymbols: priority.counts.dynamic,
    priorityHotSymbols: priority.counts.hot,
    unsupportedSymbols: unsupportedState.symbols.size,
    unsupportedThisLoop,
    adaptiveRpm: nextRateState.allowedRpm,
    adaptiveDelayMs: pacingDelayMs,
    adaptiveStableTicks: nextRateState.stableTicks,
    adaptiveRateLimited: rateLimited,
    adaptiveCooldownUntil: nextRateState.cooldownUntil || "",
    adaptiveConsecutive429Count: nextRateState.consecutive429Count,
    adaptive429WindowCount: nextRateState.window429Count,
    adaptive429WindowStartedAt: nextRateState.windowStartedAt,
    adaptive429BudgetExceeded: nextRateState.last429BudgetExceeded,
    adaptiveLast429CooldownMs: nextRateState.last429CooldownMs,
    adaptivePriorityOnly: priorityOnlyActive || (Boolean(nextRateState.priorityOnlyUntil) && Date.parse(nextRateState.priorityOnlyUntil) > Date.now()),
    adaptivePriorityOnlyUntil: nextRateState.priorityOnlyUntil || "",
    adaptivePriorityOnlyFallback: priorityOnlyFallback,
    adaptiveSelectionUniverse: priorityOnlyActive ? "priority_only" : "full_universe",
    adaptiveSelectionUniverseSymbols: selectionSymbols.length,
    openingBoostActive: effective.openingBoostActive,
    openingBoostFreshCount: effective.freshCount,
    openingBoostCoverage: Number(effective.coverage.toFixed(4)),
    batchSize: effective.batchSize,
    concurrency: effective.concurrency,
    perSymbolDelayMs: pacingDelayMs,
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
