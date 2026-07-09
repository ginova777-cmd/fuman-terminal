const fs = require("fs");
const path = require("path");
const { runtimePath, cachePath, statePath, repoPath } = require("./runtime-paths");
const {
  FUGLE_WS_STATUS_FILE,
  readFugleWebSocketCandles,
  readFugleWebSocketQuotes,
  writeFugleWebSocketSymbols,
} = require("../lib/fugle-websocket-quotes");
const {
  readFugleFutoptWebSocketQuotes,
} = require("../lib/fugle-futopt-websocket");

const SOURCE_NAME = process.env.DAYTRADE_SOURCE_NAME || "fugle_daytrade_source";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const STATE_FILE = statePath("daytrade-source-writer-state.json");
const RUNTIME_CONFIG_FILE = runtimePath("config", "daytrade-source-speed.json");
const REPO_CONFIG_FILE = repoPath("ops", "public-slot", "daytrade-source-speed.config.example.json");
const PRIORITY_SYMBOLS_FILE = cachePath("intraday", "fugle-ws-priority-symbols.json");

const APPLY = hasFlag("apply") || envFlag("FUMAN_DAYTRADE_WRITER_APPLY");
const DRY_RUN = !APPLY;
const LOCAL_CHECK = hasFlag("local-check");
const NO_FETCH = hasFlag("no-fetch") || envFlag("FUMAN_DAYTRADE_WRITER_NO_FETCH");
let FETCH_ENABLED = false;
const ONCE = hasFlag("once") || envFlag("FUMAN_DAYTRADE_WRITER_ONCE");
const MAX_RUN_SECONDS = positiveNumber(argValue("max-seconds", process.env.FUMAN_DAYTRADE_WRITER_MAX_SECONDS || 0), 0);
const SUPABASE_READ_TIMEOUT_MS = Math.max(3000, Number(process.env.DAYTRADE_SUPABASE_READ_TIMEOUT_MS || 8000));
const SUPABASE_WRITE_TIMEOUT_MS = Math.max(5000, Number(process.env.DAYTRADE_SUPABASE_WRITE_TIMEOUT_MS || 12000));

const DEFAULT_CONFIG = {
  loopSeconds: 5,
  sourceName: SOURCE_NAME,
  speedTargets: {
    freshQuoteWindowSeconds: 120,
    targetFreshQuotes: 1500,
    minFreshQuoteCoverage: 0.9,
    requiredSymbolsPerSecond: 12.5,
    maxQuoteAgeSeconds: 90,
    selectedSymbolMaxQuoteAgeSeconds: 60,
  },
  priorityPool: {
    targetSymbolsMin: 300,
    targetSymbolsMax: 500,
    minFreshQuoteCoverageForA: 0.95,
  },
  collector: {
    quoteBatchSize: 40,
    quoteConcurrency: 1,
    targetBatchIntervalSeconds: 3.2,
    cooldownInitialSeconds: 90,
    cooldownMaxSeconds: 900,
    priorityOnlyAfter429: true,
  },
  intraday1m: {
    maxStaleSeconds: 120,
  },
  rateLimitGate: {
    recent429BlocksASeconds: 90,
    pauseFullMarketAfter429SecondsMin: 60,
    pauseFullMarketAfter429SecondsMax: 180,
  },
};

const CONFIG = mergeConfig(DEFAULT_CONFIG, readJson(REPO_CONFIG_FILE, {}), readJson(RUNTIME_CONFIG_FILE, {}));
const REST_QUOTE_FETCH_ENABLED = CONFIG.collector?.restFallbackEnabled !== false;
FETCH_ENABLED = REST_QUOTE_FETCH_ENABLED && !NO_FETCH && (APPLY || hasFlag("fetch") || envFlag("FUMAN_DAYTRADE_WRITER_FETCH"));
const LOOP_SECONDS = positiveNumber(CONFIG.loopSeconds, 5);
const WINDOW_SECONDS = positiveNumber(CONFIG.speedTargets?.freshQuoteWindowSeconds, 120);
const TARGET_FRESH_QUOTES = positiveNumber(CONFIG.speedTargets?.targetFreshQuotes, 1500);
const REQUIRED_SYMBOLS_PER_SECOND = positiveNumber(CONFIG.speedTargets?.requiredSymbolsPerSecond, TARGET_FRESH_QUOTES / WINDOW_SECONDS);
const MIN_FRESH_QUOTE_COVERAGE = positiveNumber(CONFIG.speedTargets?.minFreshQuoteCoverage, 0.9);
const MAX_QUOTE_AGE_SECONDS = positiveNumber(CONFIG.speedTargets?.maxQuoteAgeSeconds, 90);
const SELECTED_SYMBOL_MAX_AGE_SECONDS = positiveNumber(CONFIG.speedTargets?.selectedSymbolMaxQuoteAgeSeconds, 60);
const MIN_PRIORITY_POOL_SYMBOLS = positiveNumber(CONFIG.priorityPool?.targetSymbolsMin, 300);
const MAX_PRIORITY_POOL_SYMBOLS = positiveNumber(CONFIG.priorityPool?.targetSymbolsMax, 500);
const MIN_PRIORITY_FRESH_COVERAGE = positiveNumber(CONFIG.priorityPool?.minFreshQuoteCoverageForA, 0.95);
const FORMAL_DAYTRADE_PRIORITY_LIMIT = Math.max(1, positiveNumber(process.env.DAYTRADE_FORMAL_PRIORITY_LIMIT, 40));
const MOTHER_POOL_MIN_SYMBOLS = Math.max(
  FORMAL_DAYTRADE_PRIORITY_LIMIT,
  positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MIN_SYMBOLS || CONFIG.motherPool?.targetSymbolsMin, 180),
);
const MOTHER_POOL_MAX_SYMBOLS = Math.max(
  MOTHER_POOL_MIN_SYMBOLS,
  positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MAX_SYMBOLS || CONFIG.motherPool?.targetSymbolsMax, 300),
);
const REST_PRIORITY_BATCH_LIMIT = Math.max(1, positiveNumber(process.env.DAYTRADE_REST_PRIORITY_BATCH_LIMIT, 20));
const BATCH_SIZE = Math.max(1, Math.min(FORMAL_DAYTRADE_PRIORITY_LIMIT, REST_PRIORITY_BATCH_LIMIT, positiveNumber(CONFIG.collector?.quoteBatchSize, 40)));
const CONCURRENCY = 1;
const TARGET_BATCH_INTERVAL_SECONDS = Math.max(30, positiveNumber(CONFIG.collector?.targetBatchIntervalSeconds, 30));
const REQUEST_DELAY_MS = Math.max(0, Math.floor((TARGET_BATCH_INTERVAL_SECONDS * 1000) / Math.max(1, BATCH_SIZE)));
const COOLDOWN_INITIAL_SECONDS = positiveNumber(CONFIG.collector?.cooldownInitialSeconds, 90);
const COOLDOWN_MAX_SECONDS = positiveNumber(CONFIG.collector?.cooldownMaxSeconds, 900);
const RECENT_429_BLOCK_SECONDS = positiveNumber(CONFIG.rateLimitGate?.recent429BlocksASeconds, 90);
const FULL_MARKET_PAUSE_MIN_SECONDS = positiveNumber(CONFIG.rateLimitGate?.pauseFullMarketAfter429SecondsMin, 60);
const FULL_MARKET_PAUSE_MAX_SECONDS = positiveNumber(CONFIG.rateLimitGate?.pauseFullMarketAfter429SecondsMax, 180);
const QUOTE_NOT_FOUND_SKIP_SECONDS = positiveNumber(CONFIG.rateLimitGate?.quoteNotFoundSkipSeconds, 1800);
const MAX_INTRADAY_1M_STALE_SECONDS = positiveNumber(CONFIG.intraday1m?.maxStaleSeconds, 120);
const WEBSOCKET_CANDLE_MAX_AGE_MS = positiveNumber(process.env.DAYTRADE_WEBSOCKET_CANDLE_MAX_AGE_MS, 10 * 60 * 1000);
const FUTOPT_WEBSOCKET_MAX_AGE_MS = positiveNumber(process.env.DAYTRADE_FUTOPT_WEBSOCKET_MAX_AGE_MS, 5 * 60 * 1000);
const MIN_READY_MA20_CONTINUOUS = positiveNumber(process.env.DAYTRADE_MIN_READY_MA20_CONTINUOUS, 1500);
const MIN_READY_MA35_CONTINUOUS = positiveNumber(process.env.DAYTRADE_MIN_READY_MA35_CONTINUOUS, 1500);
const MIN_FUTOPT_MAPPED = positiveNumber(process.env.DAYTRADE_MIN_FUTOPT_MAPPED, 1);

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|ok|ready)$/i.test(String(value || "").trim());
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function mergeConfig(...configs) {
  const out = {};
  for (const config of configs) mergeObject(out, config || {});
  return out;
}

function mergeObject(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeObject(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function readSecret(name) {
  return readText(runtimePath("secrets", name))
    || readText(repoPath("secrets", name))
    || readText(path.join("C:", "fuman-terminal", "secrets", name));
}

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecret("supabase-service-role-key.txt");
const SUPABASE_READ_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-anon-key.txt")
  || SUPABASE_SERVICE_KEY;
const FUGLE_API_KEY = process.env.FUGLE_API_KEY
  || process.env.FUMAN_FUGLE_API_KEY
  || readSecret("fugle-api-key.txt");

function normalizeCode(value) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(text) ? text : "";
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTimestamp(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" || /^\d{10,17}$/.test(String(value).trim())) {
    const raw = Number(value);
    if (Number.isFinite(raw) && raw > 0) {
      const millis = raw > 1e15 ? raw / 1000 : raw > 1e12 ? raw : raw > 1e10 ? raw : raw * 1000;
      const date = new Date(millis);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return new Date(parsed).toISOString();
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function taipeiDateFrom(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return taipeiDate();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(parsed));
}

function taipeiMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value || 0);
}

function phaseNow() {
  const minutes = taipeiMinutes();
  if (minutes < 360) return "closed_before_0600";
  if (minutes < 510) return "warmup_0600_0829";
  if (minutes < 525) return "preopen_prepare_0830_0844";
  if (minutes < 540) return "opening_boost_0845_0859";
  if (minutes < 575) return "opening_detection_0900_0934";
  if (minutes <= 810) return "regular_daytrade_0935_1330";
  return "after_daytrade_window";
}

function quoteFetchAllowedForPhase(phase) {
  return [
    "warmup_0600_0829",
    "preopen_prepare_0830_0844",
    "opening_boost_0845_0859",
    "opening_detection_0900_0934",
    "regular_daytrade_0935_1330",
  ].includes(phase);
}

function quoteFetchPriorityOnlyForPhase(phase) {
  return [
    "warmup_0600_0829",
    "preopen_prepare_0830_0844",
  ].includes(phase);
}

function quoteFreshnessTime(quote) {
  return quote?.quote_seen_at || quote?.updated_at || quote?.last_trade_time || "";
}

function ageSeconds(value, fallback = 999999) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return fallback;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function percentile(values, ratio) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return 999999;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function futureSeconds(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function requireSupabaseKey(write = false) {
  const key = write ? SUPABASE_SERVICE_KEY : SUPABASE_READ_KEY;
  if (!key) throw new Error(write ? "missing Supabase service role key" : "missing Supabase read key");
  return key;
}

async function supabaseGet(resource, query = "", options = {}) {
  const key = requireSupabaseKey(Boolean(options.service));
  const url = `${SUPABASE_URL}/rest/v1/${resource}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    method: "GET",
    headers: headers(key),
    signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_READ_TIMEOUT_MS) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : [];
}

async function supabaseGetPaged(resource, query = "", options = {}) {
  const key = requireSupabaseKey(Boolean(options.service));
  const pageSize = Math.max(1, Math.min(Number(options.pageSize || 1000), 1000));
  const rows = [];
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${resource}${query ? `?${query}` : ""}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...headers(key),
        Range: `${offset}-${offset + pageSize - 1}`,
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_READ_TIMEOUT_MS) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${text.slice(0, 240)}`);
    const page = text ? JSON.parse(text) : [];
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function supabaseUpsert(resource, rows, conflict, options = {}) {
  if (!rows.length) return { written: 0, skipped: true };
  if (DRY_RUN) return { written: 0, skipped: true, dryRun: true };
  const key = requireSupabaseKey(true);
  let written = 0;
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || 300), 500));
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: {
        ...headers(key),
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_WRITE_TIMEOUT_MS) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${resource} upsert HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    written += chunk.length;
  }
  return { written };
}

async function supabaseDelete(resource, query = "") {
  if (DRY_RUN) return { deleted: 0, skipped: true, dryRun: true };
  const key = requireSupabaseKey(true);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}${query ? `?${query}` : ""}`, {
    method: "DELETE",
    headers: {
      ...headers(key),
      Prefer: "return=minimal",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_WRITE_TIMEOUT_MS) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${resource} delete HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return { deleted: 0 };
}

async function supabaseInsert(resource, rows, options = {}) {
  if (!rows.length) return { written: 0, skipped: true };
  if (DRY_RUN) return { written: 0, skipped: true, dryRun: true };
  const key = requireSupabaseKey(true);
  let written = 0;
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || 300), 500));
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_WRITE_TIMEOUT_MS) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${resource} insert HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    written += chunk.length;
  }
  return { written };
}

function readWriterState() {
  const state = readJson(STATE_FILE, {});
  const notFoundUntilBySymbol = {};
  for (const [symbol, until] of Object.entries(state.notFoundUntilBySymbol || {})) {
    const code = normalizeCode(symbol);
    if (code && futureSeconds(until) > 0) notFoundUntilBySymbol[code] = until;
  }
  return {
    cursor: Math.max(0, Number(state.cursor || 0)),
    last429At: state.last429At || "",
    cooldownUntil: state.cooldownUntil || "",
    priorityOnlyUntil: state.priorityOnlyUntil || "",
    notFoundUntilBySymbol,
    consecutive429Count: Math.max(0, Number(state.consecutive429Count || 0)),
    selfHealCount: Math.max(0, Number(state.selfHealCount || 0)),
    lastSelfHealAt: state.lastSelfHealAt || "",
    lastSelfHealReason: state.lastSelfHealReason || "",
    lastSelfHealAction: state.lastSelfHealAction || "",
    intradayMirrorCursor: Math.max(0, Number(state.intradayMirrorCursor || 0)),
  };
}

function applyQuoteNotFoundState(state, errors) {
  const notFoundUntilBySymbol = { ...(state.notFoundUntilBySymbol || {}) };
  const until = new Date(Date.now() + QUOTE_NOT_FOUND_SKIP_SECONDS * 1000).toISOString();
  for (const error of errors || []) {
    if (Number(error?.status) !== 404) continue;
    const symbol = normalizeCode(error.symbol);
    if (symbol) notFoundUntilBySymbol[symbol] = until;
  }
  return { ...state, notFoundUntilBySymbol };
}

function writeWriterState(state) {
  if (DRY_RUN) return;
  writeJson(STATE_FILE, { ...state, updatedAt: nowIso() });
}

function apply429State(state) {
  const consecutive429Count = Math.max(0, Number(state.consecutive429Count || 0)) + 1;
  const cooldownSeconds = Math.min(COOLDOWN_MAX_SECONDS, COOLDOWN_INITIAL_SECONDS * Math.pow(2, Math.min(consecutive429Count - 1, 5)));
  const fullMarketPauseSeconds = Math.min(FULL_MARKET_PAUSE_MAX_SECONDS, Math.max(FULL_MARKET_PAUSE_MIN_SECONDS, cooldownSeconds));
  const now = Date.now();
  return {
    ...state,
    consecutive429Count,
    last429At: new Date(now).toISOString(),
    cooldownUntil: new Date(now + cooldownSeconds * 1000).toISOString(),
    priorityOnlyUntil: new Date(now + fullMarketPauseSeconds * 1000).toISOString(),
  };
}

async function fetchActiveSymbols() {
  const rows = await supabaseGetPaged(
    "stock_tickers",
    "select=symbol,name,market,stock_type,type,is_etf,is_suspended,payload&order=symbol.asc",
    { service: true },
  );
  const active = [];
  for (const row of rows) {
    const symbol = normalizeCode(row.symbol);
    if (!symbol || symbol.startsWith("00")) continue;
    if (row.is_suspended === true) continue;
    if (row.is_etf === true) continue;
    active.push({
      symbol,
      name: row.name || symbol,
      market: row.market || "",
      stockType: row.stock_type || row.type || "",
    });
  }
  active.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return active;
}

async function fetchDailyVolumeAvg() {
  try {
    const rows = await supabaseGetPaged(
      "fugle_daily_volume_avg",
      "select=symbol,market,trade_date,volume,avg_volume5,avg5_volume,updated_at,payload&order=symbol.asc",
      { service: true },
    );
    return new Map(rows.map((row) => [normalizeCode(row.symbol), {
      symbol: normalizeCode(row.symbol),
      market: row.market || "",
      trade_date: row.trade_date || null,
      volume: numberValue(row.volume),
      avg_volume5: numberValue(row.avg_volume5 ?? row.avg5_volume),
      updated_at: row.updated_at || nowIso(),
      payload: row.payload || {},
    }]).filter(([symbol]) => symbol));
  } catch {
    return new Map();
  }
}

async function fetchExistingDaytradeQuotes() {
  const quoteMap = new Map();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_quotes_live",
      "select=symbol,name,market,quote_seen_at,updated_at,last_trade_time,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_price,bid_volume,ask_price,ask_volume,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,payload&order=symbol.asc",
      { service: true },
    );
    for (const row of rows) {
      const symbol = normalizeCode(row.symbol);
      if (symbol) quoteMap.set(symbol, row);
    }
  } catch {
    // Still evaluate the WebSocket cache so a transient Supabase quote read
    // does not become a false zero-freshness gate.
  }
  mergeWebSocketQuoteCache(quoteMap);
  return quoteMap;
}

async function fetchCapitalMap() {
  const map = new Map();
  try {
    const rows = await supabaseGetPaged(
      "stock_capital_latest",
      "select=symbol,code,issued_shares,capital_shares,common_shares,shares,updated_at&order=updated_at.desc",
      { service: true, pageSize: 1000 },
    );
    for (const row of rows) {
      const symbol = normalizeCode(row.symbol || row.code);
      const issuedShares = firstNumber(row.issued_shares, row.capital_shares, row.common_shares, row.shares);
      if (symbol && issuedShares > 0 && !map.has(symbol)) map.set(symbol, { issuedShares, updated_at: row.updated_at || "" });
    }
  } catch {
    // Capital is an enrichment input for turnover ranking; missing rows must not stop the source writer.
  }
  return map;
}

async function fetchChipFlowMap() {
  const map = new Map();
  try {
    const rows = await supabaseGetPaged(
      "v_chip_flows_latest",
      "select=symbol,trade_date,foreign_net,investment_trust_net,dealer_net,institution_total_net,margin_balance,short_balance,source,updated_at&order=symbol.asc",
      { service: true, pageSize: 1000 },
    );
    for (const row of rows) {
      const symbol = normalizeCode(row.symbol);
      if (!symbol) continue;
      map.set(symbol, {
        tradeDate: row.trade_date || "",
        foreignNet: numberValue(row.foreign_net),
        trustNet: numberValue(row.investment_trust_net),
        dealerNet: numberValue(row.dealer_net),
        institutionTotalNet: numberValue(row.institution_total_net),
        marginBalance: numberValue(row.margin_balance),
        shortBalance: numberValue(row.short_balance),
        source: row.source || "v_chip_flows_latest",
        updated_at: row.updated_at || "",
      });
    }
  } catch {
    // Optional enrichment. Field coverage is reported in source_status when unavailable.
  }
  return map;
}

async function fetchMarginChangeMap() {
  const grouped = new Map();
  try {
    const rows = await supabaseGetPaged(
      "finmind_margin_short",
      "select=symbol,trade_date,margin_balance,short_balance,updated_at&order=trade_date.desc",
      { service: true, pageSize: 1000 },
    );
    for (const row of rows) {
      const symbol = normalizeCode(row.symbol);
      if (!symbol) continue;
      const list = grouped.get(symbol) || [];
      if (list.length < 2) {
        list.push({
          tradeDate: row.trade_date || "",
          marginBalance: numberValue(row.margin_balance),
          shortBalance: numberValue(row.short_balance),
          updated_at: row.updated_at || "",
        });
        grouped.set(symbol, list);
      }
    }
  } catch {
    return new Map();
  }
  const map = new Map();
  for (const [symbol, rows] of grouped.entries()) {
    const latest = rows[0] || {};
    const previous = rows[1] || {};
    map.set(symbol, {
      tradeDate: latest.tradeDate || "",
      marginBalance: numberValue(latest.marginBalance),
      shortBalance: numberValue(latest.shortBalance),
      marginChange: rows.length >= 2 ? numberValue(latest.marginBalance) - numberValue(previous.marginBalance) : 0,
      shortChange: rows.length >= 2 ? numberValue(latest.shortBalance) - numberValue(previous.shortBalance) : 0,
      updated_at: latest.updated_at || "",
    });
  }
  return map;
}

function mergeWebSocketQuoteCache(quoteMap) {
  const cache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  for (const [code, row] of cache.quotes.entries()) {
    const symbol = normalizeCode(code || row.code || row.symbol);
    if (!symbol) continue;
    if (isFinMindDiagnosticQuote(row)) continue;
    const seenAt = row.quoteSeenAt || row.updatedAt || cache.payload?.updatedAt || nowIso();
    quoteMap.set(symbol, {
      symbol,
      market: row.market || "",
      quote_seen_at: seenAt,
      updated_at: seenAt,
      last_trade_time: row.lastTradeTime || row.quoteTime || row.time || seenAt,
      price: numberValue(row.close ?? row.price),
      open_price: numberValue(row.open ?? row.openPrice),
      high_price: numberValue(row.high ?? row.highPrice),
      low_price: numberValue(row.low ?? row.lowPrice),
      previous_close: numberValue(row.previousClose ?? row.previous_close ?? row.referencePrice),
      change_percent: numberValue(row.changePercent ?? row.change_percent ?? row.percent),
      total_volume: numberValue(row.tradeVolume ?? row.total_volume),
      trade_value: numberValue(row.tradeValue ?? row.trade_value),
      bid_volume: numberValue(row.bidVolume ?? row.bid_volume),
      ask_volume: numberValue(row.askVolume ?? row.ask_volume),
      cumulative_bid_volume: numberValue(row.cumulativeBidVolume ?? row.cumulative_bid_volume),
      cumulative_ask_volume: numberValue(row.cumulativeAskVolume ?? row.cumulative_ask_volume),
      cumulative_bid_ask_volume: numberValue(row.cumulativeBidAskVolume ?? row.cumulative_bid_ask_volume),
      payload: {
        ...(row.payload || {}),
        source: "fugle-websocket-cache",
        quoteSource: row.quoteSource || row.closeSource || "fugle-ws",
        cacheUpdatedAt: cache.payload?.updatedAt || "",
      },
    });
  }
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberValue(value, NaN);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function rankMap(rows, valueFn, options = {}) {
  const minValue = Number.isFinite(Number(options.minValue)) ? Number(options.minValue) : -Infinity;
  const ranked = rows
    .map((row) => ({ symbol: row.symbol, value: Number(valueFn(row)) }))
    .filter((row) => row.symbol && Number.isFinite(row.value) && row.value > minValue)
    .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
  return new Map(ranked.map((row, index) => [row.symbol, { rank: index + 1, value: row.value }]));
}

function topRankScore(rank, top, maxScore) {
  if (!rank || rank > top) return 0;
  return Math.max(0, maxScore * (top - rank + 1) / top);
}

function quoteMetrics(symbol, dailyVolumeMap, quoteMap, supplementalMaps = {}) {
  const quote = quoteMap?.get(symbol) || {};
  const payload = quote.payload || {};
  const daily = dailyVolumeMap.get(symbol) || {};
  const dailyPayload = daily.payload || {};
  const capital = supplementalMaps.capitalMap?.get(symbol) || {};
  const chip = supplementalMaps.chipMap?.get(symbol) || {};
  const margin = supplementalMaps.marginChangeMap?.get(symbol) || {};
  const price = firstNumber(quote.price, quote.close, payload.price, payload.close);
  const previousClose = firstNumber(quote.previous_close, payload.previousClose, payload.previous_close);
  const changePercent = firstNumber(
    quote.change_percent,
    payload.changePercent,
    payload.change_percent,
    previousClose > 0 && price > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
  );
  const totalVolume = firstNumber(quote.total_volume, quote.trade_volume, payload.totalVolume, payload.tradeVolume);
  const tradeValue = firstNumber(quote.trade_value, payload.tradeValue, payload.trade_value, price > 0 ? price * totalVolume * 1000 : 0);
  const avgVolume5 = firstNumber(daily.avg_volume5, dailyPayload.avgVolume5, dailyPayload.avg_volume5, payload.avgVolume5, payload.avg_volume5);
  const volumeRatio5 = avgVolume5 > 0 ? totalVolume / avgVolume5 : 0;
  const issuedShares = firstNumber(capital.issuedShares, payload.issuedShares, payload.issued_shares, dailyPayload.issuedShares, dailyPayload.issued_shares);
  const currentTurnoverRate = issuedShares > 0 && totalVolume > 0 ? (totalVolume * 1000 / issuedShares) * 100 : 0;
  const avgTurnoverRate5 = issuedShares > 0 && avgVolume5 > 0 ? (avgVolume5 * 1000 / issuedShares) * 100 : 0;
  const highPrice = firstNumber(quote.high_price, payload.highPrice, payload.high_price, price);
  const lowPrice = firstNumber(quote.low_price, payload.lowPrice, payload.low_price, price);
  const insideVolume = firstNumber(quote.cumulative_bid_volume, payload.cumulativeBidVolume, payload.cumulative_bid_volume);
  const outsideVolume = firstNumber(quote.cumulative_ask_volume, payload.cumulativeAskVolume, payload.cumulative_ask_volume);
  const sideTotal = firstNumber(quote.cumulative_bid_ask_volume, payload.cumulativeBidAskVolume, payload.cumulative_bid_ask_volume, insideVolume + outsideVolume);
  const outsideInsideRatio = insideVolume > 0 ? outsideVolume / insideVolume : outsideVolume > 0 ? 99 : 0;
  const bidVolume = firstNumber(quote.bid_volume, payload.bidVolume, payload.bid_volume);
  const askVolume = firstNumber(quote.ask_volume, payload.askVolume, payload.ask_volume);
  const bidAskRatio = askVolume > 0 ? bidVolume / askVolume : bidVolume > 0 ? 99 : 0;
  const turnoverRate = firstNumber(
    payload.turnoverRate,
    payload.turnover_rate,
    payload.turnover_percent,
    payload.turnoverPercent,
    dailyPayload.turnoverRate,
    dailyPayload.turnover_rate,
    dailyPayload.turnover_percent,
    dailyPayload.turnoverPercent,
    currentTurnoverRate,
  );
  const turnoverRate3d = firstNumber(
    payload.turnoverRate3d,
    payload.turnover_rate_3d,
    payload.turnover3d,
    payload.avg_turnover_rate_3d,
    dailyPayload.turnoverRate3d,
    dailyPayload.turnover_rate_3d,
    dailyPayload.turnover3d,
    dailyPayload.avg_turnover_rate_3d,
    avgTurnoverRate5,
    turnoverRate,
  );
  const turnoverRate5d = firstNumber(
    payload.turnoverRate5d,
    payload.turnover_rate_5d,
    payload.turnover5d,
    payload.avg_turnover_rate_5d,
    dailyPayload.turnoverRate5d,
    dailyPayload.turnover_rate_5d,
    dailyPayload.turnover5d,
    dailyPayload.avg_turnover_rate_5d,
    avgTurnoverRate5,
    turnoverRate,
  );
  const turnoverRate3To5d = Math.max(turnoverRate3d, turnoverRate5d, turnoverRate);
  const foreignNet = firstNumber(payload.foreignNet, payload.foreign_net, payload.foreign_buy_sell, dailyPayload.foreignNet, dailyPayload.foreign_net, chip.foreignNet);
  const trustNet = firstNumber(payload.trustNet, payload.trust_net, payload.investment_trust_net, dailyPayload.trustNet, dailyPayload.trust_net, chip.trustNet);
  const dealerNet = firstNumber(payload.dealerNet, payload.dealer_net, dailyPayload.dealerNet, dailyPayload.dealer_net, chip.dealerNet);
  const mainForceNet = firstNumber(payload.mainForceNet, payload.main_force_net, payload.main_force, dailyPayload.mainForceNet, dailyPayload.main_force_net, chip.institutionTotalNet);
  const marginChange = firstNumber(payload.marginBalanceChange, payload.margin_balance_change, payload.marginChange, payload.margin_change, dailyPayload.marginBalanceChange, dailyPayload.margin_balance_change, margin.marginChange);
  const shortChange = firstNumber(payload.shortBalanceChange, payload.short_balance_change, payload.shortChange, payload.short_change, dailyPayload.shortBalanceChange, dailyPayload.short_balance_change, margin.shortChange);
  return {
    price,
    changePercent,
    totalVolume,
    tradeValue,
    avgVolume5,
    issuedShares,
    volumeRatio5,
    highPrice,
    lowPrice,
    insideVolume,
    outsideVolume,
    sideTotal,
    outsideInsideRatio,
    bidAskRatio,
    turnoverRate,
    turnoverRate3To5d,
    foreignNet,
    trustNet,
    dealerNet,
    mainForceNet,
    marginChange,
    shortChange,
    exDividend: boolValue(payload.isExDividend || payload.is_ex_dividend || payload.exDividendToday),
    daytradeCrowded: boolValue(payload.daytradeCrowded || payload.daytrade_crowded || payload.daytradeBigPlayer),
    quoteFresh: ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS,
    fieldCoverage: {
      quote: Boolean(quoteMap?.has(symbol)),
      changePercent: changePercent !== 0,
      totalVolume: totalVolume > 0,
      tradeValue: tradeValue > 0,
      avgVolume5: avgVolume5 > 0,
      issuedShares: issuedShares > 0,
      turnover3To5d: turnoverRate3To5d > 0,
      insideOutside: sideTotal > 0,
      bidAsk: bidAskRatio > 0,
      institution: foreignNet !== 0 || trustNet !== 0 || dealerNet !== 0 || mainForceNet !== 0,
      marginShort: marginChange !== 0 || shortChange !== 0,
    },
  };
}

function isFinMindDiagnosticQuote(row) {
  const payload = row?.payload || {};
  const markers = [
    row?.quoteSource,
    row?.closeSource,
    row?.realtimeFallback,
    payload.quoteSource,
    payload.closeSource,
    payload.realtimeFallback,
    payload.source,
  ].filter(Boolean).join("|").toLowerCase();
  return markers.includes("finmind")
    || row?.fallbackUsed === true
    || row?.formalPublishEligible === false
    || payload.fallbackUsed === true
    || payload.formalPublishEligible === false;
}

async function fetchIntradayStatus() {
  const toMap = (rows, readinessSource) => {
    const map = new Map(rows.map((row) => [normalizeCode(row.symbol), row]).filter(([symbol]) => symbol));
    map.readinessSource = readinessSource;
    return map;
  };
  try {
    const rows = await supabaseGetPaged(
      "v_fugle_daytrade_intraday_1m_status",
      "select=symbol,latest_candle_time,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma20_continuous,ready_ma35_continuous,latest_candle_age_seconds",
      { service: true, pageSize: 1000 },
    );
    if (rows.length) return toMap(rows, "dedicated_daytrade_intraday_1m_view_unsorted");
  } catch {
    // Fall through to the indexed table path. Avoid the old ordered view query because it can hit statement timeout.
  }
  const tradeDate = taipeiDateFrom(nowIso());
  const warmupCutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_intraday_1m",
      `select=symbol,market,candle_time,trade_date,updated_at&candle_time=gte.${encodeURIComponent(warmupCutoff)}`,
      { service: true, pageSize: 1000 },
    );
    const grouped = new Map();
    for (const row of rows) {
      const symbol = normalizeCode(row.symbol);
      if (!symbol) continue;
      const current = grouped.get(symbol) || {
        symbol,
        market: row.market || "",
        latest_candle_time: "",
        today_candle_count: 0,
        warmup_candle_count: 0,
        continuous_candle_count: 0,
        ready_ma20_continuous: false,
        ready_ma35_continuous: false,
        latest_candle_age_seconds: 999999,
      };
      const candleTime = normalizeTimestamp(row.candle_time || row.updated_at);
      if (taipeiDateFrom(candleTime) === tradeDate) current.today_candle_count += 1;
      current.warmup_candle_count += 1;
      current.continuous_candle_count += 1;
      if (candleTime && (!current.latest_candle_time || Date.parse(candleTime) > Date.parse(current.latest_candle_time))) {
        current.latest_candle_time = candleTime;
        current.latest_candle_age_seconds = ageSeconds(candleTime);
      }
      current.ready_ma20_continuous = current.continuous_candle_count >= 20;
      current.ready_ma35_continuous = current.continuous_candle_count >= 35;
      grouped.set(symbol, current);
    }
    if (grouped.size) return toMap([...grouped.values()], "dedicated_daytrade_intraday_1m_direct_warmup");
  } catch {
    return toMap([], "missing_intraday_1m_status");
  }
  return toMap([], "missing_intraday_1m_status");
}

function mergeWebSocketQuoteDerivedIntradayStatus(intradayMap, priorityRows) {
  const prioritySymbols = new Set((priorityRows || []).map((row) => normalizeCode(row.symbol)).filter(Boolean));
  if (!prioritySymbols.size) return intradayMap;
  const quoteCache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  let merged = 0;
  for (const quote of quoteCache.quotes.values()) {
    const symbol = normalizeCode(quote.symbol || quote.code);
    if (!symbol || !prioritySymbols.has(symbol)) continue;
    const seenAt = normalizeTimestamp(quote.quoteSeenAt || quote.updatedAt || quoteCache.payload?.updatedAt, "");
    if (!seenAt || ageSeconds(seenAt) > WINDOW_SECONDS) continue;
    const previous = intradayMap.get(symbol) || { symbol };
    const previousContinuous = numberValue(previous.continuous_candle_count ?? previous.candle_count);
    const previousToday = numberValue(previous.today_candle_count);
    const readyMa20 = boolValue(previous.ready_ma20_continuous) || previousContinuous >= 20;
    const readyMa35 = boolValue(previous.ready_ma35_continuous) || boolValue(previous.ready_ge_35) || previousContinuous >= 35;
    intradayMap.set(symbol, {
      ...previous,
      symbol,
      latest_candle_time: seenAt,
      today_candle_count: Math.max(previousToday, 1),
      warmup_candle_count: Math.max(numberValue(previous.warmup_candle_count), previousContinuous, readyMa35 ? 35 : readyMa20 ? 20 : 1),
      continuous_candle_count: Math.max(previousContinuous, readyMa35 ? 35 : readyMa20 ? 20 : 1),
      ready_ma20_continuous: readyMa20,
      ready_ma35_continuous: readyMa35,
      latest_candle_age_seconds: ageSeconds(seenAt),
      source: previous.source || "fugle_daytrade_writer:websocket_quote_derived_status",
    });
    merged += 1;
  }
  intradayMap.websocketQuoteDerivedStatusMerged = merged;
  intradayMap.readinessSource = `${intradayMap.readinessSource || "intraday_status"}+websocket_quote_derived_status`;
  return intradayMap;
}
async function fetchFutoptRows() {
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_futopt_quotes_live",
      "select=future_symbol,underlying_symbol,updated_at,total_volume&order=future_symbol.asc",
      { service: true },
    );
    rows.readinessSource = "dedicated_daytrade_futopt_quotes_live";
    rows.mappedCount = rows.filter((row) => normalizeCode(row.underlying_symbol) && ageSeconds(row.updated_at) <= 120).length;
    if (rows.length) return rows;
  } catch {
    // Dedicated daytrade source must not borrow shared/source-level futopt readiness.
    const out = [];
    out.readinessSource = "missing_futopt_readiness";
    out.mappedCount = 0;
    return out;
  }
  const out = [];
  out.readinessSource = "missing_futopt_readiness";
  out.mappedCount = 0;
  return out;
}

function readRuntimePrioritySeeds(activeSymbols) {
  const payload = readJson(PRIORITY_SYMBOLS_FILE, {});
  const universe = new Set(activeSymbols.map((row) => row.symbol));
  const bySymbol = new Map();
  const counts = {};
  const addMany = (source, values, weight) => {
    const list = Array.isArray(values) ? values : [];
    let accepted = 0;
    for (const value of list) {
      const symbol = normalizeCode(value?.symbol || value?.code || value);
      if (!symbol || !universe.has(symbol)) continue;
      accepted += 1;
      const prev = bySymbol.get(symbol) || { symbol, sources: [], score: 0 };
      prev.sources.push(source);
      prev.score += weight;
      bySymbol.set(symbol, prev);
    }
    counts[source] = accepted;
  };

  addMany("daytrade", payload.daytradePrioritySymbols || payload.daytradeSymbols || payload.daytrade, 120);
  addMany("terminal", payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, 100);
  addMany("opening", payload.openingPrioritySymbols || payload.primaryPrioritySymbols, 100);
  addMany("strategy1", payload.strategy1 || payload.strategy1Symbols, 90);
  addMany("strategy2", payload.strategy2 || payload.strategy2Symbols, 90);
  addMany("strategy3", payload.strategy3 || payload.strategy3Symbols, 90);
  addMany("strategy4", payload.strategy4 || payload.strategy4Symbols, 80);
  addMany("strategy5", payload.strategy5 || payload.strategy5Symbols, 80);
  addMany("institution", payload.institution || payload.institutionSymbols, 75);
  addMany("warrant", payload.warrant || payload.warrantSymbols, 70);
  addMany("cb", payload.cb || payload.cbSymbols, 60);
  addMany("realtime_radar", payload.realtimeRadar || payload.realtimeRadarSymbols, 75);
  addMany("daytrade_hot", payload.hot || payload.daytradeHotSymbols || payload.priorityStrongSymbols, 75);
  addMany("symbols", payload.symbols, 10);

  return {
    symbols: [...bySymbol.values()],
    counts,
    updatedAt: payload.updatedAt || "",
    source: payload.source || "runtime_priority_file",
  };
}

function buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap = new Map(), supplementalMaps = {}) {
  const activeBySymbol = new Map(activeSymbols.map((row) => [row.symbol, row]));
  const seeds = readRuntimePrioritySeeds(activeSymbols);
  const bySymbol = new Map();
  const candidates = activeSymbols.map((row) => ({
    ...row,
    metrics: quoteMetrics(row.symbol, dailyVolumeMap, quoteMap, supplementalMaps),
  }));
  const changeRanks = rankMap(candidates, (row) => row.metrics.changePercent, { minValue: 0 });
  const volumeSurgeRanks = rankMap(candidates, (row) => row.metrics.volumeRatio5, { minValue: 0 });
  const volumeRanks = rankMap(candidates, (row) => row.metrics.totalVolume, { minValue: 0 });
  const valueRanks = rankMap(candidates, (row) => row.metrics.tradeValue, { minValue: 0 });
  const turnoverRanks = rankMap(candidates, (row) => row.metrics.turnoverRate3To5d, { minValue: 0 });
  const rankedCandidates = candidates.map((row) => {
    const metrics = row.metrics;
    const changeRank = changeRanks.get(row.symbol)?.rank || 0;
    const volumeSurgeRank = volumeSurgeRanks.get(row.symbol)?.rank || 0;
    const volumeRank = volumeRanks.get(row.symbol)?.rank || 0;
    const valueRank = valueRanks.get(row.symbol)?.rank || 0;
    const turnoverRank = turnoverRanks.get(row.symbol)?.rank || 0;
    const reasons = [];
    let score = 0;

    score += Math.min(130, Math.log10(Math.max(1, metrics.avgVolume5)) * 30);
    score += topRankScore(changeRank, 120, 190);
    score += topRankScore(volumeSurgeRank, 120, 180);
    score += topRankScore(volumeRank, 150, 130);
    score += topRankScore(valueRank, 150, 130);
    score += topRankScore(turnoverRank, 50, 160);
    if (metrics.quoteFresh) score += 40;
    if (metrics.price > 0) score += 20;

    if (metrics.changePercent >= 3) {
      score += 170;
      reasons.push("gain_rank_gt3");
    } else if (metrics.changePercent >= 2) {
      score += 95;
      reasons.push("gain_rank_gt2");
    }
    if (metrics.volumeRatio5 >= 2) {
      score += 160;
      reasons.push("volume_surge_vs_5d_gt2");
    } else if (metrics.volumeRatio5 > 1) {
      score += 80;
      reasons.push("volume_ratio_gt1");
    }
    if (changeRank && changeRank <= 100) reasons.push(`gain_rank_top${changeRank}`);
    if (volumeSurgeRank && volumeSurgeRank <= 100) reasons.push(`volume_surge_rank_top${volumeSurgeRank}`);
    if (changeRank && changeRank <= 120 && volumeSurgeRank && volumeSurgeRank <= 120) {
      score += 230;
      reasons.push("gain_volume_surge_rank_overlap");
    }
    if (metrics.changePercent >= 2 && metrics.totalVolume >= 10000) {
      score += 140;
      reasons.push("intraday_gain_gt2_volume_gt10000");
    }
    if (metrics.volumeRatio5 >= 2 && metrics.totalVolume >= 10000 && volumeRank && volumeRank <= 100) {
      score += 210;
      reasons.push("volume_ratio_gt2_volume_rank_top100");
    }
    if (metrics.tradeValue >= 30000000) {
      score += 80;
      reasons.push("trade_value_gt3000w");
    }
    if (metrics.highPrice > 0 && metrics.price > 0 && metrics.price / metrics.highPrice >= 0.985) {
      score += 90;
      reasons.push("near_day_high");
    }
    if (metrics.lowPrice > 0 && metrics.price > 0 && ((metrics.price - metrics.lowPrice) / metrics.lowPrice) * 100 >= 2 && metrics.changePercent >= 2) {
      score += 80;
      reasons.push("rebound_from_low");
    }
    if (metrics.outsideVolume > metrics.insideVolume && metrics.sideTotal >= 1000) {
      score += 90;
      reasons.push("mitake_outside_gt_inside");
    }
    if (metrics.bidAskRatio >= 1.5) {
      score += 45;
      reasons.push("bid_ask_ratio_gt1_5");
    }
    if (metrics.turnoverRate >= 5) {
      score += 120;
      reasons.push("turnover_gt5");
    }
    if (turnoverRank && turnoverRank <= 50) {
      score += 180;
      reasons.push(`turnover_3_5d_rank_top${turnoverRank}`);
    }
    if (metrics.changePercent > 0 && (metrics.foreignNet > 0 || metrics.trustNet > 0 || metrics.dealerNet > 0 || metrics.mainForceNet > 0)) {
      score += 100;
      reasons.push("institution_or_main_force_buy_price_strong");
    }
    if (metrics.changePercent > 0 && metrics.marginChange < 0) {
      score += 70;
      reasons.push("margin_down_price_strong");
    }
    if (metrics.changePercent > 0 && metrics.marginChange > 0 && metrics.shortChange > 0) {
      score += 55;
      reasons.push("margin_short_both_up_price_strong");
    }
    if (metrics.exDividend) {
      score -= 250;
      reasons.push("exclude_ex_dividend_watch");
    }
    if (metrics.daytradeCrowded) {
      score -= 120;
      reasons.push("daytrade_crowded_watch");
    }

    return {
      ...row,
      score,
      prioritySource: "dynamic_daytrade_mother_pool",
      priorityReason: reasons.length ? reasons.join("+") : "dynamic_liquidity_fill",
      priorityMetrics: {
        changePercent: Number(metrics.changePercent.toFixed(4)),
        totalVolume: Math.round(metrics.totalVolume),
        tradeValue: Math.round(metrics.tradeValue),
        avgVolume5: Math.round(metrics.avgVolume5),
        issuedShares: Math.round(metrics.issuedShares),
        volumeRatio5: Number(metrics.volumeRatio5.toFixed(4)),
        changeRank,
        volumeSurgeRank,
        volumeRank,
        valueRank,
        turnoverRank,
        outsideVolume: Math.round(metrics.outsideVolume),
        insideVolume: Math.round(metrics.insideVolume),
        outsideInsideRatio: Number(metrics.outsideInsideRatio.toFixed(4)),
        turnoverRate: Number(metrics.turnoverRate.toFixed(4)),
        turnoverRate3To5d: Number(metrics.turnoverRate3To5d.toFixed(4)),
        quoteFresh: metrics.quoteFresh,
        fieldCoverage: metrics.fieldCoverage,
        ruleHits: reasons,
      },
    };
  }).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  for (const row of rankedCandidates) {
    if (bySymbol.size >= MOTHER_POOL_MAX_SYMBOLS) break;
    bySymbol.set(row.symbol, {
      ...row,
      score: row.score,
      prioritySource: row.prioritySource,
      priorityReason: row.priorityReason,
    });
  }
  for (const seed of seeds.symbols) {
    const row = activeBySymbol.get(seed.symbol);
    if (!row) continue;
    const prev = bySymbol.get(seed.symbol);
    if (prev) {
      prev.score += seed.score;
      prev.prioritySource = `${prev.prioritySource},${seed.sources.join(",")}`;
      prev.priorityReason = `${prev.priorityReason}+runtime_priority`;
      continue;
    }
    if (bySymbol.size >= MOTHER_POOL_MAX_SYMBOLS) continue;
    bySymbol.set(seed.symbol, {
      ...row,
      score: seed.score,
      prioritySource: seed.sources.join(","),
      priorityReason: "runtime_priority",
    });
  }

  const rows = [...bySymbol.values()]
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, MOTHER_POOL_MAX_SYMBOLS)
  const priorityUpdatedAt = nowIso();
  return rows.map((row, index) => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      market: row.market || "",
      priority_rank: index + 1,
      priority_reason: row.priorityReason || "",
      source: row.prioritySource || "unknown",
      updated_at: priorityUpdatedAt,
      payload: {
        score: numberValue(row.score),
        selected: true,
        consumerScope: ["daytrade", "strategy1", "strategy3"],
        motherPoolRuleVersion: "daytrade_mother_pool_rank_overlap_20260709",
        motherPoolMetrics: row.priorityMetrics || {},
        motherPoolRuleHits: row.priorityMetrics?.ruleHits || [],
        runtimePrioritySource: seeds.source,
        runtimePriorityUpdatedAt: seeds.updatedAt,
        runtimePriorityCounts: seeds.counts,
      },
    }));
}

function publishDaytradePrioritySymbols(priorityRows) {
  const existing = readJson(PRIORITY_SYMBOLS_FILE, {});
  const daytradePrioritySymbols = priorityRows
    .map((row) => normalizeCode(row.symbol))
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  const prependUnique = (preferred, values) => {
    const seen = new Set();
    const out = [];
    for (const value of [...preferred, ...(Array.isArray(values) ? values : [])]) {
      const code = normalizeCode(value?.symbol || value?.code || value);
      if (/^\d{4}$/.test(code) && !seen.has(code)) {
        seen.add(code);
        out.push(code);
      }
    }
    return out;
  };
  const nextPriorityPayload = {
    ...existing,
    updatedAt: nowIso(),
    source: "daytrade-dedicated-priority-bridge",
    daytradePrioritySymbols,
    daytradePriorityCount: daytradePrioritySymbols.length,
    terminalPrioritySymbols: prependUnique(daytradePrioritySymbols, existing.terminalPrioritySymbols || existing.terminalSymbols || existing.terminalPriority),
    openingPrioritySymbols: prependUnique(daytradePrioritySymbols, existing.openingPrioritySymbols || existing.primaryPrioritySymbols),
    symbols: prependUnique(daytradePrioritySymbols, existing.symbols),
  };
  writeJson(PRIORITY_SYMBOLS_FILE, nextPriorityPayload);
  writeFugleWebSocketSymbols(nextPriorityPayload.symbols, {
    source: "daytrade-dedicated-priority-bridge",
    prioritySource: "daytrade-dedicated-priority-bridge",
    daytradePriorityCount: daytradePrioritySymbols.length,
    terminalPriorityCount: nextPriorityPayload.terminalPrioritySymbols.length,
    openingPriorityCount: nextPriorityPayload.openingPrioritySymbols.length,
  });
}

function countPriorityValues(values, universe) {
  if (!Array.isArray(values)) return 0;
  const seen = new Set();
  for (const value of values) {
    const symbol = normalizeCode(value?.symbol || value?.code || value);
    if (symbol && universe.has(symbol)) seen.add(symbol);
  }
  return seen.size;
}

function readRuntimePrioritySummary(activeSymbols) {
  const payload = readJson(PRIORITY_SYMBOLS_FILE, {});
  const universe = new Set(activeSymbols.map((row) => row.symbol));
  const strategy1 = countPriorityValues(payload.strategy1 || payload.strategy1Symbols, universe);
  const strategy2 = countPriorityValues(payload.strategy2 || payload.strategy2Symbols, universe);
  const strategy3 = countPriorityValues(payload.strategy3 || payload.strategy3Symbols, universe);
  const strategy4 = countPriorityValues(payload.strategy4 || payload.strategy4Symbols, universe);
  const strategy5 = countPriorityValues(payload.strategy5 || payload.strategy5Symbols, universe);
  const institution = countPriorityValues(payload.institution || payload.institutionSymbols, universe);
  const warrant = countPriorityValues(payload.warrant || payload.warrantSymbols, universe);
  const cb = countPriorityValues(payload.cb || payload.cbSymbols, universe);
  const realtimeRadar = countPriorityValues(payload.realtimeRadar || payload.realtimeRadarSymbols, universe);
  return {
    source: payload.source || "",
    updatedAt: payload.updatedAt || "",
    daytrade: countPriorityValues(payload.daytradePrioritySymbols || payload.daytradeSymbols || payload.daytrade, universe),
    terminal: countPriorityValues(payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, universe),
    opening: countPriorityValues(payload.openingPrioritySymbols || payload.primaryPrioritySymbols, universe),
    strategy1,
    strategy2,
    strategy3,
    strategy4,
    strategy5,
    institution,
    warrant,
    cb,
    realtimeRadar,
    strategyPriority: strategy1 + strategy2 + strategy3 + strategy4 + strategy5 + institution + warrant + cb + realtimeRadar,
    total: countPriorityValues(payload.symbols, universe),
  };
}

function readWebSocketStatusSummary() {
  const status = readJson(FUGLE_WS_STATUS_FILE, {});
  return {
    ok: status.ok !== false,
    mode: status.mode || "",
    channel: status.channel || "",
    streamingChannel: status.streamingChannel || "",
    streamingChannels: Array.isArray(status.streamingChannels) ? status.streamingChannels : [],
    connected: Boolean(status.websocketConnected),
    authenticated: Boolean(status.websocketAuthenticated),
    subscribed: numberValue(status.subscribed),
    subscribedSymbols: numberValue(status.subscribedSymbols),
    subscribedChannels: numberValue(status.subscribedChannels),
    streamingMessages: numberValue(status.streamingMessages),
    streamingQuotes: numberValue(status.streamingQuotes),
    priorityDaytradeSymbols: numberValue(status.priorityDaytradeSymbols),
    priorityFileUpdatedAt: status.priorityFileUpdatedAt || "",
    restDisabled: Boolean(status.restDisabled),
    updatedAt: status.updatedAt || "",
  };
}

function selectFetchBatch(activeSymbols, priorityRows, quoteMap, state, options = {}) {
  const active = activeSymbols.map((row) => row.symbol);
  const activeSet = new Set(active);
  const priority = priorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol));
  const priorityOnly = Boolean(options.priorityOnly) || futureSeconds(state.priorityOnlyUntil) > 0 || futureSeconds(state.cooldownUntil) > 0;
  const notFoundUntilBySymbol = state.notFoundUntilBySymbol || {};
  const skippedByNotFound = (symbol) => futureSeconds(notFoundUntilBySymbol[symbol]) > 0;
  const stale = (symbol, maxAge = WINDOW_SECONDS) => ageSeconds(quoteFreshnessTime(quoteMap.get(symbol))) > maxAge;
  const selected = [];
  const selectedSet = new Set();
  const add = (symbol) => {
    if (!symbol || selectedSet.has(symbol) || !activeSet.has(symbol) || skippedByNotFound(symbol) || selected.length >= BATCH_SIZE) return;
    selected.push(symbol);
    selectedSet.add(symbol);
  };
  for (const symbol of priority) {
    if (stale(symbol, SELECTED_SYMBOL_MAX_AGE_SECONDS)) add(symbol);
  }
  if (!priorityOnly) {
    let cursor = Math.max(0, Math.min(state.cursor || 0, active.length - 1));
    for (let i = 0; i < active.length && selected.length < BATCH_SIZE; i += 1) {
      const symbol = active[(cursor + i) % active.length];
      if (priority.includes(symbol)) continue;
      if (stale(symbol, WINDOW_SECONDS)) add(symbol);
    }
    if (selected.length < BATCH_SIZE) {
      for (let i = 0; i < active.length && selected.length < BATCH_SIZE; i += 1) {
        const symbol = active[(cursor + i) % active.length];
        if (!priority.includes(symbol)) add(symbol);
      }
    }
    state.cursor = active.length ? (cursor + Math.max(1, selected.length)) % active.length : 0;
  }
  if (selected.length < BATCH_SIZE) {
    for (const symbol of priority) add(symbol);
  }
  return { symbols: selected, priorityOnly };
}

async function fetchFugleQuote(symbol) {
  const response = await fetch(`https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(symbol)}`, {
    headers: {
      "X-API-KEY": FUGLE_API_KEY,
      "User-Agent": "FumanDaytradeSourceWriter/1.0",
      "Referer": "https://developer.fugle.tw/",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
  });
  if (response.status === 429) {
    const error = new Error("429 Too Many Requests");
    error.status = 429;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Fugle quote ${symbol} HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function normalizeQuote(payload, symbol) {
  const code = normalizeCode(payload?.symbol || symbol);
  if (!code) return null;
  const bid = Array.isArray(payload?.bids) ? payload.bids[0] : null;
  const ask = Array.isArray(payload?.asks) ? payload.asks[0] : null;
  const total = payload?.total || {};
  const price = numberValue(payload?.lastPrice || payload?.closePrice || payload?.lastTrial?.price);
  const previousClose = numberValue(payload?.previousClose || payload?.referencePrice);
  const changePercent = numberValue(payload?.changePercent, previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0);
  const quoteSeenAt = nowIso();
  const quoteTime = normalizeTimestamp(payload?.lastUpdated || payload?.lastTrade?.time, quoteSeenAt);
  const lastTradeTime = normalizeTimestamp(payload?.lastTrade?.time || payload?.lastUpdated, quoteTime);
  return {
    symbol: code,
    name: payload?.name || code,
    market: payload?.market || payload?.exchange || "",
    updated_at: quoteTime,
    quote_seen_at: quoteSeenAt,
    price,
    open_price: numberValue(payload?.openPrice),
    high_price: numberValue(payload?.highPrice || price),
    low_price: numberValue(payload?.lowPrice || price),
    previous_close: previousClose || null,
    change_percent: Number.isFinite(changePercent) ? changePercent : 0,
    total_volume: toLots(total.tradeVolume || payload?.tradeVolume || payload?.volume),
    trade_value: numberValue(total.tradeValue || payload?.tradeValue),
    bid_price: numberValue(bid?.price),
    bid_volume: toLots(bid?.size),
    ask_price: numberValue(ask?.price),
    ask_volume: toLots(ask?.size),
    cumulative_bid_volume: toLots(total.tradeVolumeAtBid) || null,
    cumulative_ask_volume: toLots(total.tradeVolumeAtAsk) || null,
    cumulative_bid_ask_volume: (toLots(total.tradeVolumeAtBid) || 0) + (toLots(total.tradeVolumeAtAsk) || 0) || null,
    stock_type: payload?.type || payload?.stockType || "",
    session: payload?.session || "",
    last_trade_time: lastTradeTime,
    source: "fugle_daytrade_writer",
    payload,
  };
}

function toLots(value) {
  const number = numberValue(value);
  return number > 100000 ? Math.round((number / 1000) * 1000) / 1000 : number;
}

async function fetchQuoteBatch(symbols) {
  if (!FETCH_ENABLED || !symbols.length) return { rows: [], attempted: 0, fetched: 0, rateLimited: false, errors: [], disabledReason: FETCH_ENABLED ? "empty_batch" : "fetch_disabled" };
  if (!FUGLE_API_KEY) throw new Error("missing Fugle API key for daytrade writer fetch");
  const rows = [];
  const errors = [];
  let attempted = 0;
  let rateLimited = false;
  const started = Date.now();
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const chunk = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (symbol) => {
      attempted += 1;
      try {
        return normalizeQuote(await fetchFugleQuote(symbol), symbol);
      } catch (error) {
        if (Number(error?.status) === 429) rateLimited = true;
        errors.push({ symbol, status: error?.status || 0, message: error?.message || String(error) });
        return null;
      }
    }));
    for (const row of results) {
      if (row) rows.push(row);
    }
    if (rateLimited) break;
    if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  }
  return {
    rows,
    attempted,
    fetched: rows.length,
    rateLimited,
    errors,
    elapsedSeconds: Math.max(0.001, (Date.now() - started) / 1000),
  };
}

function computeStats({ activeSymbols, priorityRows, quoteMap, fetchedRows, dailyVolumeMap, intradayMap, futoptRows, fetchResult, state, supplementalMaps = {} }) {
  const phase = phaseNow();
  const runtimePriority = readRuntimePrioritySummary(activeSymbols);
  const webSocketStatus = readWebSocketStatusSummary();
  const formalPriorityRows = priorityRows.slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  const minFormalPrioritySymbols = Math.min(MIN_PRIORITY_POOL_SYMBOLS, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  const quoteTransport = webSocketStatus.mode === "streaming"
    ? `websocket_${(webSocketStatus.streamingChannel || "streaming").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
    : "rest_quote";
  const after0830 = ["preopen_prepare_0830_0844", "opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0845 = ["opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0900 = ["opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);

  for (const row of fetchedRows) quoteMap.set(row.symbol, row);
  const activeSet = new Set(activeSymbols.map((row) => row.symbol));
  const prioritySet = new Set(formalPriorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol)));
  const freshFull = [];
  const freshPriority = [];
  const quoteAges = [];
  const priorityAges = [];
  const freshPriorityAges = [];
  for (const symbol of activeSet) {
    const quote = quoteMap.get(symbol);
    const quoteAge = ageSeconds(quoteFreshnessTime(quote));
    if (quote) quoteAges.push(quoteAge);
    if (quoteAge <= WINDOW_SECONDS) freshFull.push(symbol);
  }
  for (const symbol of prioritySet) {
    const quote = quoteMap.get(symbol);
    const quoteAge = ageSeconds(quoteFreshnessTime(quote));
    priorityAges.push(quote ? quoteAge : 999999);
    if (quoteAge <= WINDOW_SECONDS) {
      freshPriority.push(symbol);
      freshPriorityAges.push(quoteAge);
    }
  }

  const priorityPoolSymbols = prioritySet.size;
  const activeCount = activeSet.size;
  const freshQuoteCoverage = activeCount ? freshFull.length / activeCount : 0;
  const priorityFreshCoverage = priorityPoolSymbols ? freshPriority.length / priorityPoolSymbols : 0;
  const priorityMaxAge = priorityAges.length ? Math.max(...priorityAges) : 999999;
  const priorityFreshMaxAge = freshPriorityAges.length ? Math.max(...freshPriorityAges) : 999999;
  const priorityCoverageAge = percentile(priorityAges, MIN_PRIORITY_FRESH_COVERAGE);
  const priorityStaleOrMissingSymbols = Math.max(0, priorityPoolSymbols - freshPriority.length);
  const latestQuoteAge = quoteAges.length ? Math.min(...quoteAges) : 999999;
  const selectedSymbolsFreshOk = priorityPoolSymbols >= minFormalPrioritySymbols
    && priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && priorityCoverageAge <= SELECTED_SYMBOL_MAX_AGE_SECONDS;

  let avgVolume5Eligible = 0;
  for (const symbol of prioritySet) {
    if ((dailyVolumeMap.get(symbol)?.avg_volume5 || 0) > 0) avgVolume5Eligible += 1;
  }
  const dailyVolumeCoverage = priorityPoolSymbols ? avgVolume5Eligible / priorityPoolSymbols : 0;
  const dailyVolumeStatus = avgVolume5Eligible >= Math.min(minFormalPrioritySymbols, priorityPoolSymbols || minFormalPrioritySymbols)
    || dailyVolumeCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    ? "ready"
    : "not_ready";

  let readyMa20 = 0;
  let readyMa35 = 0;
  let today1mSymbols = 0;
  let today1mRows = 0;
  let intraday1mStaleSeconds = 999999;
  for (const [symbol, row] of intradayMap.entries()) {
    if (!activeSet.has(symbol)) continue;
    const continuousCount = numberValue(row.continuous_candle_count ?? row.candle_count);
    if (boolValue(row.ready_ma20_continuous) || continuousCount >= 20) readyMa20 += 1;
    if (boolValue(row.ready_ma35_continuous) || boolValue(row.ready_ge_35) || continuousCount >= 35) readyMa35 += 1;
    if (numberValue(row.today_candle_count) > 0) today1mSymbols += 1;
    today1mRows += numberValue(row.today_candle_count);
    intraday1mStaleSeconds = Math.min(intraday1mStaleSeconds, numberValue(row.latest_candle_age_seconds, 999999));
  }
  if (intradayMap.aggregate) {
    readyMa20 = Math.max(readyMa20, numberValue(intradayMap.aggregate.readyMa20));
    readyMa35 = Math.max(readyMa35, numberValue(intradayMap.aggregate.readyMa35));
    today1mSymbols = Math.max(today1mSymbols, numberValue(intradayMap.aggregate.todaySymbols));
    today1mRows = Math.max(today1mRows, numberValue(intradayMap.aggregate.todayRows));
    intraday1mStaleSeconds = Math.min(intraday1mStaleSeconds, numberValue(intradayMap.aggregate.staleSeconds, 999999));
  }

  const futoptMapped = Number.isFinite(Number(futoptRows.mappedCount))
    ? Number(futoptRows.mappedCount)
    : futoptRows.filter((row) => normalizeCode(row.underlying_symbol) && ageSeconds(row.updated_at) <= 120).length;
  const cooldownRemaining = futureSeconds(state.cooldownUntil);
  const last429AgeSeconds = state.last429At ? ageSeconds(state.last429At) : 999999;
  const rateLimitStatus = cooldownRemaining > 0 ? "cooldown" : fetchResult.rateLimited ? "rate_limited" : "ok";
  const actualQuoteSpeed = fetchResult.elapsedSeconds ? Number((fetchResult.fetched / fetchResult.elapsedSeconds).toFixed(4)) : 0;
  const scannerCanRunQuoteOnly = selectedSymbolsFreshOk && latestQuoteAge <= MAX_QUOTE_AGE_SECONDS;
  const effectiveMa20Required = Math.min(MIN_READY_MA20_CONTINUOUS, Math.max(minFormalPrioritySymbols, priorityPoolSymbols || minFormalPrioritySymbols));
  const effectiveMa35Required = Math.min(MIN_READY_MA35_CONTINUOUS, Math.max(minFormalPrioritySymbols, priorityPoolSymbols || minFormalPrioritySymbols));
  const scannerCanRunOpening = scannerCanRunQuoteOnly
    && dailyVolumeStatus === "ready"
    && readyMa20 >= effectiveMa20Required
    && readyMa35 >= effectiveMa35Required
    && (!after0845 || futoptMapped >= MIN_FUTOPT_MAPPED)
    && (!after0900 || intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);

  const priorityGateA = sourceGateA({
    after0830,
    after0845,
    after0900,
    selectedSymbolsFreshOk,
    priorityPoolSymbols,
    priorityFreshCoverage,
    quoteAgeSeconds: priorityCoverageAge,
    cooldownRemaining,
    last429AgeSeconds,
    dailyVolumeStatus,
    readyMa20,
    readyMa35,
    effectiveMa20Required,
    effectiveMa35Required,
    futoptMapped,
    intraday1mStaleSeconds,
    scannerCanRunOpening,
    minPriorityPoolSymbols: minFormalPrioritySymbols,
  });
  const fullMarketGateA = freshFull.length >= TARGET_FRESH_QUOTES && freshQuoteCoverage >= MIN_FRESH_QUOTE_COVERAGE;
  const motherRuleCounts = {};
  const motherFieldCoverageCounts = {};
  for (const row of priorityRows) {
    const hits = Array.isArray(row.payload?.motherPoolRuleHits) ? row.payload.motherPoolRuleHits : [];
    for (const hit of hits) motherRuleCounts[hit] = (motherRuleCounts[hit] || 0) + 1;
    const coverage = row.payload?.motherPoolMetrics?.fieldCoverage || {};
    for (const [field, ok] of Object.entries(coverage)) {
      if (ok) motherFieldCoverageCounts[field] = (motherFieldCoverageCounts[field] || 0) + 1;
    }
  }
  const motherPoolRuleHitSymbols = priorityRows
    .filter((row) => (row.payload?.motherPoolRuleHits || []).length)
    .slice(0, 40)
    .map((row) => row.symbol);
  const gateGrade = priorityGateA ? "A" : selectedSymbolsFreshOk ? "B" : freshFull.length > 0 ? "C" : "D";
  const offSession = ["closed_before_0600", "after_daytrade_window"].includes(phase);
  const status = offSession ? "stopped" : gateGrade === "A" ? "ok" : gateGrade === "B" || gateGrade === "C" ? "degraded" : "stale";
  const message = offSession
    ? `dedicated daytrade source stopped off-session; latest formal entry disabled; priority=${freshPriority.length}/${priorityPoolSymbols} full=${freshFull.length}/${activeCount}`
    : gateGrade === "A"
    ? "dedicated daytrade source priority gate A"
    : `dedicated daytrade source ${gateGrade}; priority=${freshPriority.length}/${priorityPoolSymbols} full=${freshFull.length}/${activeCount} rate=${rateLimitStatus}`;

  const payload = {
    source_name: SOURCE_NAME,
    writer_version: "daytrade-source-writer-20260702-03",
    daytrade_gate_grade: gateGrade,
    daytrade_source_speed_ok: gateGrade === "A",
    gate_mode: "priority_first",
    priority_gate_grade: priorityGateA ? "A" : selectedSymbolsFreshOk ? "B" : "D",
    full_market_gate_grade: fullMarketGateA ? "A" : "C",
    fresh_quote_window_seconds: WINDOW_SECONDS,
    fresh_quotes_120s: freshFull.length,
    fresh_quote_coverage_120s: Number(freshQuoteCoverage.toFixed(4)),
    active_symbols: activeCount,
    quote_age_seconds: priorityPoolSymbols ? priorityCoverageAge : latestQuoteAge,
    priority_quote_age_p95_seconds: priorityCoverageAge,
    priority_fresh_max_quote_age_seconds: priorityFreshMaxAge,
    priority_max_quote_age_seconds: priorityMaxAge,
    priority_stale_or_missing_symbols: priorityStaleOrMissingSymbols,
    required_quote_speed_per_sec: REQUIRED_SYMBOLS_PER_SECOND,
    actual_quote_speed_per_sec: actualQuoteSpeed,
    quote_transport: quoteTransport,
    websocket_status_ok: webSocketStatus.ok,
    websocket_mode: webSocketStatus.mode,
    websocket_channel: webSocketStatus.channel,
    websocket_streaming_channel: webSocketStatus.streamingChannel,
    websocket_streaming_channels: webSocketStatus.streamingChannels,
    websocket_connected: webSocketStatus.connected,
    websocket_authenticated: webSocketStatus.authenticated,
    websocket_subscribed: webSocketStatus.subscribed,
    websocket_subscribed_symbols: webSocketStatus.subscribedSymbols,
    websocket_subscribed_channels: webSocketStatus.subscribedChannels,
    websocket_streaming_messages: webSocketStatus.streamingMessages,
    websocket_streaming_quotes: webSocketStatus.streamingQuotes,
    websocket_rest_disabled: webSocketStatus.restDisabled,
    websocket_priority_daytrade_symbols: webSocketStatus.priorityDaytradeSymbols,
    websocket_priority_file_updated_at: webSocketStatus.priorityFileUpdatedAt,
    websocket_status_updated_at: webSocketStatus.updatedAt,
    runtime_priority_source: runtimePriority.source,
    runtime_priority_updated_at: runtimePriority.updatedAt,
    daytrade_priority_symbols: runtimePriority.daytrade,
    terminal_priority_symbols: runtimePriority.terminal,
    opening_priority_symbols: runtimePriority.opening,
    strategy_priority_symbols: runtimePriority.strategyPriority,
    strategy1_priority_symbols: runtimePriority.strategy1,
    strategy2_priority_symbols: runtimePriority.strategy2,
    strategy3_priority_symbols: runtimePriority.strategy3,
    strategy4_priority_symbols: runtimePriority.strategy4,
    strategy5_priority_symbols: runtimePriority.strategy5,
    institution_priority_symbols: runtimePriority.institution,
    warrant_priority_symbols: runtimePriority.warrant,
    cb_priority_symbols: runtimePriority.cb,
    realtime_radar_priority_symbols: runtimePriority.realtimeRadar,
    batch_size: BATCH_SIZE,
    batch_interval_seconds: TARGET_BATCH_INTERVAL_SECONDS,
    priority_symbols: priorityPoolSymbols,
    priority_pool_symbols: priorityPoolSymbols,
    formal_scope: "priority_top40",
    mother_pool_rule_version: "daytrade_mother_pool_rank_overlap_20260709",
    mother_pool_symbols: priorityRows.length,
    mother_pool_source: "dynamic_daytrade_mother_pool",
    mother_pool_capital_rows: supplementalMaps.capitalMap?.size || 0,
    mother_pool_chip_rows: supplementalMaps.chipMap?.size || 0,
    mother_pool_margin_change_rows: supplementalMaps.marginChangeMap?.size || 0,
    mother_pool_rule_hit_symbols: motherPoolRuleHitSymbols,
    mother_pool_rule_hit_counts: motherRuleCounts,
    mother_pool_field_coverage_counts: motherFieldCoverageCounts,
    formal_daytrade_priority_limit: FORMAL_DAYTRADE_PRIORITY_LIMIT,
    formal_daytrade_priority_symbols: priorityPoolSymbols,
    priority_fresh_quotes_120s: freshPriority.length,
    priority_fresh_quote_coverage_120s: Number(priorityFreshCoverage.toFixed(4)),
    selected_symbols_fresh_ok: selectedSymbolsFreshOk,
    eligible_quote_rows: freshFull.length,
    scanner_can_run_opening: scannerCanRunOpening,
    scanner_can_run_quote_only: scannerCanRunQuoteOnly,
    daily_volume_status: dailyVolumeStatus,
    avg_volume5_eligible: avgVolume5Eligible,
    avg_volume5_coverage: Number(dailyVolumeCoverage.toFixed(4)),
    ready_ma20_continuous: readyMa20,
    ready_ma35_continuous: readyMa35,
    ready_ma20_required: effectiveMa20Required,
    ready_ma35_required: effectiveMa35Required,
    intraday_1m_stale_seconds: intraday1mStaleSeconds,
    today_1m_symbols: today1mSymbols,
    today_1m_rows: today1mRows,
    futopt_stock_mapped: futoptMapped,
    intraday_1m_readiness_source: intradayMap.readinessSource || "unknown",
    futopt_readiness_source: futoptRows.readinessSource || "unknown",
    rate_limit_status: rateLimitStatus,
    last_429_at: state.last429At || null,
    cooldown_until: state.cooldownUntil || null,
    full_market_round_seconds: fetchedRows.length > 0 ? Math.ceil(activeCount / Math.max(0.001, actualQuoteSpeed)) : 999999,
    full_market_batch_interval_seconds: TARGET_BATCH_INTERVAL_SECONDS,
    full_market_paused_until: state.priorityOnlyUntil || null,
    finmind_cooldown_until: null,
    last_429_age_seconds: last429AgeSeconds,
    quota_competing_stages: [],
    self_heal_count: state.selfHealCount || 0,
    last_self_heal_at: state.lastSelfHealAt || null,
    last_self_heal_reason: state.lastSelfHealReason || "",
    phase,
    off_session: offSession,
    formal_entry_allowed: !offSession && gateGrade === "A",
    latest_update_allowed: !offSession && gateGrade === "A",
    preserve_previous_good: offSession || gateGrade !== "A",
    apply_mode: APPLY,
    fetch_enabled: FETCH_ENABLED,
    quote_fetch_allowed_for_phase: quoteFetchAllowedForPhase(phase),
    quote_freshness_basis: "market_updated_at",
    fetch_disabled_reason: fetchResult.disabledReason || "",
    fetched_this_loop: fetchResult.fetched,
    attempted_this_loop: fetchResult.attempted,
  };
  return { phase, gateGrade, status, message, payload };
}

function sourceGateA(values) {
  return values.selectedSymbolsFreshOk
    && values.priorityPoolSymbols >= (values.minPriorityPoolSymbols || MIN_PRIORITY_POOL_SYMBOLS)
    && values.priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && values.quoteAgeSeconds <= MAX_QUOTE_AGE_SECONDS
    && (values.cooldownRemaining <= 0 || values.priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE)
    && (values.priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE || values.last429AgeSeconds > RECENT_429_BLOCK_SECONDS)
    && (!values.after0830 || values.dailyVolumeStatus === "ready")
    && (!values.after0845 || values.scannerCanRunOpening)
    && (!values.after0845 || values.readyMa20 >= (values.effectiveMa20Required || MIN_READY_MA20_CONTINUOUS))
    && (!values.after0845 || values.readyMa35 >= (values.effectiveMa35Required || MIN_READY_MA35_CONTINUOUS))
    && (!values.after0845 || values.futoptMapped >= MIN_FUTOPT_MAPPED)
    && (!values.after0900 || values.intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);
}

async function writeStatusAndScorecard(result) {
  const nonFatalWriteErrors = result.payload.nonfatal_write_errors || [];
  const sourceRow = {
    source_name: SOURCE_NAME,
    trade_date: taipeiDate(),
    updated_at: nowIso(),
    status: result.status,
    message: result.message,
    stale_seconds: numberValue(result.payload.quote_age_seconds, 999999),
    payload: result.payload,
  };
  if (result.status === "ok") sourceRow.last_success_at = nowIso();

  const scorecardRow = {
    trade_date: taipeiDate(),
    source_name: SOURCE_NAME,
    gate_grade: result.gateGrade,
    status: result.status,
    fresh_quotes_120s: result.payload.fresh_quotes_120s,
    fresh_quote_coverage_120s: result.payload.fresh_quote_coverage_120s,
    active_symbols: result.payload.active_symbols,
    quote_age_seconds: result.payload.quote_age_seconds,
    required_quote_speed_per_sec: result.payload.required_quote_speed_per_sec,
    actual_quote_speed_per_sec: result.payload.actual_quote_speed_per_sec,
    priority_symbols: result.payload.priority_symbols,
    priority_pool_symbols: result.payload.priority_pool_symbols,
    priority_fresh_quote_coverage_120s: result.payload.priority_fresh_quote_coverage_120s,
    selected_symbols_fresh_ok: result.payload.selected_symbols_fresh_ok,
    scanner_can_run_opening: result.payload.scanner_can_run_opening,
    scanner_can_run_quote_only: result.payload.scanner_can_run_quote_only,
    daily_volume_status: result.payload.daily_volume_status,
    avg_volume5_eligible: result.payload.avg_volume5_eligible,
    ready_ma20_continuous: result.payload.ready_ma20_continuous,
    ready_ma35_continuous: result.payload.ready_ma35_continuous,
    intraday_1m_stale_seconds: result.payload.intraday_1m_stale_seconds,
    today_1m_symbols: result.payload.today_1m_symbols,
    today_1m_rows: result.payload.today_1m_rows,
    futopt_stock_mapped: result.payload.futopt_stock_mapped,
    rate_limit_status: result.payload.rate_limit_status,
    last_429_at: result.payload.last_429_at,
    cooldown_until: result.payload.cooldown_until,
    self_heal_count: result.payload.self_heal_count,
    message: result.message,
    payload: result.payload,
  };
  try {
    await supabaseInsert("fugle_daytrade_source_speed_scorecard", [scorecardRow]);
  } catch (error) {
    nonFatalWriteErrors.push({
      target: "fugle_daytrade_source_speed_scorecard",
      message: error?.message || String(error),
    });
    result.payload.nonfatal_write_errors = nonFatalWriteErrors;
    sourceRow.payload = result.payload;
  }

  await supabaseUpsert("source_status", [sourceRow], "source_name");
}

async function syncDailyVolumeMirror(dailyVolumeMap, priorityRows) {
  const rows = priorityRows.map((priority) => {
    const row = dailyVolumeMap.get(priority.symbol);
    if (!row) return null;
    return {
      symbol: priority.symbol,
      market: row.market || priority.market || "",
      trade_date: row.trade_date,
      volume: row.volume,
      avg_volume5: row.avg_volume5,
      updated_at: row.updated_at || nowIso(),
      source: "fugle_daytrade_writer:daily_volume_avg_mirror",
      payload: row.payload || {},
    };
  }).filter(Boolean);
  await supabaseUpsert("fugle_daytrade_daily_volume_avg", rows, "symbol");
}

async function syncWebSocketIntraday1mCandles(priorityRows) {
  const prioritySymbols = new Set(priorityRows.map((row) => normalizeCode(row.symbol)).filter(Boolean));
  const cache = readFugleWebSocketCandles({ maxAgeMs: WEBSOCKET_CANDLE_MAX_AGE_MS });
  const rows = [];
  for (const candle of cache.candles.values()) {
    const symbol = normalizeCode(candle.symbol || candle.code);
    if (!symbol || (prioritySymbols.size && !prioritySymbols.has(symbol))) continue;
    const candleTime = normalizeTimestamp(candle.candleTime || candle.date);
    if (!candleTime || !numberValue(candle.close)) continue;
    rows.push({
      symbol,
      market: candle.market || "",
      candle_time: candleTime,
      trade_date: candle.tradeDate || taipeiDateFrom(candleTime),
      open: numberValue(candle.open),
      high: numberValue(candle.high),
      low: numberValue(candle.low),
      close: numberValue(candle.close),
      volume: numberValue(candle.volume),
      source: "fugle_daytrade_writer:websocket_candles",
      updated_at: candle.candleSeenAt || cache.payload?.updatedAt || nowIso(),
      payload: {
        ...(candle.payload || {}),
        cacheUpdatedAt: cache.payload?.updatedAt || "",
        source: "fugle-websocket-candles-cache",
      },
    });
  }
  const quoteCache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  const rowKeys = new Set(rows.map((row) => `${row.symbol}|${row.candle_time}`));
  const candleRowCount = rows.length;
  for (const quote of quoteCache.quotes.values()) {
    const symbol = normalizeCode(quote.symbol || quote.code);
    if (!symbol || (prioritySymbols.size && !prioritySymbols.has(symbol))) continue;
    const seenAt = normalizeTimestamp(quote.quoteSeenAt || quote.updatedAt || quoteCache.payload?.updatedAt, nowIso());
    const seenDate = new Date(seenAt);
    if (!Number.isFinite(seenDate.getTime())) continue;
    seenDate.setSeconds(0, 0);
    const candleTime = seenDate.toISOString();
    const key = `${symbol}|${candleTime}`;
    if (rowKeys.has(key)) continue;
    const close = numberValue(quote.close ?? quote.price);
    if (!close) continue;
    rowKeys.add(key);
    rows.push({
      symbol,
      market: quote.market || "",
      candle_time: candleTime,
      trade_date: taipeiDateFrom(candleTime),
      open: close,
      high: close,
      low: close,
      close,
      volume: numberValue(quote.tradeVolume ?? quote.total_volume ?? quote.volume),
      source: "fugle_daytrade_writer:websocket_quote_derived_1m",
      updated_at: seenAt,
      payload: {
        ...(quote.payload || {}),
        quoteSeenAt: seenAt,
        cacheUpdatedAt: quoteCache.payload?.updatedAt || "",
        source: "fugle-websocket-quote-derived-current-1m",
      },
    });
  }
  if (!rows.length) return { written: 0, skipped: true, cacheCount: cache.candles.size, quoteDerivedCount: 0 };
  await supabaseUpsert("fugle_daytrade_intraday_1m", rows, "symbol,candle_time");
  return {
    written: rows.length,
    skipped: false,
    cacheCount: cache.candles.size,
    quoteDerivedCount: Math.max(0, rows.length - candleRowCount),
  };
}

async function syncWebSocketFutoptQuotes() {
  const cache = readFugleFutoptWebSocketQuotes({ maxAgeMs: FUTOPT_WEBSOCKET_MAX_AGE_MS });
  const rows = [];
  for (const quote of cache.quotes.values()) {
    const futureSymbol = String(quote.future_symbol || "").trim().toUpperCase();
    if (!futureSymbol) continue;
    const price = numberValue(quote.last_price ?? quote.price);
    if (!price) continue;
    rows.push({
      future_symbol: futureSymbol,
      underlying_symbol: normalizeCode(quote.underlying_symbol) || (futureSymbol.startsWith("TXF") ? "TXF" : null),
      underlying_name: quote.underlying_name || null,
      updated_at: normalizeTimestamp(quote.quoteSeenAt || cache.payload?.updatedAt, nowIso()),
      last_price: price,
      open_price: numberValue(quote.open_price),
      high_price: numberValue(quote.high_price || price),
      low_price: numberValue(quote.low_price || price),
      previous_close: numberValue(quote.previous_close),
      change_percent: numberValue(quote.change_percent),
      total_volume: numberValue(quote.total_volume ?? quote.volume),
      product: quote.product || (futureSymbol.startsWith("TXF") ? "TXF" : "STOCK_FUTURE"),
      session: quote.session || "",
      source: "fugle_daytrade_writer:futopt_websocket",
      payload: {
        ...(quote.payload || {}),
        product: quote.product || "",
        session: quote.session || "",
        underlying_name: quote.underlying_name || "",
        marketUpdatedAt: quote.updated_at || "",
        cacheUpdatedAt: cache.payload?.updatedAt || "",
        source: "fugle-futopt-websocket-cache",
      },
    });
  }
  if (!rows.length) return { written: 0, skipped: true, cacheCount: cache.quotes.size };
  await supabaseUpsert("fugle_daytrade_futopt_quotes_live", rows, "future_symbol");
  return { written: rows.length, skipped: false, cacheCount: cache.quotes.size };
}

async function tick() {
  const state = readWriterState();
  const phase = phaseNow();
  const fetchAllowedForPhase = quoteFetchAllowedForPhase(phase);
  const fetchPriorityOnlyForPhase = quoteFetchPriorityOnlyForPhase(phase);
  const activeSymbols = await fetchActiveSymbols();
  const dailyVolumeMap = await fetchDailyVolumeAvg();
  const quoteMap = await fetchExistingDaytradeQuotes();
  const [capitalMap, chipMap, marginChangeMap] = await Promise.all([
    fetchCapitalMap(),
    fetchChipFlowMap(),
    fetchMarginChangeMap(),
  ]);
  const supplementalMaps = { capitalMap, chipMap, marginChangeMap };
  const priorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, supplementalMaps);
  const nonFatalWriteErrors = [];
  let websocketCandleSync = { written: 0, skipped: true, cacheCount: 0 };
  let websocketFutoptSync = { written: 0, skipped: true, cacheCount: 0 };

  if (priorityRows.length) {
    try {
      publishDaytradePrioritySymbols(priorityRows);
    } catch (error) {
      nonFatalWriteErrors.push({
        target: "fugle-ws-priority-symbols.json",
        message: error?.message || String(error),
      });
    }
    try {
      await supabaseUpsert("fugle_daytrade_priority_pool", priorityRows, "symbol");
      await supabaseDelete(
        "fugle_daytrade_priority_pool",
        `updated_at=lt.${encodeURIComponent(priorityRows[0].updated_at)}`,
      );
    } catch (error) {
      nonFatalWriteErrors.push({
        target: "fugle_daytrade_priority_pool",
        message: error?.message || String(error),
      });
    }
    try {
      await syncDailyVolumeMirror(dailyVolumeMap, priorityRows);
    } catch (error) {
      nonFatalWriteErrors.push({
        target: "fugle_daytrade_daily_volume_avg",
        message: error?.message || String(error),
      });
    }
    try {
      websocketCandleSync = await syncWebSocketIntraday1mCandles(priorityRows);
    } catch (error) {
      nonFatalWriteErrors.push({
        target: "fugle_daytrade_intraday_1m",
        message: error?.message || String(error),
      });
    }
  }
  try {
    websocketFutoptSync = await syncWebSocketFutoptQuotes();
  } catch (error) {
    nonFatalWriteErrors.push({
      target: "fugle_daytrade_futopt_quotes_live",
      message: error?.message || String(error),
    });
  }

  const intradayMap = mergeWebSocketQuoteDerivedIntradayStatus(await fetchIntradayStatus(), priorityRows);
  const futoptRows = await fetchFutoptRows();

  const cooldownActive = futureSeconds(state.cooldownUntil) > 0;
  const selected = cooldownActive || !fetchAllowedForPhase
    ? { symbols: [], priorityOnly: true }
    : selectFetchBatch(activeSymbols, priorityRows, quoteMap, state, { priorityOnly: true });
  const fetchResult = fetchAllowedForPhase
    ? await fetchQuoteBatch(selected.symbols)
    : { rows: [], attempted: 0, fetched: 0, rateLimited: false, errors: [], disabledReason: `phase_${phase}_fetch_disabled` };
  fetchResult.errors = [...(fetchResult.errors || []), ...nonFatalWriteErrors];
  if (fetchResult.rows.length) await supabaseUpsert("fugle_daytrade_quotes_live", fetchResult.rows, "symbol");

  let nextState = { ...state };
  if (fetchResult.rateLimited) {
    nextState = apply429State(nextState);
  } else if (!cooldownActive) {
    nextState.consecutive429Count = Math.max(0, nextState.consecutive429Count - 1);
  }
  nextState = applyQuoteNotFoundState(nextState, fetchResult.errors);
  writeWriterState(nextState);

  const result = computeStats({
    activeSymbols,
    priorityRows,
    quoteMap,
    fetchedRows: fetchResult.rows,
    dailyVolumeMap,
    intradayMap,
    futoptRows,
    fetchResult,
    state: nextState,
    supplementalMaps,
  });
  result.payload.nonfatal_write_errors = fetchResult.errors || [];
  result.payload.websocket_candles_synced_rows = websocketCandleSync.written || 0;
  result.payload.websocket_candles_cache_count = websocketCandleSync.cacheCount || 0;
  result.payload.websocket_candles_sync_skipped = Boolean(websocketCandleSync.skipped);
  result.payload.futopt_websocket_synced_rows = websocketFutoptSync.written || 0;
  result.payload.futopt_websocket_cache_count = websocketFutoptSync.cacheCount || 0;
  result.payload.futopt_websocket_sync_skipped = Boolean(websocketFutoptSync.skipped);
  await writeStatusAndScorecard(result);
  const offSession = Boolean(result.payload.off_session);
  return {
    ok: result.gateGrade === "A" || offSession,
    mode: APPLY ? "apply" : "dry-run",
    fetchEnabled: FETCH_ENABLED,
    sourceName: SOURCE_NAME,
    phase: result.phase,
    gateGrade: result.gateGrade,
    status: result.status,
    offSession,
    formalEntryAllowed: Boolean(result.payload.formal_entry_allowed),
    priorityPoolSymbols: result.payload.priority_pool_symbols,
    motherPoolSymbols: result.payload.mother_pool_symbols,
    motherPoolMinSymbols: MOTHER_POOL_MIN_SYMBOLS,
    motherPoolMaxSymbols: MOTHER_POOL_MAX_SYMBOLS,
    motherPoolRuleVersion: result.payload.mother_pool_rule_version,
    motherPoolRuleHitCounts: result.payload.mother_pool_rule_hit_counts,
    priorityFreshQuoteCoverage120s: result.payload.priority_fresh_quote_coverage_120s,
    freshQuotes120s: result.payload.fresh_quotes_120s,
    freshQuoteCoverage120s: result.payload.fresh_quote_coverage_120s,
    quoteAgeSeconds: result.payload.quote_age_seconds,
    actualQuoteSpeedPerSec: result.payload.actual_quote_speed_per_sec,
    dailyVolumeStatus: result.payload.daily_volume_status,
    readyMa20Continuous: result.payload.ready_ma20_continuous,
    readyMa35Continuous: result.payload.ready_ma35_continuous,
    intraday1mReadinessSource: result.payload.intraday_1m_readiness_source,
    futoptStockMapped: result.payload.futopt_stock_mapped,
    futoptReadinessSource: result.payload.futopt_readiness_source,
    rateLimitStatus: result.payload.rate_limit_status,
    attemptedThisLoop: fetchResult.attempted,
    fetchedThisLoop: fetchResult.fetched,
    errors: fetchResult.errors?.slice(0, 5) || [],
    message: result.message,
  };
}

async function main() {
  if (LOCAL_CHECK) {
    console.log(JSON.stringify({
      ok: true,
      mode: "local-check",
      sourceName: SOURCE_NAME,
      applyDefault: APPLY,
      fetchEnabled: FETCH_ENABLED,
      runtimeConfigFile: RUNTIME_CONFIG_FILE,
      repoConfigFile: REPO_CONFIG_FILE,
      prioritySymbolsFile: PRIORITY_SYMBOLS_FILE,
      batchSize: BATCH_SIZE,
      concurrency: CONCURRENCY,
      targetBatchIntervalSeconds: TARGET_BATCH_INTERVAL_SECONDS,
      requestDelayMs: REQUEST_DELAY_MS,
      maxRunSeconds: MAX_RUN_SECONDS,
      minPriorityPoolSymbols: MIN_PRIORITY_POOL_SYMBOLS,
      maxPriorityPoolSymbols: MAX_PRIORITY_POOL_SYMBOLS,
      formalDaytradePriorityLimit: FORMAL_DAYTRADE_PRIORITY_LIMIT,
      motherPoolMinSymbols: MOTHER_POOL_MIN_SYMBOLS,
      motherPoolMaxSymbols: MOTHER_POOL_MAX_SYMBOLS,
    }, null, 2));
    return;
  }

  if (!APPLY) {
    console.error("[daytrade-source-writer] dry-run mode: no Supabase writes. Use --apply only in an approved release-owner window.");
  }
  if (!FETCH_ENABLED) {
    console.log("[daytrade-source-writer] REST quote fetch disabled; continuing with WebSocket/cache-only writer.");
  }

  const runStartedAt = Date.now();
  do {
    const started = Date.now();
    const result = await tick();
    console.log(JSON.stringify(result, null, 2));
    if (ONCE) break;
    if (MAX_RUN_SECONDS > 0 && (Date.now() - runStartedAt) / 1000 >= MAX_RUN_SECONDS) break;
    const elapsed = Math.ceil((Date.now() - started) / 1000);
    const sleepMs = Math.max(1000, (LOOP_SECONDS - elapsed) * 1000);
    if (MAX_RUN_SECONDS > 0 && (Date.now() + sleepMs - runStartedAt) / 1000 >= MAX_RUN_SECONDS) break;
    await sleep(sleepMs);
  } while (true);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    sourceName: SOURCE_NAME,
    mode: APPLY ? "apply" : "dry-run",
    error: error.message || String(error),
    checkedAt: nowIso(),
  }, null, 2));
  process.exit(1);
});
