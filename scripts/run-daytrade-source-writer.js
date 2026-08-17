process.env.FUGLE_COLLECTOR_ROLE = process.env.FUGLE_COLLECTOR_ROLE || "daytrade";
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
const { readSnapshot } = require("../lib/supabase-snapshots");

const SOURCE_NAME = process.env.DAYTRADE_SOURCE_NAME || "fugle_daytrade_source";
const SOURCE_HOST_ID = String(process.env.FUMAN_DAYTRADE_SOURCE_HOST_ID || process.env.FUMAN_SOURCE_HOST_ID || process.env.COMPUTERNAME || "unknown").trim();
const SOURCE_HOST_ROLE = String(process.env.FUMAN_DAYTRADE_SOURCE_ROLE || (process.env.FUMAN_DAYTRADE_WRITER_APPLY ? "" : "reader")).trim().toLowerCase();
const WRITER_INSTANCE_ID = String(process.env.FUMAN_DAYTRADE_WRITER_INSTANCE_ID || (SOURCE_HOST_ID && SOURCE_HOST_ID !== "unknown" ? SOURCE_HOST_ID + ":daytrade-writer" : "")).trim();
const WRITER_LEASE_SECONDS = Math.max(60, Math.min(600, Number(process.env.FUMAN_DAYTRADE_WRITER_LEASE_SECONDS || 240)));
const WRITER_LEASE_REQUIRED = process.env.FUMAN_DAYTRADE_WRITER_LEASE_REQUIRED !== "0";
const SOURCE_HOST_APPROVAL_FILE = runtimePath("config", "daytrade-source-host-approval.json");
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const STATE_FILE = statePath("daytrade-source-writer-state.json");
const ENRICHMENT_PENDING_STATE_FILE = statePath("daytrade-source-writer-enrichment-pending.json");
const MOTHER_POOL_DELTA_STATE_FILE = statePath("daytrade-mother-pool-delta.json");
const RUNTIME_CONFIG_FILE = runtimePath("config", "daytrade-source-speed.json");
const REPO_CONFIG_FILE = repoPath("ops", "public-slot", "daytrade-source-speed.config.example.json");
const PRIORITY_SYMBOLS_FILE = process.env.FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE || cachePath("intraday", "fugle-daytrade-ws-priority-symbols.json");
const STRATEGY_PRIORITY_BRIDGE_CACHE_FILE = cachePath("intraday", "fugle-strategy-chip-priority-bridge.json");
const STRATEGY_PRIORITY_BRIDGE_REFRESH_MS = Math.max(
  60000,
  Number(process.env.DAYTRADE_STRATEGY_PRIORITY_BRIDGE_REFRESH_MS || 300000),
);
const STRATEGY_PRIORITY_BRIDGE_MAX_ROWS = Math.max(
  40,
  Math.min(300, Number(process.env.DAYTRADE_STRATEGY_PRIORITY_BRIDGE_MAX_ROWS || 160)),
);
let lastStrategyPriorityBridgeRefreshAt = 0;
let strategyPriorityBridgeRefreshPromise = null;

const STRATEGY_PRIORITY_BRIDGE_SOURCES = [
  {
    key: "strategy3",
    latestResource: "v_strategy3_latest_complete_run",
    latestQuery: "select=*&limit=1",
    resultsResource: "strategy3_scan_results",
    resultSelect: "code,rank,score,complete,quality_status,scan_date,run_id,payload",
    codeMode: "stock",
  },
  {
    key: "strategy4",
    latestResource: "strategy4_scan_runs",
    latestQuery: "select=*&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1",
    resultsResource: "strategy4_scan_results",
    resultSelect: "code,rank,score,complete,quality_status,scan_date,run_id,payload",
    codeMode: "stock",
  },
  {
    key: "strategy5",
    latestResource: "v_strategy5_latest_complete_run",
    latestQuery: "select=*&limit=1",
    resultsResource: "strategy5_scan_results",
    resultSelect: "code,rank,score,complete,quality_status,scan_date,run_id,payload",
    codeMode: "stock",
  },
  {
    key: "institution",
    latestResource: "v_institution_latest_complete_run",
    latestQuery: "select=*&limit=1",
    resultsResource: "institution_scan_results",
    resultSelect: "code,rank,complete,quality_status,scan_date,run_id,payload",
    codeMode: "stock",
  },
  {
    key: "warrant",
    latestResource: "v_warrant_flow_latest_complete_run",
    latestQuery: "select=*&limit=1",
    resultsResource: "warrant_flow_scan_results",
    resultSelect: "code,underlying_code,rank,score,complete,quality_status,scan_date,run_id,payload",
    codeMode: "underlying",
  },
  {
    key: "cb",
    latestResource: "cb_detect_scan_runs",
    latestQuery: "select=*&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1",
    resultsResource: "cb_detect_scan_results",
    resultSelect: "symbol,payload,run_id,scan_date,updated_at",
    codeMode: "underlying",
  },
];
const WARMUP_EVIDENCE_DIR = process.env.DAYTRADE_UNATTENDED_OUTPUT_DIR || "C:/Users/ginov/Documents/Codex/buy-sell-autonomy-main/outputs";
const HEATMAP_LATEST_FILES = [
  runtimePath("data", "heatmap-latest.json"),
  repoPath("data", "heatmap-latest.json"),
];
const HEATMAP_API_FILE = repoPath("api", "heatmap.js");

const APPLY = hasFlag("apply") || envFlag("FUMAN_DAYTRADE_WRITER_APPLY");
const DRY_RUN = !APPLY;
const LOCAL_CHECK = hasFlag("local-check");
const NO_FETCH = hasFlag("no-fetch") || envFlag("FUMAN_DAYTRADE_WRITER_NO_FETCH");
let FETCH_ENABLED = false;
const ONCE = hasFlag("once") || envFlag("FUMAN_DAYTRADE_WRITER_ONCE");
const MAX_RUN_SECONDS = positiveNumber(argValue("max-seconds", process.env.FUMAN_DAYTRADE_WRITER_MAX_SECONDS || 0), 0);
const SUPABASE_READ_TIMEOUT_MS = Math.max(3000, Number(process.env.DAYTRADE_SUPABASE_READ_TIMEOUT_MS || 8000));
const SUPABASE_WRITE_TIMEOUT_MS = Math.max(5000, Number(process.env.DAYTRADE_SUPABASE_WRITE_TIMEOUT_MS || 12000));
const SUPABASE_TRANSIENT_RETRIES = Math.max(0, Math.min(4, Number(process.env.DAYTRADE_SUPABASE_TRANSIENT_RETRIES || 2)));
const SUPABASE_RETRY_BASE_DELAY_MS = Math.max(100, Math.min(5000, Number(process.env.DAYTRADE_SUPABASE_RETRY_BASE_DELAY_MS || 500)));

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
    targetSymbolsMax: 1000,
    minFreshQuoteCoverageForA: 0.90,
    minFreshQuotesForInjectingA: 1,
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
const MIN_PRIORITY_POOL_SYMBOLS = 1; // Formal Gate evaluates the dynamic deep-scan pool, never a fixed priority count.
const MAX_PRIORITY_POOL_SYMBOLS = 600;
const MIN_PRIORITY_FRESH_COVERAGE = positiveNumber(CONFIG.priorityPool?.minFreshQuoteCoverageForA, 0.90);
const MIN_PRIORITY_INJECTING_QUOTES = positiveNumber(CONFIG.priorityPool?.minFreshQuotesForInjectingA, 1);
const DEEP_SCAN_POOL_MAX_SYMBOLS = Math.max(1, positiveNumber(process.env.DAYTRADE_DEEP_SCAN_POOL_MAX_SYMBOLS, 1000));
const FORMAL_SIGNAL_MIN_TOTAL_VOLUME = positiveNumber(process.env.DAYTRADE_FORMAL_SIGNAL_MIN_TOTAL_VOLUME, 5000);
const FORMAL_SIGNAL_MIN_TRADE_VALUE = positiveNumber(process.env.DAYTRADE_FORMAL_SIGNAL_MIN_TRADE_VALUE, 30000000);
const FORMAL_SIGNAL_MAX_VOLUME_RANK = positiveNumber(process.env.DAYTRADE_FORMAL_SIGNAL_MAX_VOLUME_RANK, 300);
const MOTHER_POOL_MIN_SYMBOLS = 300;
const MOTHER_POOL_MAX_SYMBOLS = Math.max(
  MOTHER_POOL_MIN_SYMBOLS,
  Math.min(600, positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MAX_SYMBOLS, 600)),
);
const REST_PRIORITY_BATCH_LIMIT = Math.max(1, Math.min(500, positiveNumber(process.env.DAYTRADE_REST_PRIORITY_BATCH_LIMIT, 320))); // >=300 keeps Mother Pool discovery from being capped by one quote batch.
const MOTHER_POOL_MIN_PRICE = Math.max(50, positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MIN_PRICE ?? CONFIG.motherPool?.minimumPrice, 50));
const MOTHER_POOL_MIN_TURNOVER_RATE = Math.max(1, positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MIN_TURNOVER_RATE ?? CONFIG.motherPool?.minimumTurnoverRate, 1));
const MOTHER_POOL_RULE_VERSION = 'daytrade_mother_pool_dynamic_300_600_deep_scan_20260813_v5';
const USER_CASE_SYMBOLS = new Set(String(process.env.DAYTRADE_MOTHER_POOL_USER_CASE_SYMBOLS || '8069,6213,3042,4956,3105')
  .split(',')
  .map((value) => normalizeCode(value))
  .filter(Boolean));const DIAGNOSTIC_SYMBOLS = String(process.env.DAYTRADE_MOTHER_POOL_DIAGNOSTIC_SYMBOLS || '6488,5351,4979,2408,6213,8069')
  .split(',')
  .map((value) => normalizeCode(value))
  .filter(Boolean);
const MAX_INTRADAY_1M_STALE_SECONDS = positiveNumber(CONFIG.intraday1m?.maxStaleSeconds, 120);
const HOT_BURST_MIN_SIGNALS = 2;
const HOT_BURST_MAX_STALE_SECONDS = Math.max(60, Math.min(MAX_INTRADAY_1M_STALE_SECONDS, Number(process.env.DAYTRADE_HOT_BURST_MAX_STALE_SECONDS || 120)));
const HOT_BURST_COOLDOWN_SECONDS = Math.max(60, Number(process.env.DAYTRADE_HOT_BURST_COOLDOWN_SECONDS || 300));
const HOT_POOL_MIN_SYMBOLS = 40;
const HOT_POOL_MAX_SYMBOLS = 80;
const PREOPEN_WARMUP_START_MINUTES = 7 * 60;
const QUOTE_BATCH_SIZE = Math.max(1, Math.min(500, REST_PRIORITY_BATCH_LIMIT));
const BATCH_SIZE = Math.max(1, Math.min(DEEP_SCAN_POOL_MAX_SYMBOLS, REST_PRIORITY_BATCH_LIMIT));
const CONCURRENCY = Math.max(1, Math.min(12, positiveNumber(process.env.DAYTRADE_REST_QUOTE_CONCURRENCY, Math.max(2, positiveNumber(CONFIG.collector?.quoteConcurrency, 4)))));
const TARGET_BATCH_INTERVAL_SECONDS = Math.max(3.2, positiveNumber(process.env.DAYTRADE_REST_TARGET_BATCH_INTERVAL_SECONDS || CONFIG.collector?.targetBatchIntervalSeconds, 3.2));
const REQUEST_DELAY_MS = Math.max(0, Math.floor((TARGET_BATCH_INTERVAL_SECONDS * 1000 * CONCURRENCY) / Math.max(1, QUOTE_BATCH_SIZE)));
const COOLDOWN_INITIAL_SECONDS = positiveNumber(CONFIG.collector?.cooldownInitialSeconds, 90);
const COOLDOWN_MAX_SECONDS = positiveNumber(CONFIG.collector?.cooldownMaxSeconds, 900);
const RECENT_429_BLOCK_SECONDS = positiveNumber(CONFIG.rateLimitGate?.recent429BlocksASeconds, 90);
const FULL_MARKET_PAUSE_MIN_SECONDS = positiveNumber(CONFIG.rateLimitGate?.pauseFullMarketAfter429SecondsMin, 60);
const FULL_MARKET_PAUSE_MAX_SECONDS = positiveNumber(CONFIG.rateLimitGate?.pauseFullMarketAfter429SecondsMax, 180);
const QUOTE_NOT_FOUND_SKIP_SECONDS = positiveNumber(CONFIG.rateLimitGate?.quoteNotFoundSkipSeconds, 1800);
const WEBSOCKET_CANDLE_MAX_AGE_MS = positiveNumber(process.env.DAYTRADE_WEBSOCKET_CANDLE_MAX_AGE_MS, 10 * 60 * 1000);
// Read enough of the authenticated same-day cache to calculate continuous
// indicators. Persisting it remains bounded below, so the writer never tries
// to replay the full cache on every scheduler tick.
const WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS = positiveNumber(process.env.DAYTRADE_WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS, 8 * 60 * 60 * 1000);

const INTRADAY_MIRROR_BARS_PER_SYMBOL = Math.max(35, Math.min(120, positiveNumber(process.env.DAYTRADE_INTRADAY_MIRROR_BARS_PER_SYMBOL, 35)));
const FUTOPT_WEBSOCKET_MAX_AGE_MS = positiveNumber(process.env.DAYTRADE_FUTOPT_WEBSOCKET_MAX_AGE_MS, 5 * 60 * 1000);
const MIN_READY_MA20_CONTINUOUS = positiveNumber(process.env.DAYTRADE_MIN_READY_MA20_CONTINUOUS, 1500);
const MIN_READY_MA35_CONTINUOUS = positiveNumber(process.env.DAYTRADE_MIN_READY_MA35_CONTINUOUS, 1500);
const MIN_INTRADAY_1M_READY_COVERAGE = positiveNumber(process.env.DAYTRADE_MIN_INTRADAY_1M_READY_COVERAGE || CONFIG.intraday1m?.minReadyCoverageForA, 0.90);
const MIN_PRIORITY_INTRADAY_1M_READY_COVERAGE = positiveNumber(process.env.DAYTRADE_MIN_PRIORITY_INTRADAY_1M_READY_COVERAGE || CONFIG.intraday1m?.minPriorityReadyCoverageForA, 0.90);
const REQUIRE_MA35_FOR_FORMAL_DAYTRADE = envFlag("DAYTRADE_REQUIRE_MA35_FOR_FORMAL_ENTRY");
const REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE = envFlag("DAYTRADE_REQUIRE_FUTOPT_FOR_FORMAL_ENTRY");
const MIN_FUTOPT_MAPPED = positiveNumber(process.env.DAYTRADE_MIN_FUTOPT_MAPPED, 1);
const FUTOPT_PREOPEN_BASELINE_START_MINUTES = 8 * 60 + 45;
const FUTOPT_PREOPEN_BASELINE_END_MINUTES = 9 * 60;
const INTRADAY_STATUS_CACHE_SYNC_INTERVAL_MS = Math.max(
  15000,
  Number(process.env.DAYTRADE_INTRADAY_STATUS_CACHE_SYNC_INTERVAL_MS || 30000),
);
let lastIntradayStatusCacheSyncAt = 0;
const DAILY_VOLUME_MIRROR_SYNC_INTERVAL_MS = Math.max(60000, Number(process.env.DAYTRADE_DAILY_VOLUME_MIRROR_SYNC_INTERVAL_MS || 300000));
let lastDailyVolumeMirrorSyncAt = 0;
let writerLease = { ok: !APPLY, status: APPLY ? "not_claimed" : "dry_run", leaseExpiresAt: "" };

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
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
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
  void phase;
  return false;
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

function retryableSupabaseFetchError(error) {
  const text = [error?.message, error?.cause?.message, error?.cause?.code, error?.code]
    .filter(Boolean)
    .join(" ");
  return /fetch failed|network|timeout|aborted|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket/i.test(text);
}

async function supabaseFetch(url, options = {}, timeoutMs = SUPABASE_READ_TIMEOUT_MS) {
  let lastError = null;
  const { signal: _ignoredSignal, ...requestOptions } = options;
  for (let attempt = 0; attempt <= SUPABASE_TRANSIENT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...requestOptions, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt >= SUPABASE_TRANSIENT_RETRIES || !retryableSupabaseFetchError(error)) throw error;
      await sleep(SUPABASE_RETRY_BASE_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("supabase fetch failed");
}

async function supabaseGet(resource, query = "", options = {}) {
  const key = requireSupabaseKey(Boolean(options.service));
  const url = `${SUPABASE_URL}/rest/v1/${resource}${query ? `?${query}` : ""}`;
  const response = await supabaseFetch(url, {
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
    const response = await supabaseFetch(url, {
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

async function supabaseRpc(resource, body, options = {}) {
  const key = requireSupabaseKey(Boolean(options.service));
  const response = await supabaseFetch(`${SUPABASE_URL}/rest/v1/rpc/${resource}`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_READ_TIMEOUT_MS) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource} RPC HTTP ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : [];
}

function ensureApprovedSourceHost() {
  if (!APPLY) return { ok: true, status: "dry_run" };
  let approval = null;
  try { approval = JSON.parse(fs.readFileSync(SOURCE_HOST_APPROVAL_FILE, "utf8")); } catch {
    throw new Error("daytrade_source_host_approval_missing");
  }
  if (approval?.approved !== true || String(approval.sourceRole || "") !== "writer" || String(approval.hostId || "") !== SOURCE_HOST_ID) {
    throw new Error("daytrade_source_host_not_approved");
  }
  return { ok: true, status: "approved", file: SOURCE_HOST_APPROVAL_FILE };
}

async function ensureWriterLease() {
  if (!APPLY) {
    writerLease = { ok: true, status: "dry_run", leaseExpiresAt: "" };
    return writerLease;
  }
  ensureApprovedSourceHost();
  if (SOURCE_HOST_ROLE !== "writer") throw new Error("daytrade_writer_host_role_required");
  if (!SOURCE_HOST_ID || SOURCE_HOST_ID === "unknown") throw new Error("daytrade_writer_host_id_required");
  if (!WRITER_INSTANCE_ID) throw new Error("daytrade_writer_instance_id_required");
  if (!WRITER_LEASE_REQUIRED) {
    writerLease = { ok: true, status: "lease_optional", leaseExpiresAt: "" };
    return writerLease;
  }
  const rows = await supabaseRpc("claim_fugle_daytrade_source_writer_lease", {
    p_source_name: SOURCE_NAME,
    p_writer_host_id: SOURCE_HOST_ID,
    p_writer_instance_id: WRITER_INSTANCE_ID,
    p_lease_seconds: WRITER_LEASE_SECONDS,
  }, { service: true });
  const lease = Array.isArray(rows) ? rows[0] || {} : rows || {};
  if (lease.ok !== true && lease.claimed !== true) {
    throw new Error("daytrade_writer_lease_not_acquired:" + (lease.current_writer_host_id || "unknown") + ":" + (lease.lease_expires_at || "unknown"));
  }
  writerLease = {
    ok: true,
    status: "claimed",
    sourceName: SOURCE_NAME,
    hostId: SOURCE_HOST_ID,
    instanceId: WRITER_INSTANCE_ID,
    heartbeatAt: lease.heartbeat_at || nowIso(),
    leaseExpiresAt: lease.lease_expires_at || "",
    leaseSeconds: WRITER_LEASE_SECONDS,
  };
  return writerLease;
}

async function supabaseUpsert(resource, rows, conflict, options = {}) {
  if (!rows.length) return { written: 0, skipped: true };
  if (DRY_RUN) return { written: 0, skipped: true, dryRun: true };
  const key = requireSupabaseKey(true);
  let written = 0;
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || 300), 500));
  const writeTimeoutMs = Math.max(SUPABASE_WRITE_TIMEOUT_MS, Number(options.timeoutMs || 0));
  const retries = Math.max(0, Math.min(Number(options.retries || 0), 2));
  const retryDelayMs = Math.max(250, Math.min(Number(options.retryDelayMs || 1000), 5000));
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, {
          method: "POST",
          headers: {
            ...headers(key),
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout ? AbortSignal.timeout(writeTimeoutMs) : undefined,
        });
        if (!response.ok) {
          const responseText = await response.text().catch(() => "");
          throw new Error(`${resource} upsert HTTP ${response.status}: ${responseText.slice(0, 240)}`);
        }
        written += chunk.length;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error || "");
        const retryable = attempt < retries && /timeout|aborted|502|503|504|522|429|ECONNRESET|ETIMEDOUT/i.test(message);
        if (!retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;
  }
  return { written };
}

async function supabaseDelete(resource, query = "") {
  if (DRY_RUN) return { deleted: 0, skipped: true, dryRun: true };
  const key = requireSupabaseKey(true);
  const timeoutMs = Math.max(SUPABASE_WRITE_TIMEOUT_MS, 30000);
  let lastError = null;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}${query ? `?${query}` : ""}`, {
        method: "DELETE",
        headers: {
          ...headers(key),
          Prefer: "return=minimal",
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${resource} delete HTTP ${response.status}: ${text.slice(0, 240)}`);
      }
      return { deleted: 0 };
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const retryable = attempt < 1 && /timeout|aborted|502|503|504|522|429|ECONNRESET|ETIMEDOUT/i.test(message);
      if (!retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
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

function evaluateMotherPoolBasePool(row, metrics) {
  const market = String(row.market || "").toLowerCase();
  const type = String(row.stockType || row.type || row.payload?.stockType || row.payload?.type || "").toLowerCase();
  const payload = objectPayload(row.payload);
  const failedChecks = [];
  const pendingChecks = [];
  const explicitFalse = (value) => value !== undefined && value !== null
    && /^(false|0|no|n|not_allowed|forbidden|blocked)$/i.test(String(value).trim());
  const statusText = [
    payload.tradingStatus,
    payload.trading_status,
    payload.tradeStatus,
    payload.trade_status,
    payload.marketStatus,
    payload.market_status,
    payload.controlStatus,
    payload.control_status,
    payload.dispositionStatus,
    payload.disposition_status,
  ].filter(Boolean).join(" ").toLowerCase();
  const statusControlled = ["disposition", "split trading", "split-trading", "controlled", "restricted", "halted", "suspended", "\\u8655\\u7f6e", "\\u5206\\u76e4", "\\u505c\\u724c", "\\u4eba\\u5de5\\u7ba1\\u5236"].some((term) => statusText.includes(term));
  const dispositionFlag = [
    payload.isDisposition,
    payload.is_disposition,
    payload.inDisposition,
    payload.in_disposition,
  ].some(boolValue);
  const splitTradingFlag = [
    payload.isSplitTrading,
    payload.is_split_trading,
    payload.splitTrading,
    payload.split_trading,
  ].some(boolValue);
  const manualControlFlag = [
    payload.isControlled,
    payload.is_controlled,
    payload.manualControl,
    payload.manual_control,
    payload.tradingRestricted,
    payload.trading_restricted,
  ].some(boolValue);
  const daytradeBlocked = boolValue(row.isDaytradeUnsuitable)
    || boolValue(payload.isDaytradeUnsuitable)
    || boolValue(payload.is_daytrade_unsuitable)
    || explicitFalse(payload.daytradeAllowed)
    || explicitFalse(payload.daytrade_allowed)
    || explicitFalse(payload.canDaytrade)
    || explicitFalse(payload.can_daytrade)
    || explicitFalse(payload.daytradeEligible)
    || explicitFalse(payload.daytrade_eligible);
  if (row.isActive === false) failedChecks.push("inactive");
  if (row.isBlacklisted === true) failedChecks.push("blacklisted");
  if (row.isSuspended === true || row.isHalted === true) failedChecks.push("halted_or_suspended");
  const allowedMarket = ["twse", "tse", "tpex", "otc", "\u4e0a\u5e02", "\u4e0a\u6ac3"].some((term) => market.includes(term));
  if (!market || !allowedMarket) failedChecks.push("market_not_twse_otc");
  const disallowedType = ["etf", "warrant", "convertible", "preferred", "test", "trial", "\u6b0a\u8b49", "\u8a8d\u8cfc", "\u8a8d\u552e", "\u7279\u5225\u80a1"].some((term) => type.includes(term));
  if (row.isEtf === true || row.isWarrant === true || row.isCb === true || row.isTrial === true
    || row.payload?.isEtf === true || row.payload?.is_etf === true
    || disallowedType
    || (row.stockType && !/^common(stock)?$/i.test(String(row.stockType)))) {
    failedChecks.push("not_common_stock");
  }
  if (daytradeBlocked) failedChecks.push("daytrade_not_allowed");
  if (row.hasFormalDaytradeUniverseEvidence !== true) failedChecks.push("formal_daytrade_universe_evidence_missing");
  if (dispositionFlag || statusControlled) failedChecks.push("disposition_or_controlled");
  if (splitTradingFlag) failedChecks.push("split_trading");
  if (manualControlFlag) failedChecks.push("manual_control");
  if (metrics.price > 0) {
    if (MOTHER_POOL_MIN_PRICE > 0 && metrics.price < MOTHER_POOL_MIN_PRICE) failedChecks.push(`price_below_${MOTHER_POOL_MIN_PRICE}`);
  } else pendingChecks.push("price_pending");
  const turnoverRateValue = Number(metrics.turnoverRate);
  const hasTurnoverBasis = Number(metrics.issuedShares) > 0 && Number(metrics.totalVolume) > 0;
  if (MOTHER_POOL_MIN_TURNOVER_RATE > 0) {
    if (Number.isFinite(turnoverRateValue) && turnoverRateValue > 0) {
      if (turnoverRateValue < MOTHER_POOL_MIN_TURNOVER_RATE) failedChecks.push(`turnover_rate_below_${MOTHER_POOL_MIN_TURNOVER_RATE}`);
    } else if (taipeiMinutes() >= 9 * 60 || hasTurnoverBasis) {
      pendingChecks.push("turnover_rate_pending");
    }
  }
  // avg5 is a liquidity grade only. It must never be a direct mother-pool rejection.
  // Missing live quote data remains pending; the 50-dollar price floor is a hard mother-pool gate.
  if (!metrics.quotePresent) pendingChecks.push("quote_pending");
  else if (!metrics.quoteFresh) pendingChecks.push("quote_stale");
  if (metrics.totalVolume > 0) {
    if (metrics.changePercent < -5) failedChecks.push("change_percent_below_minus5");
  } else if (taipeiMinutes() >= 9 * 60) {
    pendingChecks.push("today_volume_pending");
  }
  return {
    eligible: failedChecks.length === 0 && pendingChecks.length === 0,
    pending: failedChecks.length === 0 && pendingChecks.length > 0,
    failedChecks,
    pendingChecks,
  };
}
async function fetchActiveSymbols() {
  const rows = await supabaseGetPaged(
    "stock_tickers",
    "select=symbol,name,market,stock_type,type,industry,is_etf,is_suspended,payload&order=symbol.asc",
    { service: true },
  );
  // stock_tickers is the legacy name/market feed; stock_universe is the
  // authoritative trading-eligibility feed. Merge both so hard exclusions
  // cannot be bypassed by a stale or incomplete ticker row.
  const universeRows = await supabaseGetPaged(
    "stock_universe",
    "select=symbol,name,market,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,payload&order=symbol.asc",
    { service: true },
  );
  const universeBySymbol = new Map(universeRows.map((row) => [normalizeCode(row.symbol), row]).filter(([symbol]) => symbol));
  const mergedBySymbol = new Map();
  for (const row of [...rows, ...universeRows]) {
    const symbol = normalizeCode(row.symbol);
    if (!symbol || symbol.startsWith("00")) continue;
    const prior = mergedBySymbol.get(symbol) || {};
    const universe = universeBySymbol.get(symbol) || {};
    const merged = { ...prior, ...universe, ...row };
    merged.hasFormalDaytradeUniverseEvidence = Object.keys(universe).length > 0;
    for (const key of ["name", "market", "industry", "is_active", "is_etf", "is_warrant", "is_cb", "is_blacklisted", "is_daytrade_unsuitable", "payload"]) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") merged[key] = universe[key] ?? prior[key];
    }
    mergedBySymbol.set(symbol, merged);
  }
  const active = [];
  for (const row of mergedBySymbol.values()) {
    const symbol = normalizeCode(row.symbol);
    const payload = objectPayload(row.payload);
    active.push({
      symbol,
      name: row.name || symbol,
      market: row.market || "",
      stockType: row.stock_type || row.type || payload.stockType || payload.stock_type || "",
      industry: row.industry || payload.industry || payload.category || "",
      isActive: row.is_active,
      isEtf: row.is_etf,
      isWarrant: row.is_warrant,
      isCb: row.is_cb,
      isBlacklisted: row.is_blacklisted,
      isDaytradeUnsuitable: row.is_daytrade_unsuitable,
      hasFormalDaytradeUniverseEvidence: row.hasFormalDaytradeUniverseEvidence === true,
      isSuspended: row.is_suspended,
      isHalted: row.is_halted,
      isTrial: row.is_trial === true || payload.isTrial === true || payload.is_trial === true,
      payload,
    });
  }
  active.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return active;
}
function dailyVolumeRowsToMap(rows, source) {
  const map = new Map(rows.map((row) => [normalizeCode(row.symbol), {
    symbol: normalizeCode(row.symbol),
    market: row.market || "",
    trade_date: row.trade_date || null,
    volume: numberValue(row.volume),
    avg_volume5: numberValue(row.avg_volume5 ?? row.avg5_volume),
    updated_at: row.updated_at || nowIso(),
    source,
    payload: row.payload || {},
  }]).filter(([symbol]) => symbol));
  map.source = source;
  return map;
}

async function fetchDailyVolumeAvg() {
  const sources = [
    {
      resource: "fugle_daytrade_daily_volume_avg",
      query: "select=symbol,market,trade_date,volume,avg_volume5,avg5_volume,updated_at&order=symbol.asc",
      source: "fugle_daytrade_daily_volume_avg_fast_mirror",
      earlyReturnRows: 0,
    },
    {
      resource: "fugle_daily_volume_avg",
      query: "select=symbol,market,trade_date,volume,avg_volume5,avg5_volume,updated_at&order=symbol.asc",
      source: "fugle_daily_volume_avg",
      earlyReturnRows: 0,
    },
  ];
  const combined = new Map();
  const currentTradeDate = taipeiDate();
  const sourceRank = (source) => String(source || '').includes('fast_mirror') ? 2 : 1;
  const rowRank = (row) => {
    const tradeDate = String(row?.trade_date || '').slice(0, 10);
    const isCurrent = tradeDate === currentTradeDate ? 1 : 0;
    const tradeDateMs = Date.parse(tradeDate) || 0;
    const updatedAtMs = Date.parse(row?.updated_at || '') || 0;
    return [isCurrent, tradeDateMs, updatedAtMs, sourceRank(row?.source)];
  };
  const shouldReplace = (previous, next) => {
    const previousRank = rowRank(previous);
    const nextRank = rowRank(next);
    for (let i = 0; i < nextRank.length; i += 1) {
      if (nextRank[i] !== previousRank[i]) return nextRank[i] > previousRank[i];
    }
    return false;
  };
  const readErrors = [];
  for (const spec of sources) {
    let loaded = false;
    for (const service of [true, false]) {
      try {
        const rows = await supabaseGetPaged(spec.resource, spec.query, { service, pageSize: 1000 });
        const map = dailyVolumeRowsToMap(rows, `${spec.source}${service ? "" : "_anon_retry"}`);
        for (const [symbol, row] of map.entries()) {
          if (!combined.has(symbol) || shouldReplace(combined.get(symbol), row)) combined.set(symbol, row);
        }
        if (map.size > 0) {
          combined.source = combined.source ? `${combined.source}+${map.source}` : map.source;
          loaded = true;
          if (spec.earlyReturnRows && map.size >= spec.earlyReturnRows) return map;
          break;
        }
      } catch (error) {
        readErrors.push({ resource: spec.resource, service, message: error?.message || String(error) });
      }
    }
    if (!loaded && spec.resource === "fugle_daytrade_daily_volume_avg" && combined.size >= DEEP_SCAN_POOL_MAX_SYMBOLS) break;
  }
  combined.source = combined.source || "missing_daily_volume";
  combined.readErrors = readErrors;
  return combined;
}
async function fetchExistingDaytradeQuotes() {
  const quoteMap = new Map();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_quotes_live",
      "select=symbol,name,market,quote_seen_at,updated_at,last_trade_time,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_price,bid_volume,ask_price,ask_volume,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,limit_up_price,limit_down_price&order=symbol.asc",
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

function mergeWebSocketCandleFreshness(quoteMap) {
  const cache = readFugleWebSocketCandles({ maxAgeMs: WINDOW_SECONDS * 1000 });
  const latest = new Map();
  for (const candle of cache.candles.values()) {
    const symbol = normalizeCode(candle.symbol || candle.code);
    const candleTime = normalizeTimestamp(candle.candle_time || candle.candleTime || candle.date);
    if (!symbol || !candleTime || ageSeconds(candleTime) > WINDOW_SECONDS) continue;
    const previous = latest.get(symbol);
    if (!previous || Date.parse(candleTime) > Date.parse(previous.candleTime)) latest.set(symbol, { candle, candleTime });
  }
  for (const [symbol, item] of latest.entries()) {
    const candle = item.candle;
    const previous = quoteMap.get(symbol) || {};
    const close = numberValue(candle.close);
    if (!(close > 0)) continue;
    const previousClose = numberValue(previous.previous_close);
    quoteMap.set(symbol, {
      ...previous,
      symbol,
      market: candle.market || previous.market || "",
      quote_seen_at: item.candleTime,
      updated_at: candle.candleSeenAt || item.candleTime,
      last_trade_time: item.candleTime,
      price: close,
      open_price: numberValue(candle.open, numberValue(previous.open_price)),
      high_price: numberValue(candle.high, numberValue(previous.high_price)),
      low_price: numberValue(candle.low, numberValue(previous.low_price)),
      previous_close: previousClose,
      change_percent: previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : numberValue(previous.change_percent),
      payload: { ...(previous.payload || {}), freshness_source: "fugle_websocket_candle", candle_time: item.candleTime },
    });
  }
  return latest.size;
}

async function fetchCapitalMap() {
  const map = new Map();
  try {
    const rows = await supabaseGetPaged(
      "stock_capital_latest",
      "select=code,issued_shares,capital,updated_at&order=updated_at.desc",
      { service: true, pageSize: 1000 },
    );
    for (const row of rows) {
      const symbol = normalizeCode(row.code);
      const issuedShares = firstNumber(row.issued_shares, row.capital);
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
      if (list.length < 5) {
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
    const previous3 = rows[Math.min(2, rows.length - 1)] || previous;
    const previous5 = rows[Math.min(4, rows.length - 1)] || previous3 || previous;
    const marginBalance = numberValue(latest.marginBalance);
    const shortBalance = numberValue(latest.shortBalance);
    const marginChange1d = rows.length >= 2 ? marginBalance - numberValue(previous.marginBalance) : 0;
    const shortChange1d = rows.length >= 2 ? shortBalance - numberValue(previous.shortBalance) : 0;
    const marginChange3d = rows.length >= 3 ? marginBalance - numberValue(previous3.marginBalance) : marginChange1d;
    const shortChange3d = rows.length >= 3 ? shortBalance - numberValue(previous3.shortBalance) : shortChange1d;
    const marginChange5d = rows.length >= 5 ? marginBalance - numberValue(previous5.marginBalance) : marginChange3d;
    const shortChange5d = rows.length >= 5 ? shortBalance - numberValue(previous5.shortBalance) : shortChange3d;
    map.set(symbol, {
      tradeDate: latest.tradeDate || "",
      sampledDays: rows.length,
      marginBalance,
      shortBalance,
      marginChange: marginChange1d,
      shortChange: shortChange1d,
      marginChange1d,
      shortChange1d,
      marginChange3d,
      shortChange3d,
      marginChange5d,
      shortChange5d,
      updated_at: latest.updated_at || "",
    });
  }
  return map;
}

function mergeWebSocketQuoteCache(quoteMap) {
  const cache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  const numeric = (value, fallback, positiveOnly = false) => {
    const parsed = numberValue(value, NaN);
    if (Number.isFinite(parsed) && (!positiveOnly || parsed > 0)) return parsed;
    const previous = numberValue(fallback, NaN);
    return Number.isFinite(previous) ? previous : 0;
  };
  const currentValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  for (const [code, row] of cache.quotes.entries()) {
    const symbol = normalizeCode(code || row.code || row.symbol);
    if (!symbol) continue;
    if (isFinMindDiagnosticQuote(row)) continue;
    const previous = quoteMap.get(symbol) || {};
    const seenAt = normalizeTimestamp(
      row.quoteSeenAt || row.updatedAt || cache.payload?.updatedAt || previous.quote_seen_at,
      nowIso(),
    );
    const changePercentValue = currentValue(row.changePercent, row.change_percent, row.percent);
    const merged = {
      ...previous,
      symbol,
      market: row.market || previous.market || "",
      quote_seen_at: seenAt,
      updated_at: seenAt || previous.updated_at || "",
      last_trade_time: normalizeTimestamp(
        row.lastTradeTime || row.quoteTime || row.time || previous.last_trade_time,
        seenAt,
      ),
      price: numeric(row.close ?? row.price, previous.price, true),
      open_price: numeric(row.open ?? row.openPrice, previous.open_price, true),
      high_price: numeric(row.high ?? row.highPrice, previous.high_price, true),
      low_price: numeric(row.low ?? row.lowPrice, previous.low_price, true),
      previous_close: numeric(row.previousClose ?? row.previous_close ?? row.referencePrice, previous.previous_close, true),
      change_percent: numeric(changePercentValue, previous.change_percent),
      total_volume: numeric(row.tradeVolume ?? row.total_volume, previous.total_volume, true),
      trade_value: numeric(row.tradeValue ?? row.trade_value, previous.trade_value, true),
      bid_price: numeric(row.bidPrice ?? row.bid_price, previous.bid_price, true),
      ask_price: numeric(row.askPrice ?? row.ask_price, previous.ask_price, true),
      bid_volume: numeric(row.bidVolume ?? row.bid_volume, previous.bid_volume),
      ask_volume: numeric(row.askVolume ?? row.ask_volume, previous.ask_volume),
      cumulative_bid_volume: numeric(row.cumulativeBidVolume ?? row.cumulative_bid_volume, previous.cumulative_bid_volume),
      cumulative_ask_volume: numeric(row.cumulativeAskVolume ?? row.cumulative_ask_volume, previous.cumulative_ask_volume),
      cumulative_bid_ask_volume: numeric(row.cumulativeBidAskVolume ?? row.cumulative_bid_ask_volume, previous.cumulative_bid_ask_volume),
      limit_up_price: numeric(row.limitUpPrice ?? row.limit_up_price, previous.limit_up_price, true),
      limit_down_price: numeric(row.limitDownPrice ?? row.limit_down_price, previous.limit_down_price, true),
      payload: {
        ...(previous.payload || {}),
        ...(row.payload || {}),
        source: "fugle-websocket-cache",
        quoteSource: row.quoteSource || row.closeSource || "fugle-ws",
        cacheUpdatedAt: cache.payload?.updatedAt || "",
      },
    };
    quoteMap.set(symbol, merged);
  }
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberValue(value, NaN);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function firstText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstText(...value);
      if (nested) return nested;
      continue;
    }
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function taipeiDateAgeDays(value) {
  const text = firstText(value);
  if (!text) return null;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  const parsed = compact ? Date.parse(`${compact[1]}-${compact[2]}-${compact[3]}`) : Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  const normalized = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : taipeiDateFrom(text);
  const then = Date.parse(`${normalized}T00:00:00Z`);
  const today = Date.parse(`${taipeiDate()}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(today)) return null;
  return Math.floor((today - then) / (24 * 60 * 60 * 1000));
}

function isRecentTaipeiDate(value, days = 5) {
  const ageDays = taipeiDateAgeDays(value);
  return ageDays !== null && ageDays >= 0 && ageDays <= days;
}

function uniqueTexts(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function stockGroupKeys(row, payload = {}, dailyPayload = {}, groupRow = {}) {
  const symbol = normalizeCode(row?.symbol || payload.symbol || dailyPayload.symbol);
  const codeCluster = symbol ? `code_cluster_${symbol.slice(0, 3)}` : "";
  return uniqueTexts([
    groupRow?.sector,
    groupRow?.heatmapSector,
    groupRow?.primaryIndustry,
    groupRow?.officialIndustry,
    groupRow?.industry,
    groupRow?.group,
    groupRow?.theme,
    groupRow?.themes,
    row?.industry,
    row?.sector,
    row?.group,
    row?.category,
    row?.primaryIndustry,
    row?.officialIndustry,
    row?.payload?.industry,
    row?.payload?.sector,
    row?.payload?.group,
    row?.payload?.category,
    payload.industry,
    payload.sector,
    payload.group,
    payload.category,
    payload.primaryIndustry,
    payload.officialIndustry,
    dailyPayload.industry,
    dailyPayload.sector,
    dailyPayload.group,
    dailyPayload.category,
    codeCluster,
  ]).filter((key) => key !== "--");
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

function buildFullMarketIntradaySignalEvidence({ activeSymbols, dailyVolumeMap, quoteMap, intradayMap }) {
  const rows = activeSymbols.map((row) => {
    const symbol = row.symbol;
    const metrics = quoteMetrics(symbol, dailyVolumeMap, quoteMap, { activeBySymbol: new Map([[symbol, row]]) });
    const intraday = intradayMap?.get(symbol) || {};
    const openPrice = firstNumber(intraday.open_price, metrics.openPrice);
    const aboveOpenPrice = openPrice > 0 && metrics.price >= openPrice;
    const ma3 = firstNumber(intraday.ma3, intraday.sma3);
    const ma5 = firstNumber(intraday.ma5, intraday.sma5);
    const ma10 = firstNumber(intraday.ma10, intraday.sma10);
    const ma20 = firstNumber(intraday.ma20, intraday.sma20);
    const ma30 = firstNumber(intraday.ma30, intraday.sma30);
    const ma35 = firstNumber(intraday.ma35, intraday.sma35);
    const ma58 = firstNumber(intraday.ma58, intraday.sma58);
    const ma3Ma5Ma10Bullish = ma3 > 0 && ma5 > 0 && ma10 > 0 && ma3 > ma5 && ma5 > ma10;
    const ma5Ma10Ma30Bullish = ma5 > 0 && ma10 > 0 && ma30 > 0 && ma5 > ma10 && ma10 > ma30;
    const movingAverageTurnBullish = ma3Ma5Ma10Bullish || ma5Ma10Ma30Bullish;
    const maValuesReady = ma5 > 0 && ma10 > 0 && ma35 > 0;
    const maAlignment = maValuesReady && ma5 > ma10 && ma10 > ma35;
    const reportedBullish = boolValue(intraday.ma5_ma10_ma35_bullish);
    // Rising averages alone do not prove bullish alignment. Require actual values.
    const bullish = maValuesReady && (reportedBullish || maAlignment);
    const recent1mVolumeTrend = String(intraday.recent_1m_volume_trend || intraday.volume_trend || "").toLowerCase();
    const recent1mVolumeNotShrinking = ["expanding", "increasing", "up", "stable", "non_decreasing", "not_shrinking"].includes(recent1mVolumeTrend);
    const payload = quoteMap.get(symbol)?.payload || {};
    const previousVolume = firstNumber(
      payload.previousTotalVolume,
      payload.previous_total_volume,
      payload.previousTradeVolume,
      payload.previous_trade_volume,
    );
    const volumeExpanding = boolValue(
      payload.volumeIncreasing
        || payload.volume_increasing
        || payload.volumeExpanding
        || payload.volume_expanding
        || payload.volumeTrendUp
        || payload.volume_trend_up,
    ) || (previousVolume > 0 && metrics.totalVolume > previousVolume);
    return {
      symbol,
      name: row.name || symbol,
      changePercent: Number(metrics.changePercent.toFixed(4)),
      totalVolume: Math.round(metrics.totalVolume),
      avgVolume5: Math.round(metrics.avgVolume5),
      volumeRatio5: Number(metrics.volumeRatio5.toFixed(4)),
      aboveOpenPrice,
      amplitudeFromOpen: Number(metrics.amplitudeFromOpen.toFixed(4)),
      recent1mVolumeTrend,
      recent1mVolumeNotShrinking,
      quoteAgeSeconds: ageSeconds(quoteFreshnessTime(quoteMap.get(symbol))),
      latestCandleTime: intraday.latest_candle_time || "",
      intraday1mStaleSeconds: numberValue(intraday.latest_candle_age_seconds, 999999),
      ma3,
      ma5,
      ma10,
      ma20,
      ma30,
      ma35,
      ma58,
      ma3Ma5Ma10Bullish,
      ma5Ma10Ma30Bullish,
      movingAverageTurnBullish,
      maValuesReady,
      maAlignment,
      ma5Ma10Ma35Bullish: bullish,
      volumeExpanding,
      gainAbove2: metrics.changePercent > 2,
    };
  });
  const volumeRanks = rankMap(rows, (row) => row.totalVolume, { minValue: 0 });
  for (const row of rows) row.volumeRank = volumeRanks.get(row.symbol)?.rank || 0;
  const fresh = rows.filter((row) => row.quoteAgeSeconds <= WINDOW_SECONDS);
  const bullish = fresh.filter((row) => row.gainAbove2 && row.ma5Ma10Ma35Bullish && row.volumeExpanding && row.totalVolume > 0);
  const volumeSurgeTop100 = fresh.filter((row) => row.totalVolume > 10000 && row.volumeRatio5 >= 2 && row.volumeExpanding && row.recent1mVolumeNotShrinking && row.volumeRank > 0 && row.volumeRank <= 100);
  const compact = (row) => ({
    symbol: row.symbol,
    name: row.name,
    changePercent: row.changePercent,
    totalVolume: row.totalVolume,
    avgVolume5: row.avgVolume5,
    volumeRatio5: row.volumeRatio5,
    volumeRank: row.volumeRank,
    quoteAgeSeconds: row.quoteAgeSeconds,
    latestCandleTime: row.latestCandleTime,
    intraday1mStaleSeconds: row.intraday1mStaleSeconds,
    ma3: row.ma3,
    ma5: row.ma5,
    ma10: row.ma10,
    ma20: row.ma20,
    ma30: row.ma30,
    ma35: row.ma35,
    ma58: row.ma58,
    ma3Ma5Ma10Bullish: row.ma3Ma5Ma10Bullish,
    ma5Ma10Ma30Bullish: row.ma5Ma10Ma30Bullish,
    movingAverageTurnBullish: row.movingAverageTurnBullish,
    ma5Ma10Ma35Bullish: row.ma5Ma10Ma35Bullish,
    aboveOpenPrice: row.aboveOpenPrice,
    recent1mVolumeTrend: row.recent1mVolumeTrend,
    recent1mVolumeNotShrinking: row.recent1mVolumeNotShrinking,
    volumeExpanding: row.volumeExpanding,
  });
  return {
    source: "fugle_daytrade_quotes_live+v_fugle_daytrade_intraday_1m_status",
    universe: "full_market_active_common_stock",
    activeSymbols: activeSymbols.length,
    freshQuoteSymbols: fresh.length,
    freshQuoteCoverage120s: activeSymbols.length ? Number((fresh.length / activeSymbols.length).toFixed(4)) : 0,
    freshIntraday1mSymbols: fresh.filter((row) => row.intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS).length,
    freshIntraday1mCoverage: activeSymbols.length
      ? Number((fresh.filter((row) => row.intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS).length / activeSymbols.length).toFixed(4))
      : 0,
    bullishGainVolumeCandidateCount: bullish.length,
    volumeSurgeTop100CandidateCount: volumeSurgeTop100.length,
    bullishGainVolumeCandidates: bullish.sort((a, b) => b.changePercent - a.changePercent || b.totalVolume - a.totalVolume).slice(0, 100).map(compact),
    evidenceCandidatesCap: 100,
    volumeSurgeTop100Candidates: volumeSurgeTop100.sort((a, b) => b.volumeRatio5 - a.volumeRatio5 || a.volumeRank - b.volumeRank).slice(0, 100).map(compact),
    rules: {
      bullishGainVolume: "change_percent>2 AND ma5>ma10>ma35 AND volume_expanding",
      volumeSurgeTop100: "total_volume>10000 AND total_volume/avg_volume5>=2 AND volume_expanding AND recent_2_3_1m_volume_not_shrinking AND volume_rank<=100",
      movingAverageTurn: "MA3>MA5>MA10 OR MA5>MA10>MA30",
      formalEntryScope: "mother_pool_complete_dynamic_scan",
      rotationScope: "mother_pool_300_600",
    },
  };
}

function quoteMetrics(symbol, dailyVolumeMap, quoteMap, supplementalMaps = {}) {
  const quote = quoteMap?.get(symbol) || {};
  const payload = quote.payload || {};
  const daily = dailyVolumeMap.get(symbol) || {};
  const dailyPayload = daily.payload || {};
  const activeRow = supplementalMaps.activeBySymbol?.get(symbol) || {};
  const intraday = supplementalMaps.intradayMap?.get(symbol) || {};
  const capital = supplementalMaps.capitalMap?.get(symbol) || {};
  const chip = supplementalMaps.chipMap?.get(symbol) || {};
  const margin = supplementalMaps.marginChangeMap?.get(symbol) || {};
  const stockFuture = supplementalMaps.stockFutureInitialMap?.get(symbol) || {};
  const groupContract = supplementalMaps.stockGroupContractMap?.get(symbol) || {};
  const price = firstNumber(quote.price, quote.close, payload.price, payload.close);
  const openPrice = firstNumber(quote.open_price, payload.openPrice, payload.open_price);
  const previousClose = firstNumber(quote.previous_close, payload.previousClose, payload.previous_close);
  const changePercent = firstNumber(
    quote.change_percent,
    payload.changePercent,
    payload.change_percent,
    previousClose > 0 && price > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
  );
  const totalVolume = firstNumber(quote.total_volume, quote.trade_volume, payload.totalVolume, payload.tradeVolume);
  const tradeValue = firstNumber(quote.trade_value, payload.tradeValue, payload.trade_value, price > 0 ? price * totalVolume * 1000 : 0);
  const previousVolume = firstNumber(daily.volume, dailyPayload.volume, payload.previousVolume, payload.previous_volume);
  const avgVolume5 = firstNumber(daily.avg_volume5, dailyPayload.avgVolume5, dailyPayload.avg_volume5, payload.avgVolume5, payload.avg_volume5);
  const volumeRatio5 = avgVolume5 > 0 ? totalVolume / avgVolume5 : 0;
  const quotePresent = quoteMap?.has(symbol) === true;
  const quoteFresh = ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS;
  const currentMinutes = taipeiMinutes();
  const sessionElapsedMinutes = currentMinutes >= 540 && currentMinutes <= 810
    ? Math.max(1, Math.min(270, currentMinutes - 540 + 1))
    : 0;
  const projectedVolume = quoteFresh && sessionElapsedMinutes > 0
    ? totalVolume * 270 / sessionElapsedMinutes
    : 0;
  const estimatedVolumeRatio = previousVolume > 0 ? projectedVolume / previousVolume : 0;
  const estimatedVolumeRatioUsable = quoteFresh && sessionElapsedMinutes > 0 && previousVolume > 0;
  const ma3 = firstNumber(intraday.ma3, intraday.sma3);
  const ma5 = firstNumber(intraday.ma5, intraday.sma5);
  const ma10 = firstNumber(intraday.ma10, intraday.sma10);
  const ma30 = firstNumber(intraday.ma30, intraday.sma30);
  const ma58 = firstNumber(intraday.ma58, intraday.sma58);
  const ma3Rising = boolValue(intraday.ma3_rising ?? intraday.ma3Rising ?? payload.ma3Rising ?? payload.ma3_rising);
  const ma5Rising = boolValue(intraday.ma5_rising ?? intraday.ma5Rising ?? payload.ma5Rising ?? payload.ma5_rising);
  const ma10Rising = boolValue(intraday.ma10_rising ?? intraday.ma10Rising ?? payload.ma10Rising ?? payload.ma10_rising);
  const ma30Rising = boolValue(intraday.ma30_rising ?? intraday.ma30Rising ?? payload.ma30Rising ?? payload.ma30_rising);
  const ma58Rising = boolValue(intraday.ma58_rising ?? intraday.ma58Rising ?? payload.ma58Rising ?? payload.ma58_rising);
  const ma3Ma5Ma10Bullish = ma3 > 0 && ma5 > 0 && ma10 > 0 && ma3 > ma5 && ma5 > ma10;
  const ma5Ma10Ma30Bullish = ma5 > 0 && ma10 > 0 && ma30 > 0 && ma5 > ma10 && ma10 > ma30;
  const movingAverageTurnBullish = ma3Ma5Ma10Bullish || ma5Ma10Ma30Bullish;
  const aboveMa30 = price > 0 && ma30 > 0 && price > ma30;
  const aboveMa58 = price > 0 && ma58 > 0 && price > ma58;
  const openingRangeBreak = boolValue(payload.openingRangeBreak || payload.opening_range_break || intraday.opening_range_break || intraday.openingRangeBreak);
  const trackedBuyPointActive = boolValue(payload.trackedBuyPointActive || payload.tracked_buy_point_active || payload.buyPointTriggered || payload.buy_point_triggered);
  const fibSupport = boolValue(payload.fibSupport || payload.fib_support || payload.fibonacciSupport || payload.fibonacci_support || intraday.fib_support || intraday.fibonacci_support);
  const ma10PullbackSupport = boolValue(payload.ma10PullbackSupport || payload.ma10_pullback_support || payload.ma10Support || payload.ma10_support || intraday.ma10_pullback_support || intraday.ma10_support);
  const wBottomNecklineBreak = boolValue(payload.wBottomNecklineBreak || payload.w_bottom_neckline_break || payload.wNecklineBreak || payload.w_neckline_break || intraday.w_bottom_neckline_break || intraday.w_neckline_break);
  const scatterGunPattern = boolValue(payload.scatterGun || payload.scatter_gun || payload.scatterGunCandidate || payload.scatter_gun_candidate || intraday.scatter_gun || intraday.scatter_gun_candidate);
  const pppPattern = boolValue(payload.ppp || payload.pppCandidate || payload.ppp_candidate || intraday.ppp || intraday.ppp_candidate);
  const middleGateBreak = boolValue(payload.middleGateBreak || payload.middle_gate_break || payload.middleLevelBreak || payload.middle_level_break || intraday.middle_gate_break || intraday.middle_level_break);
  const threeBottomPattern = boolValue(payload.threeBottom || payload.three_bottom || payload.threeBottomCandidate || payload.three_bottom_candidate || intraday.three_bottom || intraday.three_bottom_candidate);
  const dynamicThreeGateBreak = boolValue(payload.dynamicThreeGateBreak || payload.dynamic_three_gate_break || payload.dynamicThreeLevelBreak || payload.dynamic_three_level_break || intraday.dynamic_three_gate_break || intraday.dynamic_three_level_break);
  const tongziPattern = boolValue(payload.tongzi || payload.tongziCandidate || payload.tongzi_candidate || intraday.tongzi || intraday.tongzi_candidate);
  const divergencePattern = boolValue(payload.divergence || payload.divergenceCandidate || payload.divergence_candidate || intraday.divergence || intraday.divergence_candidate);
  const vTurnPattern = boolValue(payload.vTurn || payload.v_turn || payload.vTurnCandidate || payload.v_turn_candidate || intraday.v_turn || intraday.v_turn_candidate);
  const rapidGainIncrease = boolValue(payload.rapidGainIncrease || payload.rapid_gain_increase || payload.changeAcceleration || payload.change_acceleration)
    || (quoteFresh && changePercent > 2 && (volumeRatio5 >= 1.5 || estimatedVolumeRatio >= 2));
  const surgeFlag = changePercent > 2 || volumeRatio5 >= 1.5 || estimatedVolumeRatio >= 2;
  const volumeSpikeFlag = volumeRatio5 >= 2 || estimatedVolumeRatio >= 2;
  const candleCountRaw = intraday.today_candle_count ?? intraday.candle_count ?? intraday.warmup_candle_count;
  const candleCount = numberValue(candleCountRaw);
  const firstCandleTime = intraday.first_candle_time || intraday.firstCandleTime || "";
  const lastCandleTime = intraday.latest_candle_time || intraday.last_candle_time || intraday.lastCandleTime || "";
  const dataGapRequired = currentMinutes >= 9 * 60 && currentMinutes <= 13 * 60 + 30;
  const expectedTodayCandles = dataGapRequired ? Math.max(1, currentMinutes - 9 * 60 + 1) : 0;
  const intradayViewMismatch = boolValue(intraday.status_view_mismatch ?? intraday.statusViewMismatch ?? intraday.payload?.status_view_mismatch ?? intraday.payload?.statusViewMismatch)
    || /status_view_mismatch|view_mismatch/i.test(String(intraday.status || intraday.readiness_status || intraday.payload?.status || ""));
  const parseCandleMinutes = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const epoch = Date.parse(raw);
    if (Number.isFinite(epoch)) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(epoch));
      const hour = Number(parts.find((part) => part.type === "hour")?.value);
      const minute = Number(parts.find((part) => part.type === "minute")?.value);
      if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
    }
    const match = raw.match(/(?:T|\s)(\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  };
  const firstCandleMinutes = parseCandleMinutes(firstCandleTime);
  const lastCandleMinutesForGap = parseCandleMinutes(lastCandleTime);
  const expectedCandlesThroughLast = dataGapRequired && lastCandleMinutesForGap >= 9 * 60 ? Math.max(1, Math.min(91, lastCandleMinutesForGap - 9 * 60 + 1)) : expectedTodayCandles;
  const toleratedExpectedCandlesThroughLast = dataGapRequired
    ? Math.max(1, Math.ceil(expectedCandlesThroughLast * MIN_INTRADAY_1M_READY_COVERAGE))
    : expectedCandlesThroughLast;
  const latestCandleAgeSeconds = numberValue(intraday.latest_candle_age_seconds, 999999);
  const earlySessionRequiredCandlesForGap = Math.max(20, Math.ceil(91 * MIN_INTRADAY_1M_READY_COVERAGE));
  const earlyWindowFormalEnough = currentMinutes >= 10 * 60 + 30
    && firstCandleMinutes > 0 && firstCandleMinutes <= 9 * 60 + 2
    && candleCount >= earlySessionRequiredCandlesForGap
    && lastCandleMinutesForGap >= 10 * 60 + 30
    && latestCandleAgeSeconds <= MAX_INTRADAY_1M_STALE_SECONDS;
  const intradayPresent = Object.keys(intraday || {}).length > 0;
  let dataGapStatus = "OK";
  if (dataGapRequired) {
    if (intradayViewMismatch && !earlyWindowFormalEnough) dataGapStatus = "STATUS_VIEW_MISMATCH";
    else if (!intradayPresent || (candleCount <= 0 && !firstCandleTime && !lastCandleTime)) dataGapStatus = "NO_1M";
    else if (firstCandleMinutes > 9 * 60 + 2) dataGapStatus = "LATE_START";
    else if (latestCandleAgeSeconds > MAX_INTRADAY_1M_STALE_SECONDS) dataGapStatus = "STOPPED";
    else if (lastCandleTime && candleCount < toleratedExpectedCandlesThroughLast) dataGapStatus = "STOPPED";
    else if (candleCount < toleratedExpectedCandlesThroughLast) dataGapStatus = "STATUS_VIEW_MISMATCH";
  }
  const targetCandleTime = firstText(payload.targetCandleTime, payload.target_candle_time, intraday.target_candle_time);
  const targetCandleMinutes = parseCandleMinutes(targetCandleTime);
  const lastCandleMinutes = parseCandleMinutes(lastCandleTime);
  const has0901Candle = candleCount > 0 && firstCandleMinutes > 0 && firstCandleMinutes <= 9 * 60 + 2
    && (dataGapStatus === "OK" || candleCount >= Math.max(1, Math.ceil(Math.max(1, lastCandleMinutes - 9 * 60 + 1) * MIN_INTRADAY_1M_READY_COVERAGE)));
  const earlySessionRequiredCandles = earlySessionRequiredCandlesForGap;
  const hasEarlySessionContinuous = currentMinutes < 10 * 60 + 30
    ? false
    : firstCandleMinutes > 0 && firstCandleMinutes <= 9 * 60 + 2 && candleCount >= earlySessionRequiredCandles
      && lastCandleMinutes >= 10 * 60 + 30 && !["NO_1M", "STATUS_VIEW_MISMATCH"].includes(dataGapStatus);
  if (dataGapStatus === "OK" && currentMinutes >= 10 * 60 + 30 && !hasEarlySessionContinuous) {
    dataGapStatus = "STATUS_VIEW_MISMATCH";
  }
  const targetWindowStatus = targetCandleMinutes > 0
    ? (firstCandleMinutes > 0 && lastCandleMinutes > 0 && firstCandleMinutes <= targetCandleMinutes + 2 && lastCandleMinutes >= targetCandleMinutes - 2
      ? "covered_by_continuous_window" : "missing_or_unproven")
    : "not_requested";
  const dataGap = {
    status: dataGapStatus,
    candle_count: candleCount,
    first_candle_time: firstCandleTime,
    last_candle_time: lastCandleTime,
    missing_window: dataGapStatus === "OK" ? "" : (lastCandleTime || firstCandleTime || "unknown") + "-now",
    data_gap_reason: dataGapStatus === "OK" ? "" : dataGapStatus,
    intraday_1m_stale_seconds: latestCandleAgeSeconds,
    has_required_1m_window: !dataGapRequired || dataGapStatus === "OK" || hasEarlySessionContinuous,
    has_0901_candle: has0901Candle,
    has_0900_1030_continuous: hasEarlySessionContinuous,
    target_candle_time: targetCandleTime,
    target_time_plus_minus_2m_status: targetWindowStatus,
    target_time_plus_minus_2m_ready: targetWindowStatus === "covered_by_continuous_window",
  };
  const sectorName = firstText(activeRow.industry, activeRow.payload?.industry, activeRow.payload?.sectorName, activeRow.payload?.sector_name);
  const sectorStrengthScore = firstNumber(activeRow.payload?.sectorStrengthScore, activeRow.payload?.sector_strength_score, payload.sectorStrengthScore, payload.sector_strength_score);
  const issuedShares = firstNumber(capital.issuedShares, payload.issuedShares, payload.issued_shares, dailyPayload.issuedShares, dailyPayload.issued_shares);
  const currentTurnoverRate = issuedShares > 0 && totalVolume > 0 ? (totalVolume * 1000 / issuedShares) * 100 : 0;
  const avgTurnoverRate5 = issuedShares > 0 && avgVolume5 > 0 ? (avgVolume5 * 1000 / issuedShares) * 100 : 0;
  const highPrice = firstNumber(quote.high_price, payload.highPrice, payload.high_price, price);
  const lowPrice = firstNumber(quote.low_price, payload.lowPrice, payload.low_price, price);
  const amplitudeFromOpen = openPrice > 0 && price > 0 ? ((price - openPrice) / openPrice) * 100 : 0;
  const limitUpPrice = firstNumber(quote.limit_up_price, payload.limitUpPrice, payload.limit_up_price, payload.limitUp, payload.limit_up, previousClose > 0 ? previousClose * 1.1 : 0);
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
  const marginChange3d = firstNumber(payload.marginChange3d, payload.margin_change_3d, dailyPayload.marginChange3d, dailyPayload.margin_change_3d, margin.marginChange3d, margin.marginChange);
  const shortChange3d = firstNumber(payload.shortChange3d, payload.short_change_3d, dailyPayload.shortChange3d, dailyPayload.short_change_3d, margin.shortChange3d, margin.shortChange);
  const marginChange5d = firstNumber(payload.marginChange5d, payload.margin_change_5d, dailyPayload.marginChange5d, dailyPayload.margin_change_5d, margin.marginChange5d, margin.marginChange3d, margin.marginChange);
  const shortChange5d = firstNumber(payload.shortChange5d, payload.short_change_5d, dailyPayload.shortChange5d, dailyPayload.short_change_5d, margin.shortChange5d, margin.shortChange3d, margin.shortChange);
  const marginChange3To5d = Math.abs(marginChange5d) >= Math.abs(marginChange3d) ? marginChange5d : marginChange3d;
  const shortChange3To5d = Math.abs(shortChange5d) >= Math.abs(shortChange3d) ? shortChange5d : shortChange3d;
  const marginSampledDays = numberValue(margin.sampledDays);
  const hasMargin3To5d = marginSampledDays >= 3
    || payload.marginChange3d !== undefined
    || payload.margin_change_3d !== undefined
    || payload.marginChange5d !== undefined
    || payload.margin_change_5d !== undefined
    || dailyPayload.marginChange3d !== undefined
    || dailyPayload.margin_change_3d !== undefined
    || dailyPayload.marginChange5d !== undefined
    || dailyPayload.margin_change_5d !== undefined;
  const exDividendDate = firstText(
    payload.exDividendDate,
    payload.ex_dividend_date,
    payload.exRightDate,
    payload.ex_right_date,
    payload.dividendDate,
    payload.dividend_date,
    payload.exDividendDates,
    payload.ex_dividend_dates,
    dailyPayload.exDividendDate,
    dailyPayload.ex_dividend_date,
    dailyPayload.exRightDate,
    dailyPayload.ex_right_date,
    dailyPayload.dividendDate,
    dailyPayload.dividend_date,
    dailyPayload.exDividendDates,
    dailyPayload.ex_dividend_dates,
  );
  const exDividend3To5d = boolValue(
    payload.isExDividend3To5d
      || payload.exDividend3To5d
      || payload.ex_dividend_3_5d
      || payload.recentExDividend
      || payload.recent_ex_dividend
      || dailyPayload.isExDividend3To5d
      || dailyPayload.exDividend3To5d
      || dailyPayload.ex_dividend_3_5d
      || dailyPayload.recentExDividend
      || dailyPayload.recent_ex_dividend,
  ) || isRecentTaipeiDate(exDividendDate, 5);
  const exDividend = boolValue(payload.isExDividend || payload.is_ex_dividend || payload.exDividendToday || dailyPayload.isExDividend || dailyPayload.is_ex_dividend || dailyPayload.exDividendToday) || exDividend3To5d;
  const marginShortBothUp3To5d = hasMargin3To5d && (
    (marginChange3d > 0 && shortChange3d > 0)
    || (marginChange5d > 0 && shortChange5d > 0)
    || (marginChange3To5d > 0 && shortChange3To5d > 0)
  );
  const daytradeCrowdedBasis = [];
  if (boolValue(
    payload.daytradeCrowded3To5d
      || payload.daytrade_crowded_3_5d
      || payload.daytradeBigPlayer3To5d
      || payload.overnightDaytradeCrowded3To5d
      || payload.recentDaytradeCrowded
      || dailyPayload.daytradeCrowded3To5d
      || dailyPayload.daytrade_crowded_3_5d
      || dailyPayload.daytradeBigPlayer3To5d
      || dailyPayload.overnightDaytradeCrowded3To5d
      || dailyPayload.recentDaytradeCrowded,
  )) {
    daytradeCrowdedBasis.push("payload_3_5d_flag");
  }
  if (turnoverRate3To5d >= 20) daytradeCrowdedBasis.push("turnover_3_5d_ge20");
  if (turnoverRate3To5d >= 10 && marginShortBothUp3To5d) daytradeCrowdedBasis.push("turnover_margin_short_both_up_3_5d");
  if (turnoverRate3To5d >= 8 && volumeRatio5 >= 2 && shortChange3To5d > 0) daytradeCrowdedBasis.push("volume_turnover_short_up_3_5d");
  const daytradeCrowded3To5d = daytradeCrowdedBasis.length > 0;
  const daytradeCrowded = boolValue(payload.daytradeCrowded || payload.daytrade_crowded || payload.daytradeBigPlayer || dailyPayload.daytradeCrowded || dailyPayload.daytrade_crowded || dailyPayload.daytradeBigPlayer) || daytradeCrowded3To5d;
  return {
    price,
    quotePresent,
    openPrice,
    previousClose,
    amplitudeFromOpen,
    changePercent,
    totalVolume,
    tradeValue,
    avgVolume5,
    previousVolume,
    issuedShares,
    volumeRatio5,
    projectedVolume,
    estimatedVolumeRatio,
    estimatedVolumeRatioUsable,
    ma3,
    ma5,
    ma10,
    ma30,
    ma58,
    ma3Rising,
    ma5Rising,
    ma10Rising,
    ma30Rising,
    ma58Rising,
    aboveMa30,
    aboveMa58,
    openingRangeBreak,
    middleGateBreak,
    threeBottomPattern,
    dynamicThreeGateBreak,
    tongziPattern,
    divergencePattern,
    vTurnPattern,
    trackedBuyPointActive,
    intraday1mStaleSeconds: latestCandleAgeSeconds,
    quoteAgeSeconds: ageSeconds(quoteFreshnessTime(quote)),
    quoteUpdatedAt: quoteFreshnessTime(quote) || "",
    fibSupport,
    ma10PullbackSupport,
    wBottomNecklineBreak,
    scatterGunPattern,
    pppPattern,
    rapidGainIncrease,
    surgeFlag,
    volumeSpikeFlag,
    candleCount,
    firstCandleTime,
    lastCandleTime,
    dataGap,
    sectorName,
    sectorStrengthScore,
    ma3Ma5Ma10Bullish,
    ma5Ma10Ma30Bullish,
    movingAverageTurnBullish,
    highPrice,
    lowPrice,
    limitUpPrice,
    groupKeys: stockGroupKeys(activeRow, payload, dailyPayload, groupContract),
    groupContract,
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
    marginChange3d,
    shortChange3d,
    marginChange5d,
    shortChange5d,
    marginChange3To5d,
    shortChange3To5d,
    marginSampledDays,
    hasMargin3To5d,
    stockFutureInitial0846: stockFuture,
    stockFutureInitial0846Ok: stockFuture.futoptChangePercent >= 2
      && stockFuture.relativeToTxfPercent >= 1
      && stockFuture.futoptTotalVolume >= 50,
    exDividend,
    exDividend3To5d,
    exDividendDate,
    daytradeCrowded,
    daytradeCrowded3To5d,
    daytradeCrowdedBasis,
    quoteFresh,
    fieldCoverage: {
      quote: Boolean(quoteMap?.has(symbol)),
      changePercent: Number.isFinite(changePercent),
      totalVolume: totalVolume > 0,
      tradeValue: tradeValue > 0,
      avgVolume5: avgVolume5 > 0,
      issuedShares: issuedShares > 0,
      turnover3To5d: turnoverRate3To5d > 0,
      insideOutside: sideTotal > 0,
      bidAsk: bidAskRatio > 0,
      institution: foreignNet !== 0 || trustNet !== 0 || dealerNet !== 0 || mainForceNet !== 0,
      marginShort: marginChange3To5d !== 0 || shortChange3To5d !== 0 || marginChange !== 0 || shortChange !== 0,
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

function readFutoptWebSocketCacheRows() {
  const cache = readFugleFutoptWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  const rows = [...cache.quotes.values()].map((quote) => ({
    future_symbol: String(quote.future_symbol || "").trim().toUpperCase(),
    underlying_symbol: normalizeCode(quote.underlying_symbol) || (String(quote.future_symbol || "").startsWith("TXF") ? "TXF" : ""),
    updated_at: quote.updated_at || quote.quoteSeenAt || cache.payload?.updatedAt || nowIso(),
    total_volume: numberValue(quote.total_volume),
    source: "fugle-futopt-websocket-cache",
  })).filter((row) => row.future_symbol);
  rows.readinessSource = "fugle_futopt_websocket_cache";
  rows.mappedCount = rows.filter((row) => normalizeCode(row.underlying_symbol) && ageSeconds(row.updated_at) <= 120).length;
  rows.cacheCount = cache.quotes.size;
  return rows;
}
async function fetchIntradayStatus(activeSymbols = []) {
  const toMap = (rows, readinessSource) => {
    const map = new Map(rows.map((row) => [normalizeCode(row.symbol), row]).filter(([symbol]) => symbol));
    map.readinessSource = readinessSource;
    return map;
  };
  const buildGrouped = (rows, tradeDate) => {
    const grouped = new Map();
    for (const row of rows) {
      const symbol = normalizeCode(row.symbol);
      if (!symbol) continue;
      const current = grouped.get(symbol) || {
        symbol,
        market: row.market || "",
        latest_candle_time: "",
        first_candle_time: "",
        today_candle_count: 0,
        warmup_candle_count: 0,
        continuous_candle_count: 0,
        ready_ma3: false,
        ready_ma5: false,
        ready_ma10: false,
        ready_ma20_continuous: false,
        ready_ma30: false,
        ready_ma58: false,
        ready_ma35_continuous: false,
        latest_candle_age_seconds: 999999,
        _closes: [],
        _volumes: [],
        _highs: [],
        _lows: [],
      };
      const candleTime = normalizeTimestamp(row.candle_time || row.updated_at);
      if (String(row.trade_date || "") === tradeDate || taipeiDateFrom(candleTime) === tradeDate) current.today_candle_count += 1;
      current.warmup_candle_count += 1;
      current.continuous_candle_count += 1;
      const close = numberValue(row.close);
      if (close > 0) current._closes.push(close);
      current._volumes.push(Math.max(0, numberValue(row.volume)));
      current._highs.push(Math.max(0, numberValue(row.high, close)));
      current._lows.push(Math.max(0, numberValue(row.low, close)));
      if (candleTime && (!current.first_candle_time || Date.parse(candleTime) < Date.parse(current.first_candle_time))) {
        current.first_candle_time = candleTime;
      }
      if (candleTime && (!current.latest_candle_time || Date.parse(candleTime) > Date.parse(current.latest_candle_time))) {
        current.latest_candle_time = candleTime;
        current.latest_candle_age_seconds = ageSeconds(candleTime);
      }
      current.ready_ma3 = current.continuous_candle_count >= 3;
      current.ready_ma5 = current.continuous_candle_count >= 5;
      current.ready_ma10 = current.continuous_candle_count >= 10;
      current.ready_ma20_continuous = current.continuous_candle_count >= 20;
      current.ready_ma30 = current.continuous_candle_count >= 30;
      current.ready_ma58 = current.continuous_candle_count >= 58;
      current.ready_ma35_continuous = current.continuous_candle_count >= 35;
      grouped.set(symbol, current);
    }
    for (const current of grouped.values()) {
      const closes = current._closes || [];
      const volumes = current._volumes || [];
      const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      const movingAverage = (count, offset = 0) => average(closes.slice(offset, offset + count));
      const volumeSum = (count, offset = 0) => volumes.slice(offset, offset + count).reduce((sum, value) => sum + value, 0);
      current.ma3 = movingAverage(3);
      current.ma5 = movingAverage(5);
      current.ma10 = movingAverage(10);
      current.ma20 = movingAverage(20);
      current.ma30 = movingAverage(30);
      current.ma35 = movingAverage(35);
      current.ma58 = movingAverage(58);
      current.ma5_ma10_ma35_bullish = Number.isFinite(current.ma5)
        && Number.isFinite(current.ma10)
        && Number.isFinite(current.ma35)
        && current.ma5 > current.ma10
        && current.ma10 > current.ma35
        && current.ma35 > 0;
      current.ma_bullish_alignment = current.ma5_ma10_ma35_bullish;
      current.ma3_rising = closes.length >= 6 && movingAverage(3, 0) > movingAverage(3, 3);
      current.ma5_rising = closes.length >= 10 && movingAverage(5, 0) > movingAverage(5, 5);
      current.ma10_rising = closes.length >= 20 && movingAverage(10, 0) > movingAverage(10, 10);
      current.ma30_rising = closes.length >= 60 && movingAverage(30, 0) > movingAverage(30, 30);
      current.ma35_rising = closes.length >= 70 && movingAverage(35, 0) > movingAverage(35, 35);
      current.ma58_rising = closes.length >= 116 && movingAverage(58, 0) > movingAverage(58, 58);
      const latestVolume = volumeSum(3, 0);
      const previousVolume = volumeSum(3, 3);
      current.recent_1m_volume_trend = previousVolume <= 0
        ? 'unknown'
        : latestVolume > previousVolume * 1.05
          ? 'expanding'
          : latestVolume < previousVolume * 0.85
            ? 'shrinking'
            : 'stable';
      const recentFive = average(volumes.slice(0, 5));
      const priorTwenty = average(volumes.slice(5, 25));
      current.relative_volume_5m = recentFive !== null && priorTwenty > 0 ? recentFive / priorTwenty : 0;

      // Indicators use the chronological candle order. Insufficient history stays null.
      const chronologicalCloses = closes.slice().reverse();
      const emaSeries = (values, period) => {
        if (values.length < period) return [];
        const multiplier = 2 / (period + 1);
        let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
        const series = [ema];
        for (const value of values.slice(period)) {
          ema = ((value - ema) * multiplier) + ema;
          series.push(ema);
        }
        return series;
      };
      if (chronologicalCloses.length >= 35) {
        const fast = emaSeries(chronologicalCloses, 12);
        const slow = emaSeries(chronologicalCloses, 26);
        const macdSeries = [];
        for (let i = 0; i < slow.length; i += 1) {
          const fastIndex = i + (26 - 12);
          if (fast[fastIndex] !== undefined) macdSeries.push(fast[fastIndex] - slow[i]);
        }
        const signal = emaSeries(macdSeries, 9);
        current.macd_line = macdSeries.length ? macdSeries[macdSeries.length - 1] : null;
        current.macd_signal = signal.length ? signal[signal.length - 1] : null;
        current.macd_histogram = Number.isFinite(current.macd_line) && Number.isFinite(current.macd_signal)
          ? current.macd_line - current.macd_signal
          : null;
      } else {
        current.macd_line = null;
        current.macd_signal = null;
        current.macd_histogram = null;
      }
      const chronologicalHighs = (current._highs || []).slice().reverse();
      const chronologicalLows = (current._lows || []).slice().reverse();
      if (chronologicalCloses.length >= 9 && chronologicalHighs.length >= 9 && chronologicalLows.length >= 9) {
        let k = 50;
        let d = 50;
        for (let i = 8; i < chronologicalCloses.length; i += 1) {
          const high = Math.max(...chronologicalHighs.slice(i - 8, i + 1));
          const low = Math.min(...chronologicalLows.slice(i - 8, i + 1));
          const rsv = high > low ? ((chronologicalCloses[i] - low) / (high - low)) * 100 : 50;
          k = ((2 * k) + rsv) / 3;
          d = ((2 * d) + k) / 3;
        }
        current.kd_k = k;
        current.kd_d = d;
      } else {
        current.kd_k = null;
        current.kd_d = null;
      }
      if (chronologicalCloses.length >= 15) {
        const recent = chronologicalCloses.slice(-15);
        let gains = 0;
        let losses = 0;
        for (let i = 1; i < recent.length; i += 1) {
          const delta = recent[i] - recent[i - 1];
          if (delta > 0) gains += delta;
          else losses -= delta;
        }
        const averageGain = gains / 14;
        const averageLoss = losses / 14;
        current.rsi14 = averageLoss === 0 ? 100 : 100 - (100 / (1 + (averageGain / averageLoss)));
      } else {
        current.rsi14 = null;
      }
      delete current._closes;
      delete current._volumes;
      delete current._highs;
      delete current._lows;
    }
    return grouped;
  };
  const tradeDate = taipeiDateFrom(nowIso());
  const finalizeIntradayMap = async (rows, readinessSource) => toMap(rows, readinessSource);
  // The authenticated Fugle candle cache is the lowest-latency formal source.
  // Build readiness locally before querying Supabase views that can time out under load.
  try {
    const cache = readFugleWebSocketCandles({ maxAgeMs: WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS });
    const cacheRows = [...cache.candles.values()].map((candle) => ({
      ...candle,
      symbol: normalizeCode(candle.symbol || candle.code),
      candle_time: normalizeTimestamp(candle.candle_time || candle.candleTime || candle.date),
      trade_date: candle.trade_date || candle.tradeDate || taipeiDateFrom(candle.candle_time || candle.candleTime || candle.date),
      updated_at: candle.updated_at || candle.candleSeenAt || cache.payload?.updatedAt || nowIso(),
    }));
    const grouped = buildGrouped(cacheRows, tradeDate);
    const freshRows = [...grouped.values()].filter((row) =>
      numberValue(row.today_candle_count) > 0
      && numberValue(row.latest_candle_age_seconds, 999999) <= MAX_INTRADAY_1M_STALE_SECONDS
    );
    const cacheReady20Rows = freshRows.filter((row) => numberValue(row.continuous_candle_count) >= 20 || boolValue(row.ready_ma20_continuous));
    if (cacheReady20Rows.length >= 40) return finalizeIntradayMap([...grouped.values()], "fugle_websocket_candles_cache_formal");
  } catch {
    // Continue to persisted formal sources when the local cache is unavailable.
  }

  try {
    const rows = await supabaseGetPaged(
      "v_fugle_daytrade_intraday_1m_status",
      "select=symbol,latest_candle_time,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma3,ready_ma5,ready_ma10,ready_ma20_continuous,ready_ma30,ready_ma58,ready_ma35_continuous,latest_candle_age_seconds,ma3,ma5,ma10,ma20,ma30,ma35,ma58,ma3_rising,ma5_rising,ma10_rising,ma30_rising,ma35_rising,ma58_rising,ma5_ma10_ma35_bullish,ma_bullish_alignment",
      { service: true, pageSize: 1000 },
    );
    if (rows.length) {
      const currentReadyRows = rows.filter((row) =>
        taipeiDateFrom(row.latest_candle_time || "") === taipeiDateFrom(nowIso())
        && numberValue(row.today_candle_count) > 0
        && numberValue(row.latest_candle_age_seconds, 999999) <= MAX_INTRADAY_1M_STALE_SECONDS
      );
      const collapsedRows = rows.filter((row) => numberValue(row.today_candle_count) <= 1 && numberValue(row.continuous_candle_count) <= 1).length;
      const viewLooksQuoteCollapsed = collapsedRows >= Math.min(10, rows.length);
      // The cache view may contain quote-derived rows from an older writer.
      // It is diagnostic only; raw candle/RPC reads below are authoritative.
      if (false && currentReadyRows.length >= Math.min(40, rows.length) && !viewLooksQuoteCollapsed) {
        return finalizeIntradayMap(rows, "dedicated_daytrade_intraday_1m_view_fresh" );
      }
    }
  } catch {
    // The view may timeout under load; use the narrow dedicated-table read below.
  }

  try {
    const symbols = [...new Set((activeSymbols || []).map((row) => normalizeCode(row.symbol || row)).filter(Boolean))];
    // Use one server-side batch for the active universe. Sequential 200-symbol
    // RPC calls can exceed the bounded writer tick and leave Task Scheduler stuck.
    const rpcRows = await supabaseRpc(
      'get_fugle_daytrade_intraday_1m_latest_n',
      { symbols, bars_per_symbol: 200 },
      { service: true },
    );
    const grouped = buildGrouped(Array.isArray(rpcRows) ? rpcRows : [], tradeDate);
    if (grouped.size) return finalizeIntradayMap([...grouped.values()], 'dedicated_daytrade_intraday_1m_latest_n_rpc');
  } catch {
    // Fall through to direct reads; a missing/slow RPC must not weaken the gate.
  }
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_intraday_1m",
      "select=symbol,market,candle_time,trade_date,open,high,low,close,volume,source,synthetic,volume_strategy_usable,updated_at&trade_date=eq." + encodeURIComponent(tradeDate) + "&order=symbol.asc,candle_time.desc",
      { service: true, pageSize: 1000 },
    );
    const grouped = buildGrouped(rows, tradeDate);
    if (grouped.size) return finalizeIntradayMap([...grouped.values()], "dedicated_daytrade_intraday_1m_direct_today");
  } catch {
    // A current-day read failure is diagnosed separately; do not call it an empty source yet.
  }

  const warmupCutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_intraday_1m",
      "select=symbol,market,candle_time,trade_date,open,high,low,close,volume,source,synthetic,volume_strategy_usable,updated_at&candle_time=gte." + encodeURIComponent(warmupCutoff),
      { service: true, pageSize: 1000 },
    );
    const grouped = buildGrouped(rows, tradeDate);
    if (grouped.size) return finalizeIntradayMap([...grouped.values()], "dedicated_daytrade_intraday_1m_direct_warmup");
  } catch {
    const failed = toMap([], "dedicated_daytrade_intraday_1m_read_failed");
    failed.readError = true;
    return failed;
  }
  const empty = toMap([], "dedicated_daytrade_intraday_1m_empty");
  empty.readError = false;
  return empty;
}

function priorityPoolDbRows(rows) {
  return (rows || []).map((row) => ({
    symbol: row.symbol,
    name: row.name || row.symbol,
    market: row.market || null,
    priority_rank: Number.isFinite(Number(row.priority_rank)) ? Number(row.priority_rank) : 999999,
    hot_extension_rank: Number.isFinite(Number(row.hot_extension_rank)) ? Number(row.hot_extension_rank) : null,
    priority_reason: row.priority_reason || "",
    source: row.source || "daytrade_priority_pool",
    updated_at: row.updated_at || nowIso(),
    payload: {
      ...(row.payload || {}),
      trade_date: String(row.payload?.trade_date || taipeiDate()),
      canonical_run_id: String(row.payload?.canonical_run_id || `${SOURCE_NAME}:${compactDateKey(taipeiDate())}:canonical`),
      canonical_pool_layer: String(row.payload?.canonical_pool_layer || row.payload?.pool_layer || poolLayerForRank(Number(row.priority_rank))),
      pool_reasons: Array.isArray(row.poolReasons) ? row.poolReasons : [],
    },
  }));
}

function intradayStatusCacheRows(intradayMap) {
  return [...(intradayMap || new Map()).entries()]
    .map(([symbol, row]) => {
      const latestCandleTime = normalizeTimestamp(row.latest_candle_time || row.updated_at, '');
      const tradeDate = String(row.trade_date || '').slice(0, 10) || (latestCandleTime ? taipeiDateFrom(latestCandleTime) : '');
      return {
        symbol: normalizeCode(symbol),
        market: row.market || null,
        latest_candle_time: latestCandleTime || null,
        today_candle_count: Math.max(0, Math.floor(numberValue(row.today_candle_count))),
        warmup_candle_count: Math.max(0, Math.floor(numberValue(row.warmup_candle_count))),
        continuous_candle_count: Math.max(0, Math.floor(numberValue(row.continuous_candle_count))),
        ready_ma3: boolValue(row.ready_ma3),
        ready_ma20_continuous: boolValue(row.ready_ma20_continuous),
        ready_ma35_continuous: boolValue(row.ready_ma35_continuous),
        latest_candle_age_seconds: Math.max(0, Math.floor(numberValue(row.latest_candle_age_seconds, 999999))),
        ready_ma58: boolValue(row.ready_ma58),
        ready_ma5: boolValue(row.ready_ma5),
        ready_ma10: boolValue(row.ready_ma10),
        ready_ma30: boolValue(row.ready_ma30),
        ma35: Number.isFinite(Number(row.ma35)) ? Number(row.ma35) : null,
        ma3: Number.isFinite(Number(row.ma3)) ? Number(row.ma3) : null,
        ma5: Number.isFinite(Number(row.ma5)) ? Number(row.ma5) : null,
        ma10: Number.isFinite(Number(row.ma10)) ? Number(row.ma10) : null,
        ma20: Number.isFinite(Number(row.ma20)) ? Number(row.ma20) : null,
        ma30: Number.isFinite(Number(row.ma30)) ? Number(row.ma30) : null,
        ma58: Number.isFinite(Number(row.ma58)) ? Number(row.ma58) : null,
        ma5_ma10_ma35_bullish: boolValue(row.ma5_ma10_ma35_bullish),
        ma_bullish_alignment: boolValue(row.ma_bullish_alignment),
        ma3_rising: boolValue(row.ma3_rising),
        ma5_rising: boolValue(row.ma5_rising),
        ma10_rising: boolValue(row.ma10_rising),
        ma30_rising: boolValue(row.ma30_rising),
        ma35_rising: boolValue(row.ma35_rising),
        ma58_rising: boolValue(row.ma58_rising),
        relative_volume_5m: Number.isFinite(Number(row.relative_volume_5m)) ? Number(row.relative_volume_5m) : 0,
        recent_1m_volume_trend: String(row.recent_1m_volume_trend || 'unknown'),
        macd_line: Number.isFinite(Number(row.macd_line)) ? Number(row.macd_line) : null,
        macd_signal: Number.isFinite(Number(row.macd_signal)) ? Number(row.macd_signal) : null,
        macd_histogram: Number.isFinite(Number(row.macd_histogram)) ? Number(row.macd_histogram) : null,
        kd_k: Number.isFinite(Number(row.kd_k)) ? Number(row.kd_k) : null,
        kd_d: Number.isFinite(Number(row.kd_d)) ? Number(row.kd_d) : null,
        rsi14: Number.isFinite(Number(row.rsi14)) ? Number(row.rsi14) : null,
        trade_date: tradeDate || null,
        source: row.source || 'fugle_daytrade_source_writer',
        updated_at: nowIso(),
      };
    })
    .filter((row) => /^\d{4}$/.test(row.symbol));
}

async function syncIntradayStatusCache(intradayMap, motherPoolRows = []) {
  if (DRY_RUN || !intradayMap?.size) return { written: 0, skipped: true, reason: 'dry_run_or_empty' };
  const now = Date.now();
  if (now - lastIntradayStatusCacheSyncAt < INTRADAY_STATUS_CACHE_SYNC_INTERVAL_MS) {
    return { written: 0, skipped: true, reason: 'interval_cooldown' };
  }
  const motherPoolSymbols = new Set((motherPoolRows || []).map((row) => normalizeCode(row.symbol || row)).filter(Boolean));
  const scopedMap = motherPoolSymbols.size
    ? new Map([...intradayMap].filter(([symbol]) => motherPoolSymbols.has(normalizeCode(symbol))))
    : intradayMap;
  const rows = intradayStatusCacheRows(scopedMap);
  if (!rows.length) return { written: 0, skipped: true, reason: 'no_valid_rows' };
  try {
    const result = await supabaseUpsert(
      'fugle_daytrade_intraday_1m_status_cache',
      rows,
      'symbol',
      { batchSize: 250, timeoutMs: 15000, retries: 1 },
    );
    lastIntradayStatusCacheSyncAt = now;
    return { written: result.written || 0, skipped: false, rows: rows.length };
  } catch (error) {
    return {
      written: 0,
      skipped: false,
      rows: rows.length,
      error: error?.message || String(error),
    };
  }
}
function readWarmupNaturalEvidenceCounts() {
  const tradeDate = taipeiDateFrom(nowIso());
  const candidates = [
    path.join(WARMUP_EVIDENCE_DIR, "daytrade-unattended-gate-0900.json"),
    statePath(`daytrade-warmup-unattended-summary-${tradeDate.replace(/\D/g, "")}.json`),
  ];
  for (const file of candidates) {
    const row = readJson(file, null);
    const evidence = row?.phase_results?.["0900"]?.evidence || row;
    const rowTradeDate = String(evidence?.trade_date || evidence?.tradeDate || row?.trade_date || row?.tradeDate || "").replace(/\D/g, "");
    if (rowTradeDate !== tradeDate.replace(/\D/g, "")) continue;
    if (evidence?.naturalScheduleEvidence !== true && evidence?.natural_schedule_evidence !== true && row?.natural_schedule_evidence !== true) continue;
    return {
      source: file,
      readyMa20: numberValue(evidence.readyMa20Continuous ?? evidence.ready_ma20_continuous ?? evidence.ready_ma20_continuous_symbols),
      readyMa35: numberValue(evidence.readyMa35Continuous ?? evidence.ready_ma35_continuous ?? evidence.ready_ma35_continuous_symbols),
      quoteAgeSeconds: numberValue(evidence.quoteAgeSeconds ?? evidence.quote_age_seconds, 999999),
      priorityCoverage: numberValue(evidence.priorityFreshQuoteCoverage120s ?? evidence.priority_fresh_quote_coverage_120s),
      scannerCanRunOpening: boolValue(evidence.scannerCanRunOpening ?? evidence.scanner_can_run_opening),
    };
  }
  return null;
}
function mergeWebSocketQuoteDerivedIntradayStatus(intradayMap, priorityRows) {
  // Quotes can discover candidates, but they are not 1-minute candles.
  // Never manufacture candle_count/latest_candle_time/stale values from a quote.
  intradayMap.websocketQuoteDerivedStatusMerged = 0;
  intradayMap.quoteDerivedStatusPolicy = "discovery_only_not_1m_readiness";
  return intradayMap;
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
    const readyMa3 = boolValue(previous.ready_ma3) || previousContinuous >= 3;
    const readyMa5 = boolValue(previous.ready_ma5) || previousContinuous >= 5;
    const readyMa10 = boolValue(previous.ready_ma10) || previousContinuous >= 10;
    const readyMa20 = boolValue(previous.ready_ma20_continuous) || previousContinuous >= 20;
    const readyMa30 = boolValue(previous.ready_ma30) || previousContinuous >= 30;
    const readyMa35 = boolValue(previous.ready_ma35_continuous) || boolValue(previous.ready_ge_35) || previousContinuous >= 35;
    const readyMa58 = boolValue(previous.ready_ma58) || previousContinuous >= 58;
    intradayMap.set(symbol, {
      ...previous,
      symbol,
      latest_candle_time: seenAt,
      today_candle_count: Math.max(previousToday, 1),
      warmup_candle_count: Math.max(numberValue(previous.warmup_candle_count), previousContinuous, readyMa35 ? 35 : readyMa20 ? 20 : 1),
      continuous_candle_count: Math.max(previousContinuous, readyMa35 ? 35 : readyMa20 ? 20 : 1),
      ready_ma5: readyMa5,
      ready_ma10: readyMa10,
      ready_ma3: readyMa3,
      ready_ma20_continuous: readyMa20,
      ready_ma30: readyMa30,
      ready_ma35_continuous: readyMa35,
      ready_ma58: readyMa58,
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
  const cacheRows = readFutoptWebSocketCacheRows();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_futopt_quotes_live",
      "select=future_symbol,underlying_symbol,product,last_price,change_percent,total_volume,updated_at&order=updated_at.desc",
      { service: true },
    );
    rows.readinessSource = "dedicated_daytrade_futopt_quotes_live";
    rows.mappedCount = rows.filter((row) => normalizeCode(row.underlying_symbol) && ageSeconds(row.updated_at) <= 120).length;
    rows.cacheCount = cacheRows.cacheCount || 0;
    if (rows.mappedCount >= MIN_FUTOPT_MAPPED) return rows;
    if (cacheRows.mappedCount >= MIN_FUTOPT_MAPPED) return cacheRows;
    if (rows.length) return rows;
  } catch {
    if (cacheRows.mappedCount >= MIN_FUTOPT_MAPPED || cacheRows.length) return cacheRows;
  }
  const out = [];
  out.readinessSource = "missing_futopt_readiness";
  out.mappedCount = 0;
  out.cacheCount = cacheRows.cacheCount || 0;
  return out;
}

async function fetchStockFutureInitialMap() {
  const map = new Map();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_futopt_quotes_live",
      "select=future_symbol,underlying_symbol,last_price,change_percent,total_volume,product,updated_at,payload&order=updated_at.desc",
      { service: true, pageSize: 1000 },
    );
    const txf = rows.find((row) => String(row.product || row.payload?.product || "").toUpperCase() === "TXF" || String(row.future_symbol || "").toUpperCase().startsWith("TXF"));
    const txfChange = numberValue(txf?.change_percent ?? txf?.payload?.changePercent);
    for (const row of rows) {
      const product = String(row.product || row.payload?.product || "").toUpperCase();
      const futureSymbol = String(row.future_symbol || "").trim().toUpperCase();
      if (product !== "STOCK_FUTURE") continue;
      const symbol = normalizeCode(row.underlying_symbol || row.payload?.underlying_symbol || row.payload?.underlyingSymbol);
      if (!symbol || ageSeconds(row.updated_at) > 180) continue;
      const change = numberValue(row.change_percent ?? row.payload?.changePercent);
      const volume = numberValue(row.total_volume ?? row.payload?.total?.tradeVolume);
      const relative = change - txfChange;
      if (change < 2 || relative < 1 || volume < 50) continue;
      map.set(symbol, {
        tradeDate: String(row.payload?.date || ""),
        stockName: String(row.payload?.underlying_name || row.payload?.name || "").trim(),
        futureSymbol,
        futoptLastPrice: numberValue(row.last_price ?? row.payload?.lastPrice),
        futoptChangePercent: change,
        futoptTotalVolume: volume,
        txfChangePercent: txfChange,
        relativeToTxfPercent: relative,
        sourceStatus: "ready",
        futoptUpdatedAt: row.updated_at || "",
        source: "fugle_daytrade_futopt_quotes_live",
      });
    }
  } catch {
    return map;
  }
  return map;
}
function addGroupContractRow(map, row, source) {
  const symbol = normalizeCode(row?.symbol || row?.code);
  if (!symbol) return;
  const themes = Array.isArray(row?.themes)
    ? row.themes
    : String(row?.themes || "").split(",").map((item) => item.trim()).filter(Boolean);
  const previous = map.get(symbol) || {};
  map.set(symbol, {
    ...previous,
    symbol,
    name: row?.name || previous.name || "",
    industry: row?.industry || row?.officialIndustry || previous.industry || "",
    sector: row?.sector || row?.heatmapSector || row?.primaryIndustry || previous.sector || "",
    heatmapSector: row?.heatmapSector || row?.sector || previous.heatmapSector || "",
    primaryIndustry: row?.primaryIndustry || row?.sector || row?.heatmapSector || previous.primaryIndustry || "",
    officialIndustry: row?.officialIndustry || row?.industry || previous.officialIndustry || "",
    group: row?.group || previous.group || "",
    themes: uniqueTexts([...(previous.themes || []), ...themes]),
    source: row?.source || source || previous.source || "unknown",
    confidence: row?.confidence || previous.confidence || "",
    updatedAt: row?.updated_at || row?.updatedAt || previous.updatedAt || "",
  });
}

function extractConstObjectLiteral(source, name) {
  const marker = `const ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const braceStart = source.indexOf("{", start + marker.length);
  if (braceStart < 0) return null;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, index + 1);
    }
  }
  return null;
}

function readHeatmapStaticGroupMap() {
  const map = new Map();
  const source = readText(HEATMAP_API_FILE);
  if (!source) {
    map.meta = { source: "missing", rows: 0 };
    return map;
  }
  const literal = extractConstObjectLiteral(source, "BB_HEATMAP_GROUPS");
  if (!literal) {
    map.meta = { source: "missing_heatmap_static_groups", rows: 0 };
    return map;
  }
  let groups = {};
  try {
    groups = Function(`"use strict"; return (${literal});`)();
  } catch (error) {
    map.meta = { source: "invalid_heatmap_static_groups", rows: 0, error: error?.message || String(error) };
    return map;
  }
  for (const [group, symbols] of Object.entries(groups || {})) {
    for (const symbol of Array.isArray(symbols) ? symbols : []) {
      addGroupContractRow(map, {
        symbol,
        sector: group,
        heatmapSector: group,
        primaryIndustry: group,
        themes: [group],
        source: "api/heatmap.js:BB_HEATMAP_GROUPS",
        confidence: "medium",
        updatedAt: "2026-07-09T00:00:00+08:00",
      }, "api/heatmap.js:BB_HEATMAP_GROUPS");
    }
  }
  map.meta = { source: "api/heatmap.js:BB_HEATMAP_GROUPS", rows: map.size, updatedAt: "2026-07-09T00:00:00+08:00" };
  return map;
}

async function fetchStockGroupContractMap() {
  const map = new Map();
  const meta = { source: "missing", rows: 0 };
  try {
    const rows = await supabaseGetPaged(
      "v_daytrade_stock_group_contract",
      "select=symbol,name,industry,sector,heatmap_sector,primary_industry,official_industry,themes,source,confidence,updated_at&order=symbol.asc",
      { service: true, pageSize: 1000 },
    );
    for (const row of rows) {
      addGroupContractRow(map, {
        symbol: row.symbol,
        name: row.name,
        industry: row.industry,
        sector: row.sector,
        heatmapSector: row.heatmap_sector,
        primaryIndustry: row.primary_industry,
        officialIndustry: row.official_industry,
        themes: row.themes,
        source: row.source,
        confidence: row.confidence,
        updated_at: row.updated_at,
      }, "v_daytrade_stock_group_contract");
    }
    if (map.size) {
      map.meta = { source: "v_daytrade_stock_group_contract", rows: map.size };
      return map;
    }
  } catch (error) {
    meta.error = error?.message || String(error);
  }

  try {
    const snapshot = await readSnapshot("heatmap_latest", {
      tradeDate: taipeiDate().replace(/\D/g, ""),
      allowLatestFallback: true,
      timeoutMs: 1800,
    });
    const master = Array.isArray(snapshot?.payload?.industryMaster) ? snapshot.payload.industryMaster : [];
    for (const row of master) addGroupContractRow(map, row, "market_snapshots:heatmap_latest.industryMaster");
    if (map.size) {
      map.meta = { source: "market_snapshots:heatmap_latest.industryMaster", rows: map.size, updatedAt: snapshot.updatedAt || "" };
      return map;
    }
  } catch (error) {
    meta.snapshotError = error?.message || String(error);
  }

  for (const file of HEATMAP_LATEST_FILES) {
    const payload = readJson(file, null);
    const master = Array.isArray(payload?.industryMaster) ? payload.industryMaster : [];
    for (const row of master) addGroupContractRow(map, row, `file:${file}`);
    if (map.size) {
      map.meta = { source: `file:${file}`, rows: map.size, updatedAt: payload.updatedAt || "" };
      return map;
    }
  }

  const staticMap = readHeatmapStaticGroupMap();
  if (staticMap.size) return staticMap;

  map.meta = meta;
  return map;
}

function objectPayload(value) {
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }
  return value;
}

function compactDateKey(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function strategyPriorityRunValidation(run) {
  const payload = objectPayload(run?.payload);
  const status = String(run?.status || payload.status || "").trim().toLowerCase();
  const qualityStatus = String(run?.quality_status || run?.qualityStatus || payload.quality_status || payload.qualityStatus || "").trim().toLowerCase();
  const complete = run?.complete === true || payload.complete === true || status === "complete";
  const publishAllowed = run?.publish_allowed ?? run?.publishAllowed ?? payload.publish_allowed ?? payload.publishAllowed;
  // A complete-run view can place publish evidence inside its runtime snapshot.
  // Inspect both the top-level payload and nested evidence so fallback markers
  // cannot be missed while the formal gate remains fail-closed.
  const evidencePayloads = [
    payload,
    payload.run_quality_at_publish,
    payload.runQualityAtPublish,
    payload.run_time_source_snapshot,
    payload.runTimeSourceSnapshot,
    payload.run_time_source_snapshot?.run_quality_at_publish,
    payload.runTimeSourceSnapshot?.run_quality_at_publish,
  ].filter((value) => value && typeof value === 'object');
  const blocked = run?.publish_blocked === true
    || run?.publishBlocked === true
    || evidencePayloads.some((item) => (
      item.publish_blocked === true
      || item.publishBlocked === true
      || item.fallbackUsed === true
      || item.fallback_used === true
    ));
  const allowedStatus = new Set(["complete", "ok", "ready", "pass", "a"]);
  const allowedQuality = new Set(["complete", "ok", "ready", "pass", "a"]);
  let reason = "";
  if (!complete) reason = "run_incomplete";
  else if (!allowedStatus.has(status)) reason = "run_status_not_complete";
  else if (!allowedQuality.has(qualityStatus)) reason = "run_quality_not_publishable";
  else if (publishAllowed === false) reason = "run_publish_not_allowed";
  else if (blocked) reason = "run_fallback_or_previous_good";
  return {
    ok: !reason,
    reason,
    runId: String(run?.run_id || run?.runId || payload.run_id || payload.runId || ""),
    scanDate: compactDateKey(run?.scan_date || run?.scanDate || payload.scan_date || payload.scanDate),
    finishedAt: run?.finished_at || run?.finishedAt || payload.finished_at || payload.finishedAt || "",
    status,
    qualityStatus,
    publishAllowed: publishAllowed === undefined ? null : Boolean(publishAllowed),
    payload,
  };
}

function strategyPriorityStockCode(row, codeMode) {
  const payload = objectPayload(row?.payload);
  const values = codeMode === "underlying"
    ? [
      row?.underlying_code,
      row?.underlyingCode,
      payload.underlying_code,
      payload.underlyingCode,
      payload.underlying_stock_code,
      payload.underlyingStockCode,
      payload.stock_code,
      payload.stockCode,
      payload.code,
      row?.code,
      row?.symbol,
    ]
    : [
      row?.code,
      row?.symbol,
      payload.code,
      payload.symbol,
      payload.stock_code,
      payload.stockCode,
    ];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (/^\d{4}$/.test(raw)) return raw;
  }
  return "";
}

async function readStrategyPriorityBridgeSource(source) {
  const latestRows = await supabaseGet(source.latestResource, source.latestQuery);
  const run = Array.isArray(latestRows) ? latestRows[0] : null;
  if (!run) {
    return {
      key: source.key,
      status: "empty",
      symbols: [],
      reason: "latest_complete_run_missing",
      runId: "",
      scanDate: "",
      qualityStatus: "",
      resultRows: 0,
    };
  }
  const validation = strategyPriorityRunValidation(run);
  const base = {
    key: source.key,
    status: validation.ok ? "ready" : "blocked",
    symbols: [],
    reason: validation.ok ? "" : validation.reason,
    runId: validation.runId,
    scanDate: validation.scanDate,
    finishedAt: validation.finishedAt,
    qualityStatus: validation.qualityStatus,
    publishAllowed: validation.publishAllowed,
    resultRows: 0,
  };
  if (!validation.ok || !validation.runId) return base;
  const query = [
    "select=" + source.resultSelect,
    "run_id=eq." + encodeURIComponent(validation.runId),
    "limit=" + STRATEGY_PRIORITY_BRIDGE_MAX_ROWS,
    source.key === "cb" ? "order=updated_at.desc" : "order=rank.asc",
  ].join("&");
  const rows = await supabaseGet(source.resultsResource, query);
  const symbols = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = strategyPriorityStockCode(row, source.codeMode);
    if (!code || seen.has(code)) continue;
    const rowQuality = String(row?.quality_status || "").trim().toLowerCase();
    if (row?.complete === false || (rowQuality && !new Set(["complete", "ok", "ready", "pass", "a"]).has(rowQuality))) continue;
    seen.add(code);
    symbols.push(code);
  }
  return {
    ...base,
    status: symbols.length ? "ready" : "empty",
    symbols,
    resultRows: Array.isArray(rows) ? rows.length : 0,
    symbolCount: symbols.length,
  };
}


function buildFormalStrategyChipArtifact(bridge, formalPrioritySymbols = [], fallbackTradeDate = taipeiDate()) {
  const groups = {};
  const formalSet = new Set((Array.isArray(formalPrioritySymbols) ? formalPrioritySymbols : [])
    .map((value) => normalizeCode(value))
    .filter((value) => /^\d{4}$/.test(value)));
  const bridgeGroups = objectPayload(bridge?.groups);
  for (const source of STRATEGY_PRIORITY_BRIDGE_SOURCES) {
    const group = objectPayload(bridgeGroups[source.key]);
    const sourceSymbols = (Array.isArray(group.symbols) ? group.symbols : [])
      .map((value) => normalizeCode(value))
      .filter((value) => /^\d{4}$/.test(value));
    const formalPriorityMatchedSymbols = sourceSymbols.filter((symbol) => formalSet.has(symbol));
    const status = String(group.status || "missing").trim().toLowerCase();
    const qualityStatus = String(group.qualityStatus || "").trim().toLowerCase();
    const readyEvidence = status === "ready"
      && Boolean(group.runId)
      && Boolean(group.scanDate)
      && Boolean(group.finishedAt)
      && new Set(["complete", "ok", "ready", "pass", "a"]).has(qualityStatus);
    groups[source.key] = {
      key: source.key,
      status: ["ready", "blocked", "empty", "error"].includes(status) ? status : "missing",
      reason: String(group.reason || ""),
      runId: String(group.runId || ""),
      scanDate: String(group.scanDate || ""),
      finishedAt: String(group.finishedAt || ""),
      qualityStatus: String(group.qualityStatus || ""),
      publishAllowed: group.publishAllowed === undefined ? null : group.publishAllowed,
      resultRows: numberValue(group.resultRows),
      sourceSymbolCount: sourceSymbols.length,
      formalPriorityMatchCount: formalPriorityMatchedSymbols.length,
      formalPriorityMatchedSymbols,
      latestCompleteRunEvidence: readyEvidence,
    };
  }
  const groupValues = Object.values(groups);
  const completeLatestRunEvidence = groupValues.length === STRATEGY_PRIORITY_BRIDGE_SOURCES.length
    && groupValues.every((group) => group.latestCompleteRunEvidence === true);
  return {
    schemaVersion: "daytrade-formal-priority-strategy-chip-v1",
    source: String(bridge?.source || "supabase:complete-run-priority-bridge"),
    status: String(bridge?.status || "missing"),
    updatedAt: String(bridge?.updatedAt || ""),
    tradeDate: String(bridge?.tradeDate || fallbackTradeDate),
    formalPriorityLimit: DEEP_SCAN_POOL_MAX_SYMBOLS,
    formalPriorityCount: Array.isArray(formalPrioritySymbols) ? formalPrioritySymbols.length : 0,
    formalPrioritySymbols: Array.isArray(formalPrioritySymbols) ? formalPrioritySymbols : [],
    groups,
    counts: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, group.formalPriorityMatchCount])),
    completeLatestRunEvidence,
    completeLatestRunReason: completeLatestRunEvidence ? "" : "one_or_more_strategy_chip_groups_not_latest_complete",
  };
}

function mergeStrategyPriorityBridgeIntoRuntimeFile(bridge) {
  const existing = readJson(PRIORITY_SYMBOLS_FILE, {});
  const next = {
    ...existing,
    priorityBridge: {
      schemaVersion: bridge.schemaVersion,
      source: bridge.source,
      status: bridge.status,
      updatedAt: bridge.updatedAt,
      tradeDate: bridge.tradeDate,
      groups: bridge.groups,
      counts: bridge.counts,
    },
    formalPriorityStrategyChip: buildFormalStrategyChipArtifact(
      bridge,
      existing.daytradeFormalPrioritySymbols || [],
      bridge.tradeDate || taipeiDate(),
    ),
  };
  for (const source of STRATEGY_PRIORITY_BRIDGE_SOURCES) {
    const group = bridge.groups[source.key];
    if (!group || group.status === "error") continue;
    next[source.key] = Array.isArray(group.symbols) ? group.symbols : [];
  }
  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  if (!changed) return false;
  writeJson(PRIORITY_SYMBOLS_FILE, next);
  try {
    writeFugleWebSocketSymbols(next.symbols || [], {
      source: "daytrade-strategy-chip-priority-bridge",
      prioritySource: "daytrade-strategy-chip-priority-bridge",
      strategyPriorityBridgeStatus: bridge.status,
    });
  } catch {}
  return true;
}

async function refreshStrategyChipPriorityBridge() {
  if (!APPLY) return { status: "skipped", reason: "writer_not_apply" };
  if (strategyPriorityBridgeRefreshPromise) return strategyPriorityBridgeRefreshPromise;
  const now = Date.now();
  const existing = readJson(STRATEGY_PRIORITY_BRIDGE_CACHE_FILE, {});
  if (now - lastStrategyPriorityBridgeRefreshAt < STRATEGY_PRIORITY_BRIDGE_REFRESH_MS) {
    return existing;
  }
  lastStrategyPriorityBridgeRefreshAt = now;
  strategyPriorityBridgeRefreshPromise = (async () => {
    const groups = {};
    for (const source of STRATEGY_PRIORITY_BRIDGE_SOURCES) {
      try {
        groups[source.key] = await readStrategyPriorityBridgeSource(source);
      } catch (error) {
        groups[source.key] = {
          key: source.key,
          status: "error",
          symbols: [],
          reason: "bridge_read_failed",
          error: error?.message || String(error),
          runId: "",
          scanDate: "",
          qualityStatus: "",
          resultRows: 0,
        };
      }
    }
    const statuses = Object.values(groups).map((group) => group.status);
    const readyCount = statuses.filter((status) => status === "ready").length;
    const errorCount = statuses.filter((status) => status === "error").length;
    const bridge = {
      schemaVersion: "daytrade-strategy-chip-priority-bridge-v1",
      source: "supabase:complete-run-priority-bridge",
      status: readyCount === STRATEGY_PRIORITY_BRIDGE_SOURCES.length ? "ready" : readyCount ? "partial" : errorCount === statuses.length ? "error" : "blocked",
      updatedAt: nowIso(),
      tradeDate: taipeiDate(),
      groups,
      counts: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, Array.isArray(group.symbols) ? group.symbols.length : 0])),
      readyGroups: readyCount,
      errorGroups: errorCount,
    };
    writeJson(STRATEGY_PRIORITY_BRIDGE_CACHE_FILE, bridge);
    mergeStrategyPriorityBridgeIntoRuntimeFile(bridge);
    return bridge;
  })().finally(() => {
    strategyPriorityBridgeRefreshPromise = null;
  });
  return strategyPriorityBridgeRefreshPromise;
}
function readOpeningReport0830PrioritySeeds(activeSymbols) {
  const todayKey = compactDateKey(taipeiDate());
  const activeSet = new Set((activeSymbols || []).map((row) => normalizeCode(row.symbol)).filter(Boolean));
  const stateDir = runtimePath("state");
  const receiptDir = runtimePath("data", "scan-receipts");
  let files = [];
  try { files = fs.readdirSync(stateDir).filter((file) => /^opening_report_0830\.industry_bias\..+\.json$/i.test(file)); } catch {}
  const bySymbol = new Map();
  let acceptedFiles = 0;
  let rejectedFiles = 0;
  let inputFilesValid = 0;
  let bridgeReceiptsAccepted = 0;
  let bridgeReceiptsRejected = 0;
  let latestUpdatedAt = "";
  const bridgeReceiptIsValid = (receipt, payload, runId, inputPath, receiptPath) => {
    if (!receipt
      || receipt.contract !== "opening-report-0830-priority-bias-bridge-v1"
      || receipt.received !== true
      || receipt.validation?.ok !== true
      || compactDateKey(receipt.date) !== todayKey
      || String(receipt.run_id || "") !== runId
      || receipt.evidence_path !== inputPath
      || receipt.source !== "opening_report_0830"
      || receipt.mode !== "priority_bias_only"
      || receipt.reason_code !== "opening_report_0830_industry_bias"
      || receipt.status !== "priority_scan"
      || receipt.forbidden_publish_guard !== true
      || receipt.formal_candidate_count !== 0
      || receipt.formal_candidate_allowed !== false
      || !Array.isArray(receipt.accepted_symbols)
      || !receipt.accepted_symbols.length
      || !Array.isArray(receipt.applied_boosts)
      || !receipt.applied_boosts.length
      || receipt.receipt_path !== receiptPath) return false;
    return receipt.applied_boosts.every((boost) => (
      Number(boost?.applied_priority_rank) >= 41
      && boost?.status === "watchlist_boosted"
      && Number.isFinite(Number(boost?.price))
      && Number(boost.price) >= MOTHER_POOL_MIN_PRICE
      && Number.isFinite(Number(boost?.quote_age_seconds))
      && Number(boost.quote_age_seconds) <= 120
    ));
  };
  for (const file of files.sort()) {
    const inputPath = path.join(stateDir, file);
    const payload = readJson(inputPath);
    const runId = String(payload?.run_id || "");
    const confidence = Number(payload?.confidence);
    const valid = payload
      && compactDateKey(payload.date) === todayKey
      && String(payload.report_time || "") === "08:30"
      && runId.startsWith("opening-report-0830-" + todayKey + "-")
      && payload.source === "opening_report_0830"
      && payload.mode === "priority_bias_only"
      && payload.allowed_action === "boost_scan_priority_only"
      && payload.forbidden_action === "publish_formal_candidate_without_taiwan_evidence"
      && typeof payload.industry === "string" && payload.industry.trim()
      && typeof payload.bias === "string" && payload.bias.trim()
      && typeof payload.evidence_summary === "string" && payload.evidence_summary.trim()
      && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      && Array.isArray(payload.mapped_symbols) && payload.mapped_symbols.length > 0;
    if (!valid) { rejectedFiles += 1; continue; }
    inputFilesValid += 1;
    const receiptPath = path.join(receiptDir, "opening-report-0830-priority-bias-bridge-" + String(payload.industry).trim() + "-" + todayKey + ".json");
    const receipt = readJson(receiptPath);
    if (!bridgeReceiptIsValid(receipt, payload, runId, inputPath, receiptPath)) {
      bridgeReceiptsRejected += 1;
      rejectedFiles += 1;
      continue;
    }
    bridgeReceiptsAccepted += 1;
    acceptedFiles += 1;
    let fileUpdatedAt = receipt.checked_at || nowIso();
    try {
      const inputUpdatedAt = fs.statSync(inputPath).mtime.toISOString();
      if (!fileUpdatedAt || Date.parse(inputUpdatedAt) > Date.parse(fileUpdatedAt)) fileUpdatedAt = inputUpdatedAt;
    } catch {}
    if (!latestUpdatedAt || Date.parse(fileUpdatedAt) > Date.parse(latestUpdatedAt)) latestUpdatedAt = fileUpdatedAt;
    for (const value of payload.mapped_symbols) {
      const symbol = normalizeCode(value?.symbol || value?.code || value);
      if (!symbol || !activeSet.has(symbol)) continue;
      const inputPrice = numberValue(value?.price ?? value?.last_price ?? value?.lastPrice ?? value?.close);
      if (inputPrice > 0 && inputPrice < MOTHER_POOL_MIN_PRICE) continue;
      const previous = bySymbol.get(symbol) || { symbol, sources: [], score: 0, openingReport0830: true, reports: [] };
      previous.sources.push("opening_report_0830");
      previous.score += 50;
      previous.reports.push({ industry: payload.industry, bias: payload.bias, confidence, runId, evidenceSummary: payload.evidence_summary, bridgeReceiptPath: receiptPath });
      bySymbol.set(symbol, previous);
    }
  }
  return {
    symbols: [...bySymbol.values()],
    counts: { filesAccepted: acceptedFiles, filesRejected: rejectedFiles, inputFilesValid, bridgeReceiptsAccepted, bridgeReceiptsRejected, symbols: bySymbol.size },
    updatedAt: latestUpdatedAt,
    source: "opening_report_0830_industry_bias_bridge_verified",
    status: acceptedFiles > 0 ? "ready" : "missing",
    bridgeReceiptStatus: acceptedFiles > 0 ? "ready" : "fail_closed",
  };
}
function readRuntimePrioritySeeds(activeSymbols) {
  const payload = readJson(PRIORITY_SYMBOLS_FILE, {});
  const bridge = objectPayload(payload.priorityBridge) || readJson(STRATEGY_PRIORITY_BRIDGE_CACHE_FILE, {});
  const bridgeGroups = objectPayload(bridge.groups);
  const bridgeValues = (key) => {
    const group = objectPayload(bridgeGroups[key]);
    return group.status === "ready" && Array.isArray(group.symbols) ? group.symbols : [];
  };
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
      if (source === "opening_report_0830") prev.openingReport0830 = true;
      bySymbol.set(symbol, prev);
    }
    counts[source] = accepted;
  };

  addMany("daytrade", payload.daytradePrioritySymbols || payload.daytradeSymbols || payload.daytrade, 120);
  // strategy1 is retained as historical source evidence only; it is not a mother-pool seed.
  addMany("terminal", payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, 100);
  addMany("opening", payload.openingPrioritySymbols || payload.primaryPrioritySymbols, 100);

  counts.strategy3 = 0; // Strategy3 detects the Strategy2 Mother Pool; it cannot seed or reprioritize its own water.
  addMany("strategy6", payload.strategy6 || payload.strategy6Symbols || bridgeValues("strategy6"), 80);
  addMany("strategy7", payload.strategy7 || payload.strategy7Symbols || bridgeValues("strategy7"), 80);
  addMany("slash88", payload.slash88 || payload.eightyEight || payload.strategy88 || payload.strategy88Symbols, 90);
  addMany("strategy4", payload.strategy4 || payload.strategy4Symbols || bridgeValues("strategy4"), 80);
  addMany("strategy5", payload.strategy5 || payload.strategy5Symbols || bridgeValues("strategy5"), 80);
  addMany("chip", payload.chip || payload.chipSymbols || payload.chipPrioritySymbols || payload.chip_priority_symbols, 75);
  addMany("institution", payload.institution || payload.institutionSymbols || bridgeValues("institution"), 75);
  addMany("recent_strong", payload.recentStrongSymbols || payload.recentStrengthSymbols || payload.recent_strong_symbols || payload.yesterdayStrongSymbols || payload.yesterday_strong_symbols, 85);
  addMany("yesterday_front", payload.yesterdayFrontSymbols || payload.yesterdayVolumeSymbols || payload.yesterdayTradeValueSymbols || payload.yesterday_top_symbols, 75);
  addMany("yesterday_gain_amplitude_spike", payload.yesterdayGainSymbols || payload.yesterdayAmplitudeSymbols || payload.yesterdayVolumeSpikeSymbols || payload.yesterday_gain_symbols || payload.yesterday_amplitude_symbols || payload.yesterday_volume_spike_symbols, 75);
  addMany("warrant", payload.warrant || payload.warrantSymbols || bridgeValues("warrant"), 70);
  addMany("cb", payload.cb || payload.cbSymbols || bridgeValues("cb"), 60);
  addMany("daytrade_hot", payload.hot || payload.daytradeHotSymbols || payload.priorityStrongSymbols, 75);
  addMany("stock_future", payload.stockFutureSymbols || payload.futoptSymbols || payload.individualFuturesSymbols, 85);
  addMany("manual_watchlist", payload.manualWatchlist || payload.manual_watchlist || payload.watchlist || payload.userWatchlist || payload.user_watchlist, 120);
  const openingReport0830 = readOpeningReport0830PrioritySeeds(activeSymbols);
  addMany("opening_report_0830", openingReport0830.symbols, 50);
  addMany("symbols", payload.symbols, 10);
  for (const entry of bySymbol.values()) {
    entry.openingReport0830BiasOnly = entry.openingReport0830 === true
      && entry.sources.length > 0
      && entry.sources.every((source) => source === "opening_report_0830");
  }

  return {
    symbols: [...bySymbol.values()],
    counts,
    updatedAt: payload.updatedAt || bridge.updatedAt || "",
    source: payload.source || bridge.source || "runtime_priority_file",
    strategyPriorityBridgeStatus: bridge.status || "missing",
    strategyPriorityBridgeUpdatedAt: bridge.updatedAt || "",
    strategyPriorityBridgeCounts: bridge.counts || {},
    strategyPriorityBridgeGroups: bridgeGroups,
    openingReport0830,
  };
}

function buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap = new Map(), supplementalMaps = {}) {
  const activeBySymbol = new Map(activeSymbols.map((row) => [row.symbol, row]));
  const previousDelta = readJson(MOTHER_POOL_DELTA_STATE_FILE, {});
  const previousBySymbol = new Map((Array.isArray(previousDelta.rows) ? previousDelta.rows : []).map((row) => [
    normalizeCode(row.symbol),
    row,
  ]).filter(([symbol]) => symbol));
  supplementalMaps.activeBySymbol = activeBySymbol;
  const seeds = readRuntimePrioritySeeds(activeSymbols);
  const bySymbol = new Map();
  const sourceSeedBySymbol = new Map(seeds.symbols.map((entry) => [entry.symbol, entry]));
  const candidates = activeSymbols.map((row) => ({
    ...row,
    metrics: quoteMetrics(row.symbol, dailyVolumeMap, quoteMap, supplementalMaps),
  })).map((row) => ({
    ...row,
    basePool: evaluateMotherPoolBasePool(row, row.metrics),
  }));
  const qualifiedCandidates = candidates.filter((row) => row.basePool.eligible);
  const pendingCandidates = candidates.filter((row) => !row.basePool.eligible && row.basePool.pending);
  const basePoolFailureCounts = {};
  const basePoolPendingCounts = {};
  for (const candidate of candidates) {
    for (const check of candidate.basePool.failedChecks || []) basePoolFailureCounts[check] = (basePoolFailureCounts[check] || 0) + 1;
    for (const check of candidate.basePool.pendingChecks || []) basePoolPendingCounts[check] = (basePoolPendingCounts[check] || 0) + 1;
  }
  // The ordinary-stock mother pool warms from the full active universe.
  // Pending quote/volume fields may enter the warming pool, but formal entry
  // still requires fresh quotes and every canonical gate condition below.
  // A pending quote or stale quote cannot enter the published mother pool.
  // It remains visible in base-pool diagnostics until the next radar refresh.
  // Pending/stale/unknown-price rows remain diagnostics-only. They must never
  // enter mother/priority/hot/deep pools or consume high-cost candle slots.
  const rankingCandidates = qualifiedCandidates;
  const changeRanks = rankMap(rankingCandidates, (row) => row.metrics.changePercent, { minValue: 0 });
  const volumeSurgeRanks = rankMap(rankingCandidates, (row) => row.metrics.volumeRatio5, { minValue: 0 });
  const estimatedVolumeRanks = rankMap(rankingCandidates, (row) => row.metrics.estimatedVolumeRatio, { minValue: 0 });
  const volumeRanks = rankMap(rankingCandidates, (row) => row.metrics.totalVolume, { minValue: 0 });
  const valueRanks = rankMap(rankingCandidates, (row) => row.metrics.tradeValue, { minValue: 0 });
  const turnoverRanks = rankMap(rankingCandidates, (row) => row.metrics.turnoverRate3To5d, { minValue: 0 });
  const groupLimitUpLeaders = new Map();
  for (const row of candidates) {
    const metrics = row.metrics;
    const lockedLimitUp = metrics.price > 0 && (
      (metrics.limitUpPrice > 0 && metrics.price >= metrics.limitUpPrice * 0.995 && metrics.changePercent >= 9.5)
      || metrics.changePercent >= 9.7
    );
    if (!lockedLimitUp) continue;
    for (const key of metrics.groupKeys || []) {
      const previous = groupLimitUpLeaders.get(key);
      if (!previous || metrics.tradeValue > previous.tradeValue || metrics.changePercent > previous.changePercent) {
        groupLimitUpLeaders.set(key, {
          symbol: row.symbol,
          name: row.name,
          group: key,
          price: metrics.price,
          changePercent: metrics.changePercent,
          tradeValue: metrics.tradeValue,
          limitUpPrice: metrics.limitUpPrice,
        });
      }
    }
  }
  const rankedCandidates = rankingCandidates.map((row) => {
    const metrics = row.metrics;
    const changeRank = changeRanks.get(row.symbol)?.rank || 0;
    const volumeSurgeRank = volumeSurgeRanks.get(row.symbol)?.rank || 0;
    const estimatedVolumeRank = estimatedVolumeRanks.get(row.symbol)?.rank || 0;
    const volumeRank = volumeRanks.get(row.symbol)?.rank || 0;
    const valueRank = valueRanks.get(row.symbol)?.rank || 0;
    const turnoverRank = turnoverRanks.get(row.symbol)?.rank || 0;
    const formalLiquidityEligible = metrics.totalVolume >= FORMAL_SIGNAL_MIN_TOTAL_VOLUME
      && metrics.tradeValue >= FORMAL_SIGNAL_MIN_TRADE_VALUE
      && volumeRank > 0
      && volumeRank <= FORMAL_SIGNAL_MAX_VOLUME_RANK;
    const formalLiquidityRejectReason = formalLiquidityEligible
      ? ""
      : `LIQUIDITY_TOO_LOW:${metrics.totalVolume < FORMAL_SIGNAL_MIN_TOTAL_VOLUME ? "total_volume" : metrics.tradeValue < FORMAL_SIGNAL_MIN_TRADE_VALUE ? "trade_value" : "volume_rank"}`;
    const groupLeader = (metrics.groupKeys || [])
      .map((key) => groupLimitUpLeaders.get(key))
      .find((leader) => leader && leader.symbol !== row.symbol);
    const reasons = [];
    let entryScore = 0;

    entryScore += Math.min(130, Math.log10(Math.max(1, metrics.avgVolume5)) * 30);
    entryScore += topRankScore(changeRank, 120, 190);
    entryScore += topRankScore(volumeSurgeRank, 120, 180);
    entryScore += topRankScore(estimatedVolumeRank, 120, 180);
    entryScore += topRankScore(volumeRank, 150, 130);
    entryScore += topRankScore(valueRank, 150, 130);
    entryScore += topRankScore(turnoverRank, 50, 160);
    if (metrics.quoteFresh) entryScore += 40;
    if (metrics.price > 0) entryScore += 20;

    if (metrics.changePercent >= 3) {
      entryScore += 170;
      reasons.push("gain_rank_gt3");
    } else if (metrics.changePercent >= 2) {
      entryScore += 95;
      reasons.push("gain_rank_gt2");
    }
    if (metrics.movingAverageTurnBullish) {
      entryScore += 125;
      reasons.push("ma3_5_10_or_ma5_10_30_turn_bullish");
    }
    if (metrics.volumeRatio5 >= 2) {
      entryScore += 160;
      reasons.push("volume_surge_vs_5d_gt2");
    } else if (metrics.volumeRatio5 > 1) {
      entryScore += 80;
      reasons.push("volume_ratio_gt1");
    }
    if (metrics.estimatedVolumeRatioUsable && metrics.estimatedVolumeRatio >= 2) {
      entryScore += 160;
      reasons.push("estimated_volume_ratio_gt2");
    }
    if (changeRank && changeRank <= 100) reasons.push(`gain_rank_top${changeRank}`);
    if (volumeSurgeRank && volumeSurgeRank <= 100) reasons.push(`volume_surge_rank_top${volumeSurgeRank}`);
    if (changeRank && changeRank <= 120 && volumeSurgeRank && volumeSurgeRank <= 120) {
      entryScore += 230;
      reasons.push("gain_volume_surge_rank_overlap");
    }
    if (metrics.changePercent >= 2 && metrics.totalVolume >= 10000) {
      entryScore += 140;
      reasons.push("intraday_gain_gt2_volume_gt10000");
    }
    if (metrics.volumeRatio5 >= 2 && metrics.totalVolume >= 10000 && volumeRank && volumeRank <= 100) {
      entryScore += 210;
      reasons.push("volume_ratio_gt2_volume_rank_top100");
    }
    if (metrics.estimatedVolumeRatioUsable && metrics.estimatedVolumeRatio >= 2 && metrics.totalVolume >= 10000 && volumeRank && volumeRank <= 100) {
      entryScore += 210;
      reasons.push("estimated_volume_ratio_gt2_volume_rank_top100");
    }
    if (metrics.tradeValue >= 30000000) {
      entryScore += 80;
      reasons.push("trade_value_gt3000w");
    }
    if (metrics.highPrice > 0 && metrics.price > 0 && metrics.price / metrics.highPrice >= 0.985) {
      entryScore += 90;
      reasons.push("near_day_high");
    }
    if (metrics.lowPrice > 0 && metrics.price > 0 && ((metrics.price - metrics.lowPrice) / metrics.lowPrice) * 100 >= 2 && metrics.changePercent >= 2) {
      entryScore += 80;
      reasons.push("rebound_from_low");
    }
    if (metrics.outsideVolume > metrics.insideVolume && metrics.sideTotal >= 1000) {
      entryScore += 90;
      reasons.push("mitake_outside_gt_inside");
    }
    if (metrics.bidAskRatio >= 1.5) {
      entryScore += 45;
      reasons.push("bid_ask_ratio_gt1_5");
    }
    if (metrics.turnoverRate >= MOTHER_POOL_MIN_TURNOVER_RATE) {
      entryScore += 95;
      reasons.push("turnover_rate_ge_min_priority");
    }
    if (metrics.turnoverRate >= 5) {
      entryScore += 120;
      reasons.push("turnover_gt5");
    }
    if (turnoverRank && turnoverRank <= 50) {
      entryScore += 680;
      reasons.push(`turnover_3_5d_rank_top${turnoverRank}`);
    }
    if (metrics.stockFutureInitial0846Ok) {
      entryScore += 170;
      reasons.push("stock_future_initial_0846_observe");
      if (String(metrics.stockFutureInitial0846.sourceStatus || "").toLowerCase() === "ready") {
        entryScore += 30;
        reasons.push("stock_future_source_ready");
      }
    }
    if (groupLeader && metrics.price > 0 && (metrics.changePercent >= 1 || metrics.volumeRatio5 >= 1 || metrics.tradeValue >= 30000000)) {
      entryScore += 155;
      reasons.push("strong_group_limit_up_leader");
    }
    if (metrics.changePercent > 0 && (metrics.foreignNet > 0 || metrics.trustNet > 0 || metrics.dealerNet > 0 || metrics.mainForceNet > 0)) {
      entryScore += 100;
      reasons.push("institution_or_main_force_buy_price_strong");
    }
    if (metrics.changePercent > 0 && metrics.hasMargin3To5d && (metrics.marginChange3d < 0 || metrics.marginChange5d < 0 || metrics.marginChange3To5d < 0)) {
      entryScore += 95;
      reasons.push("margin_down_3_5d_price_strong");
    }
    if (metrics.changePercent > 0 && metrics.hasMargin3To5d && (
      (metrics.marginChange3d > 0 && metrics.shortChange3d > 0)
      || (metrics.marginChange5d > 0 && metrics.shortChange5d > 0)
      || (metrics.marginChange3To5d > 0 && metrics.shortChange3To5d > 0)
    )) {
      entryScore += 80;
      reasons.push("margin_short_both_up_3_5d_price_strong");
    }
    if (metrics.exDividend3To5d) {
      entryScore -= 250;
      reasons.push("ex_dividend_3_5d_watch");
    } else if (metrics.exDividend) {
      entryScore -= 160;
      reasons.push("exclude_ex_dividend_watch");
    }
    if (metrics.daytradeCrowded3To5d) {
      entryScore -= 90;
      reasons.push("daytrade_crowded_3_5d_watch");
    } else if (metrics.daytradeCrowded) {
      entryScore -= 60;
      reasons.push("daytrade_crowded_watch");
    }

    const seedEntry = sourceSeedBySymbol.get(row.symbol) || {};
    const seedSources = [...new Set((seedEntry.sources || []).filter((value) => value && value !== "symbols"))];
    const openingReport0830BiasOnly = seedEntry.openingReport0830BiasOnly === true;
    const sourceSignal = seedSources.length > 0 || metrics.stockFutureInitial0846Ok || metrics.trackedBuyPointActive;
    const openingPriceBreakout = metrics.openPrice > 0 && metrics.price > metrics.openPrice;
    const dynamicSignal = metrics.changePercent > 2
      || metrics.volumeRatio5 >= 2
      || (volumeRank > 0 && volumeRank <= 100)
      || (valueRank > 0 && valueRank <= 150)
      || metrics.turnoverRate >= MOTHER_POOL_MIN_TURNOVER_RATE
      || metrics.volumeExpanding
      || metrics.movingAverageTurnBullish
      || metrics.surgeFlag
      || metrics.volumeSpikeFlag
      || metrics.rapidGainIncrease
      || metrics.openingRangeBreak
      || openingPriceBreakout
      || metrics.fibSupport
      || metrics.ma10PullbackSupport
      || metrics.wBottomNecklineBreak
      || metrics.scatterGunPattern
      || metrics.pppPattern
      || metrics.middleGateBreak
      || metrics.threeBottomPattern
      || metrics.dynamicThreeGateBreak
      || metrics.tongziPattern
      || metrics.divergencePattern
      || metrics.vTurnPattern;
    const hotBurstSignals = [
      metrics.volumeRatio5 >= 2 || metrics.estimatedVolumeRatio >= 2 || metrics.volumeSpikeFlag,
      metrics.rapidGainIncrease || metrics.changePercent >= 2,
      metrics.movingAverageTurnBullish || (metrics.price > metrics.ma3 && metrics.price > metrics.ma5 && metrics.price > metrics.ma10),
      metrics.fibSupport || metrics.ma10PullbackSupport || metrics.wBottomNecklineBreak,
    ].filter(Boolean);
    const hotBurstFastPath = metrics.quoteFresh === true
      && metrics.intraday1mStaleSeconds <= HOT_BURST_MAX_STALE_SECONDS
      && hotBurstSignals.length >= HOT_BURST_MIN_SIGNALS;
    const matchedCasePatterns = [
      metrics.openPrice > 0 && metrics.price >= metrics.openPrice ? "opening_price_breakout" : "",
      metrics.ma10PullbackSupport ? "ma10_pullback_support" : "",
      metrics.fibSupport ? "fib_support" : "",
      metrics.wBottomNecklineBreak ? "w_bottom_neckline_break" : "",
      metrics.scatterGunPattern ? "scatter_gun" : "",
      metrics.pppPattern ? "ppp" : "",
      metrics.middleGateBreak ? "middle_gate_break" : "",
      metrics.threeBottomPattern ? "three_bottom" : "",
      metrics.dynamicThreeGateBreak ? "dynamic_three_gate_break" : "",
      metrics.tongziPattern ? "tongzi" : "",
      metrics.divergencePattern ? "divergence" : "",
      metrics.vTurnPattern ? "v_turn" : "",
    ].filter(Boolean);
    const userCaseSeedMatched = USER_CASE_SYMBOLS.has(row.symbol);
    const userCasePatternSignals = matchedCasePatterns;
    const userCaseLearningActive = matchedCasePatterns.length > 0;
    const userCasePatternBoost = userCaseLearningActive ? Math.min(220, matchedCasePatterns.length * 42) : 0;
    const previousRow = previousBySymbol.get(row.symbol) || {};
    const previousEntryScore = Number(previousRow.entry_score ?? previousRow.score);
    const previousScoreHistory = Array.isArray(previousRow.score_history)
      ? previousRow.score_history.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    const scoreDeclining = Number.isFinite(previousEntryScore) && entryScore < previousEntryScore;
    const consecutiveScoreDeclines = scoreDeclining ? Math.min(3, previousScoreHistory.length + 1) : 0;
    const downgradeProtection = metrics.aboveMa30 === true && metrics.aboveMa58 === true && metrics.volumeRatio5 >= 0.8;
    const fastRemove = metrics.quoteFresh !== true || (metrics.ma58 > 0 && metrics.aboveMa58 !== true);
    const upgradeReasons = [];
    let upgradeScore = 0;
    upgradeScore += topRankScore(changeRank, 120, 220);
    upgradeScore += topRankScore(volumeSurgeRank, 120, 230);
    upgradeScore += topRankScore(estimatedVolumeRank, 120, 190);
    upgradeScore += topRankScore(volumeRank, 100, 170);
    upgradeScore += topRankScore(valueRank, 150, 150);
    upgradeScore += topRankScore(turnoverRank, 50, 110);
    if (metrics.quoteFresh) upgradeScore += 30;
    if (metrics.changePercent >= 2) upgradeScore += 130;
    if (metrics.turnoverRate >= MOTHER_POOL_MIN_TURNOVER_RATE) upgradeScore += 55;
    if (metrics.volumeRatio5 >= 2 || metrics.estimatedVolumeRatio >= 2) upgradeScore += 150;
    if (metrics.movingAverageTurnBullish) upgradeScore += 120;
    if (metrics.openingRangeBreak) upgradeScore += 90;
    if (metrics.stockFutureInitial0846Ok) upgradeScore += 100;
    if (seedSources.length) upgradeScore += Math.min(100, seedSources.length * 28);
    if (hotBurstFastPath) upgradeScore += 480;
    if (userCasePatternBoost > 0) upgradeScore += userCasePatternBoost;
    if (downgradeProtection) upgradeScore += 35;
    if (consecutiveScoreDeclines >= 2 && !downgradeProtection) upgradeScore -= 180;
    if (fastRemove) upgradeScore -= 500;
    if (hotBurstFastPath) upgradeReasons.push("hot_burst_3_5m");
    if (matchedCasePatterns.length) upgradeReasons.push(...matchedCasePatterns.map((pattern) => "case_" + pattern));
    if (metrics.changePercent >= 2) upgradeReasons.push("gain_acceleration");
    if (metrics.turnoverRate >= MOTHER_POOL_MIN_TURNOVER_RATE) upgradeReasons.push("turnover_rate_ge_min_priority");
    if (metrics.volumeRatio5 >= 2 || metrics.estimatedVolumeRatio >= 2) upgradeReasons.push("relative_volume_expansion");
    if (metrics.movingAverageTurnBullish) upgradeReasons.push("moving_average_turn_bullish");
    if (metrics.openingRangeBreak) upgradeReasons.push("opening_range_break_0901");
    if (seedSources.length) upgradeReasons.push("source_seed_resonance");
    if (consecutiveScoreDeclines >= 2 && !downgradeProtection) upgradeReasons.push("consecutive_score_decline");
    if (fastRemove) upgradeReasons.push("fast_remove_stale_or_below_ma58");
    const hotBurstTriggeredAt = hotBurstFastPath ? nowIso() : "";
    const isMotherPoolCandidate = sourceSignal || dynamicSignal;
    const strongResonance = metrics.volumeRatio5 >= 2 || metrics.tradeValue >= FORMAL_SIGNAL_MIN_TRADE_VALUE || metrics.movingAverageTurnBullish || seedSources.length >= 2;
    const liquidityGrade = metrics.avgVolume5 >= 3000 ? "formal_ok" : metrics.avgVolume5 >= 1000 || strongResonance ? "trial_or_watch" : "watch_only";
    if (seedSources.length) reasons.push(...seedSources.map((value) => "source_" + value));
    if (volumeRank > 0 && volumeRank <= 100) reasons.push("volume_rank_top100");
    if (valueRank > 0 && valueRank <= 150) reasons.push("trade_value_rank_front");
    if (metrics.surgeFlag) reasons.push("intraday_surge");
    if (metrics.volumeSpikeFlag) reasons.push("intraday_volume_spike");
    if (metrics.openingRangeBreak) reasons.push("opening_range_break_0901");
    if (openingPriceBreakout) reasons.push("opening_price_breakout");
    if (metrics.trackedBuyPointActive) reasons.push("tracked_buy_point_active");
    if (hotBurstFastPath) reasons.push("hot_burst_3_5m");
    if (userCaseLearningActive) reasons.push("user_case_pattern_boost");
    if (metrics.fibSupport) reasons.push("fib_support");
    if (metrics.ma10PullbackSupport) reasons.push("ma10_pullback_support");
    if (metrics.wBottomNecklineBreak) reasons.push("w_bottom_neckline_break");
    if (metrics.scatterGunPattern) reasons.push("scatter_gun_pattern");
    if (metrics.pppPattern) reasons.push("ppp_pattern");
    if (metrics.middleGateBreak) reasons.push("middle_gate_break");
    if (metrics.threeBottomPattern) reasons.push("three_bottom_pattern");
    if (metrics.dynamicThreeGateBreak) reasons.push("dynamic_three_gate_break");
    if (metrics.tongziPattern) reasons.push("tongzi_pattern");
    if (metrics.divergencePattern) reasons.push("divergence_pattern");
    if (metrics.vTurnPattern) reasons.push("v_turn_pattern");
    return {
      ...row,
      score: entryScore,
      entryScore,
      upgradeScore,
      hotBurstFastPath,
      hotBurstSignals: hotBurstSignals.length,
      userCaseLearningActive,
      userCaseSeedMatched,
      userCasePatternSignals,
      matchedCasePatterns,
      userCasePatternBoost,
      upgradeReasons,
      hotBurstTriggeredAt,
      consecutiveScoreDeclines,
      downgradeProtection,
      fastRemove,
      isMotherPoolCandidate,
      liquidityGrade,
      sourceFlags: seedSources,
      openingReport0830BiasOnly,
      poolReasons: [...new Set(reasons.length ? reasons : ["radar_rotation_fill"])],
      prioritySource: "dynamic_daytrade_mother_pool",
      priorityReason: reasons.length ? reasons.join("+") : "dynamic_liquidity_fill",
      priorityMetrics: {
        entryScore,
        upgradeScore,
        hotBurstFastPath,
        hotBurstSignals: hotBurstSignals.length,
        userCaseLearningActive,
        userCaseSeedMatched,
        userCasePatternSignals,
        matchedCasePatterns,
        userCasePatternBoost,
        upgradeReasons,
        hotBurstTriggeredAt,
        consecutiveScoreDeclines,
        downgradeProtection,
        fastRemove,
        price: Number(metrics.price.toFixed(4)),
        openPrice: Number(metrics.openPrice.toFixed(4)),
        previousClose: Number(metrics.previousClose.toFixed(4)),
        amplitudeFromOpen: Number(metrics.amplitudeFromOpen.toFixed(4)),
        highPrice: Number(metrics.highPrice.toFixed(4)),
        lowPrice: Number(metrics.lowPrice.toFixed(4)),
        changePercent: Number(metrics.changePercent.toFixed(4)),
        totalVolume: Math.round(metrics.totalVolume),
        tradeValue: Math.round(metrics.tradeValue),
        avgVolume5: Math.round(metrics.avgVolume5),
        issuedShares: Math.round(metrics.issuedShares),
        volumeRatio5: Number(metrics.volumeRatio5.toFixed(4)),
        previousVolume: Math.round(metrics.previousVolume),
        projectedVolume: Math.round(metrics.projectedVolume),
        estimatedVolumeRatio: Number(metrics.estimatedVolumeRatio.toFixed(4)),
        estimatedVolumeRatioUsable: metrics.estimatedVolumeRatioUsable,
        ma3: Number(metrics.ma3.toFixed(4)),
        ma5: Number(metrics.ma5.toFixed(4)),
        ma10: Number(metrics.ma10.toFixed(4)),
        ma30: Number(metrics.ma30.toFixed(4)),
        ma58: Number(metrics.ma58.toFixed(4)),
        ma3Ma5Ma10Bullish: metrics.ma3Ma5Ma10Bullish,
        ma5Ma10Ma30Bullish: metrics.ma5Ma10Ma30Bullish,
        movingAverageTurnBullish: metrics.movingAverageTurnBullish,
        formalLiquidityEligible,
        formalLiquidityRejectReason,
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
        marginSampledDays: metrics.marginSampledDays,
        hasMargin3To5d: metrics.hasMargin3To5d,
        marginChange1d: Number(metrics.marginChange.toFixed(4)),
        shortChange1d: Number(metrics.shortChange.toFixed(4)),
        marginChange3d: Number(metrics.marginChange3d.toFixed(4)),
        shortChange3d: Number(metrics.shortChange3d.toFixed(4)),
        marginChange5d: Number(metrics.marginChange5d.toFixed(4)),
        shortChange5d: Number(metrics.shortChange5d.toFixed(4)),
        marginChange3To5d: Number(metrics.marginChange3To5d.toFixed(4)),
        shortChange3To5d: Number(metrics.shortChange3To5d.toFixed(4)),
        stockFutureInitial0846Ok: metrics.stockFutureInitial0846Ok,
        stockFutureInitial0846: metrics.stockFutureInitial0846,
        stockGroupContract: metrics.groupContract,
        groupKeys: metrics.groupKeys,
        groupLimitUpLeader: groupLeader || null,
        limitUpPrice: Number(metrics.limitUpPrice.toFixed(4)),
        exDividend3To5d: metrics.exDividend3To5d,
        exDividendDate: metrics.exDividendDate,
        daytradeCrowded3To5d: metrics.daytradeCrowded3To5d,
        daytradeCrowdedBasis: metrics.daytradeCrowdedBasis,
        quoteFresh: metrics.quoteFresh,
        quoteAgeSeconds: metrics.quoteAgeSeconds,
        quoteUpdatedAt: metrics.quoteUpdatedAt,
        latestCandleTime: metrics.lastCandleTime || "",
        fieldCoverage: metrics.fieldCoverage,
        ruleHits: reasons,
        poolReasons: [...new Set(reasons.length ? reasons : ["radar_rotation_fill"])],
        strategySourceFlags: seedSources,
        openingReport0830BiasOnly,
        isMotherPoolCandidate,
        liquidityGrade,
        ma3TurnUp: metrics.ma3Rising,
        ma5TurnUp: metrics.ma5Rising,
        ma10TurnUp: metrics.ma10Rising,
        ma30TurnUp: metrics.ma30Rising,
        ma58TurnUp: metrics.ma58Rising,
        maBullStackShort: metrics.ma3Ma5Ma10Bullish,
        maBullStackMid: metrics.ma5Ma10Ma30Bullish,
        aboveMa30: metrics.aboveMa30,
        aboveMa58: metrics.aboveMa58,
        openingRangeBreak: metrics.openingRangeBreak,
        surgeFlag: metrics.surgeFlag,
        volumeSpikeFlag: metrics.volumeSpikeFlag,
        fibSupport: metrics.fibSupport,
        ma10PullbackSupport: metrics.ma10PullbackSupport,
        wBottomNecklineBreak: metrics.wBottomNecklineBreak,
        scatterGunPattern: metrics.scatterGunPattern,
        pppPattern: metrics.pppPattern,
        middleGateBreak: metrics.middleGateBreak,
        threeBottomPattern: metrics.threeBottomPattern,
        dynamicThreeGateBreak: metrics.dynamicThreeGateBreak,
        tongziPattern: metrics.tongziPattern,
        divergencePattern: metrics.divergencePattern,
        vTurnPattern: metrics.vTurnPattern,
        rapidGainIncrease: metrics.rapidGainIncrease,
        hotBurstFastPath,
        userCaseLearningActive,
        userCaseSeedMatched,
        userCasePatternSignals,
        matchedCasePatterns,
        userCasePatternBoost,
        upgradeReasons,
        hotBurstTriggeredAt,
        consecutiveScoreDeclines,
        downgradeProtection,
        fastRemove,
        tradeValueRank: valueRank,
        dataGap: metrics.dataGap,
        basePoolEligible: row.basePool.eligible,
        basePoolPending: row.basePool.pending,
        basePoolFailedChecks: row.basePool.failedChecks,
        basePoolPendingChecks: row.basePool.pendingChecks,
      },
    };
  }).sort((a, b) => Number(b.metrics?.quoteFresh === true) - Number(a.metrics?.quoteFresh === true) || b.entryScore - a.entryScore || a.symbol.localeCompare(b.symbol));

  const publishableRankedCandidates = rankedCandidates.filter((row) => row.basePool.eligible);
  const rankedBySymbol = new Map(publishableRankedCandidates.map((row) => [row.symbol, row]));
  const signalCandidates = publishableRankedCandidates.filter((row) => row.isMotherPoolCandidate);
  // Quote Radar evaluates the full formal universe, but only rows matching at
  // least one dynamic or evidence-backed source condition may enter Mother Pool.
  const nonOpeningCandidates = signalCandidates.filter((row) => row.openingReport0830BiasOnly !== true);
  const openingBiasCandidates = signalCandidates.filter((row) => row.openingReport0830BiasOnly === true);
  const selectedCandidates = [
    ...nonOpeningCandidates.slice(0, Math.max(0, MOTHER_POOL_MAX_SYMBOLS - openingBiasCandidates.length)),
    ...openingBiasCandidates.slice(0, MOTHER_POOL_MAX_SYMBOLS),
  ];
  const selectedCandidateSymbols = new Set(selectedCandidates.map((row) => row.symbol));
  const rotationFillCandidates = publishableRankedCandidates
    .filter((row) => !selectedCandidateSymbols.has(row.symbol))
    .filter((row) => row.basePool?.eligible === true && row.metrics?.quoteFresh === true && Number(row.metrics?.price) >= MOTHER_POOL_MIN_PRICE)
    .sort((a, b) => Number(b.metrics?.quoteFresh === true) - Number(a.metrics?.quoteFresh === true) || b.entryScore - a.entryScore || a.symbol.localeCompare(b.symbol));
  const selectedFreshEligibleCount = selectedCandidates.filter((row) => row.basePool?.eligible === true && row.metrics?.quoteFresh === true && Number(row.metrics?.price) >= MOTHER_POOL_MIN_PRICE).length;
  const rotationFillNeeded = Math.max(0, Math.min(MOTHER_POOL_MAX_SYMBOLS, MOTHER_POOL_MIN_SYMBOLS) - selectedFreshEligibleCount);
  const rotationFillSelected = rotationFillCandidates.slice(0, rotationFillNeeded).map((row) => ({
    ...row,
    priorityReason: row.priorityReason || 'radar_rotation_fill',
    poolReasons: [...new Set([...(Array.isArray(row.poolReasons) ? row.poolReasons : []), 'radar_rotation_fill'])],
  }));
  selectedCandidates.push(...rotationFillSelected);
  for (const row of selectedCandidates) {
    if (bySymbol.size >= MOTHER_POOL_MAX_SYMBOLS) break;
    // Mother pool is the warming/discovery layer; formal entry remains separately gated.
    bySymbol.set(row.symbol, {
      ...row,
      score: row.score,
      prioritySource: row.prioritySource,
      priorityReason: row.priorityReason,
    });
  }
  for (const seed of seeds.symbols) {
    const row = rankedBySymbol.get(seed.symbol);
    if (!row || (!row.formalLiquidityEligible && seed.openingReport0830BiasOnly !== true)) continue;
    const prev = bySymbol.get(seed.symbol);
    if (!prev) {
      // Runtime seeds may boost a candidate already selected in the warming
      // pool. They cannot bypass the ordinary-stock filter or fill excluded rows.
      continue;
    }
    prev.entryScore += seed.score;
    prev.score = prev.entryScore;
    prev.upgradeScore += Math.min(120, Number(seed.score || 0));
    prev.prioritySource = `${prev.prioritySource},${seed.sources.join(",")}`;
    prev.priorityReason = `${prev.priorityReason}+runtime_priority`;
  }

  const rankedRows = [...bySymbol.values()]
    .filter((row) => row.basePool?.eligible === true
      && row.metrics?.quoteFresh === true
      && Number(row.metrics?.price) >= MOTHER_POOL_MIN_PRICE)
    .sort((a, b) => Number(b.metrics?.quoteFresh === true) - Number(a.metrics?.quoteFresh === true) || b.upgradeScore - a.upgradeScore || b.entryScore - a.entryScore || a.symbol.localeCompare(b.symbol));
  const rows = [
    ...rankedRows.filter((row) => row.openingReport0830BiasOnly !== true),
    ...rankedRows.filter((row) => row.openingReport0830BiasOnly === true),
  ].slice(0, MOTHER_POOL_MAX_SYMBOLS);
  const priorityUpdatedAt = nowIso();
  const output = rows.map((row, index) => {
    const hotExtensionRank = index + 1 >= 41 && index + 1 <= 80 ? index + 1 : null;
    const sourceFlags = Array.isArray(row.sourceFlags) ? row.sourceFlags : [];
    const userTracked = sourceFlags.some((source) => /manual_watchlist|user_watchlist/i.test(String(source)));
    const intradayBurst = row.hotBurstFastPath === true || row.priorityMetrics?.surgeFlag === true || row.priorityMetrics?.volumeSpikeFlag === true;
    const wantsDeepScan = index + 1 <= HOT_POOL_MAX_SYMBOLS || userTracked || row.userCaseSeedMatched === true || row.userCaseLearningActive === true || row.priorityMetrics?.trackedBuyPointActive === true || intradayBurst;
    const rowDataGap = row.priorityMetrics?.dataGap || {};
    const rowDataGapReason = String(rowDataGap.data_gap_reason || rowDataGap.status || "OK").toUpperCase();
    const rowFormal1mReady = rowDataGapReason === "OK"
      && rowDataGap.has_required_1m_window === true
      && rowDataGap.has_0900_1030_continuous === true
      && numberValue(rowDataGap.candle_count) >= Math.max(20, Math.ceil(91 * MIN_INTRADAY_1M_READY_COVERAGE))
      && numberValue(rowDataGap.intraday_1m_stale_seconds, 999999) <= MAX_INTRADAY_1M_STALE_SECONDS;
    const deepScanEligible = wantsDeepScan && (taipeiMinutes() < 9 * 60 || rowFormal1mReady);
    const candlesPriorityReasons = [wantsDeepScan ? "formal_deep_scan_candidate" : "", index + 1 <= HOT_POOL_MAX_SYMBOLS ? "hot_pool" : "", userTracked ? "user_watchlist" : "", row.userCaseSeedMatched === true ? "designated_case" : "", row.userCaseLearningActive === true ? "case_pattern" : "", row.priorityMetrics?.trackedBuyPointActive === true ? "tracked_buy_point" : "", intradayBurst ? "intraday_surge_or_volume_spike" : ""].filter(Boolean);
    return ({
      poolReasons: Array.isArray(row.poolReasons) && row.poolReasons.length ? [...new Set(row.poolReasons)] : ["radar_rotation_fill"],
      symbol: row.symbol,
      name: row.name || row.symbol,
      market: row.market || "",
      priority_rank: row.openingReport0830BiasOnly === true ? Math.max(DEEP_SCAN_POOL_MAX_SYMBOLS + 1, index + 1) : index + 1,
      hot_extension_rank: hotExtensionRank,
      priority_reason: row.priorityReason || (row.isMotherPoolCandidate ? "mother_pool_signal" : "radar_rotation_fill"),
      source: row.sourceFlags?.length ? row.sourceFlags.join(",") : row.prioritySource || "unknown",
      updated_at: priorityUpdatedAt,
      payload: {
        score: numberValue(row.entryScore ?? row.score),
        entry_score: numberValue(row.entryScore ?? row.score),
        upgrade_score: numberValue(row.upgradeScore),
        hot_burst_fast_path: row.hotBurstFastPath === true,
        user_case_learning_active: row.userCaseLearningActive === true,
        user_case_seed_matched: row.userCaseSeedMatched === true,
        user_case_pattern_boost: numberValue(row.userCasePatternBoost),
        matched_case_patterns: row.matchedCasePatterns || [],
        upgrade_reasons: row.upgradeReasons || [],
        hot_burst_valid_seconds: HOT_BURST_MAX_STALE_SECONDS,
        hot_burst_cooldown_seconds: HOT_BURST_COOLDOWN_SECONDS,
        hot_burst_triggered_at: row.hotBurstTriggeredAt || "",
        hot_extension_rank: hotExtensionRank,
        pool_layer: index + 1 <= HOT_POOL_MAX_SYMBOLS ? "hot_pool" : "priority_pool",
        canonical_pool_layer: deepScanEligible ? "deep_scan_pool" : (index + 1 <= HOT_POOL_MAX_SYMBOLS ? "hot_pool" : "priority_pool"),
        trade_date: taipeiDate(),
        canonical_run_id: `${SOURCE_NAME}:${compactDateKey(taipeiDate())}:canonical`,
        deep_scan_eligible: deepScanEligible,
        candles_priority_required: deepScanEligible,
        candles_priority_reasons: candlesPriorityReasons,
        priority_rank: row.openingReport0830BiasOnly === true
          ? Math.max(DEEP_SCAN_POOL_MAX_SYMBOLS + 1, index + 1)
          : index + 1,
        source_flags: row.sourceFlags || [],
        is_daytrade_allowed: row.basePool?.eligible === true,
        price_gate_status: MOTHER_POOL_MIN_PRICE > 0 ? (numberValue(row.metrics?.price) >= MOTHER_POOL_MIN_PRICE ? "pass" : "below_minimum") : "no_price_floor",
        score_components: {
          entry_score: numberValue(row.entryScore ?? row.score),
          upgrade_score: numberValue(row.upgradeScore),
          change_percent: numberValue(row.priorityMetrics?.changePercent),
          relative_volume_ratio: numberValue(row.priorityMetrics?.volumeRatio5),
          volume_rank: numberValue(row.priorityMetrics?.volumeRank),
          trade_value_rank: numberValue(row.priorityMetrics?.tradeValueRank ?? row.priorityMetrics?.valueRank),
          ma_turn_bullish: row.priorityMetrics?.movingAverageTurnBullish === true,
          source_count: Array.isArray(row.sourceFlags) ? row.sourceFlags.length : 0,
        },
        data_gap_reason: row.priorityMetrics?.dataGap?.data_gap_reason || row.priorityMetrics?.dataGap?.status || "OK",
        candle_count: numberValue(row.priorityMetrics?.dataGap?.candle_count),
        first_candle_time: row.priorityMetrics?.dataGap?.first_candle_time || "",
        last_candle_time: row.priorityMetrics?.dataGap?.last_candle_time || "",
        missing_window: row.priorityMetrics?.dataGap?.missing_window || "",
        intraday_1m_stale_seconds: numberValue(row.priorityMetrics?.dataGap?.intraday_1m_stale_seconds, 999999),
        has_required_1m_window: row.priorityMetrics?.dataGap?.has_required_1m_window === true,
        latest_1m_time: row.priorityMetrics?.latestCandleTime || "",
        user_case_pattern_signals: row.userCasePatternSignals || [],
        consecutive_score_declines: numberValue(row.consecutiveScoreDeclines),
        downgrade_protection: row.downgradeProtection === true,
        fast_remove: row.fastRemove === true,
        selected: true,
        consumerScope: ["daytrade", "strategy3"],
        motherPoolRuleVersion: MOTHER_POOL_RULE_VERSION,
        motherPoolMetrics: row.priorityMetrics || {},
        motherPoolRuleHits: row.priorityMetrics?.ruleHits || [],
        poolReasons: Array.isArray(row.poolReasons) && row.poolReasons.length ? [...new Set(row.poolReasons)] : ["radar_rotation_fill"],
        strategySourceFlags: row.sourceFlags || [],
        liquidityGrade: row.liquidityGrade || "watch_only",
        motherPoolCandidate: row.isMotherPoolCandidate === true,
        dataGap: row.priorityMetrics?.dataGap || { status: "OK", candle_count: 0, first_candle_time: "", last_candle_time: "", missing_window: "", data_gap_reason: "", intraday_1m_stale_seconds: 999999, has_required_1m_window: true },
        basePoolEligible: row.priorityMetrics?.basePoolEligible === true,
        basePoolPending: row.priorityMetrics?.basePoolPending === true,
        runtimePrioritySource: seeds.source,
        runtimePriorityUpdatedAt: seeds.updatedAt,
        runtimePriorityCounts: seeds.counts,
      },
    });
  });
  output.sourceSeedCounts = seeds.counts;
  output.sourceSeedUpdatedAt = seeds.updatedAt;
  output.sourceSeedUnion = [...new Set(seeds.symbols.flatMap((entry) => entry.sources || []))];
  output.basePoolMeta = {
    activeSymbols: candidates.length,
    basePoolEligibleSymbols: qualifiedCandidates.length,
    basePoolPendingSymbols: pendingCandidates.length,
    basePoolExcludedSymbols: Math.max(0, candidates.length - qualifiedCandidates.length - pendingCandidates.length),
    minimumSymbols: MOTHER_POOL_MIN_SYMBOLS,
    maximumSymbols: MOTHER_POOL_MAX_SYMBOLS,
    minimumPrice: MOTHER_POOL_MIN_PRICE,
    minimumTurnoverRate: MOTHER_POOL_MIN_TURNOVER_RATE,
    signalCandidateSymbols: signalCandidates.length,
    rotationFillSymbols: rotationFillSelected.length,
    quotePendingSymbols: candidates.filter((row) => row.basePool.pendingChecks?.includes("quote_pending")).map((row) => row.symbol),
    quoteStaleSymbols: candidates.filter((row) => row.basePool.pendingChecks?.includes("quote_stale")).map((row) => row.symbol),
    priceFloorRejectedSymbols: candidates
      .filter((row) => (row.basePool.failedChecks || []).some((check) => String(check).startsWith("price_below_")))
      .map((row) => row.symbol),
    turnoverRateRejectedSymbols: candidates
      .filter((row) => (row.basePool.failedChecks || []).some((check) => String(check).startsWith("turnover_rate_below_")))
      .map((row) => row.symbol),
    turnoverRatePendingSymbols: candidates
      .filter((row) => (row.basePool.pendingChecks || []).includes("turnover_rate_pending"))
      .map((row) => row.symbol),
    ruleVersion: MOTHER_POOL_RULE_VERSION,
    failureCounts: basePoolFailureCounts,
    pendingCounts: basePoolPendingCounts,
  };
  return output;
}

function publishDaytradePrioritySymbols(priorityRows, activeSymbols = []) {
  const existing = readJson(PRIORITY_SYMBOLS_FILE, {});
  // This function runs after the strategy/chip bridge refresh. Keep the bridge
  // from the current artifact, or recover it from its cache when another
  // source writer has just replaced the priority shell.
  const bridgePayload = objectPayload(existing.priorityBridge)
    || objectPayload(readJson(STRATEGY_PRIORITY_BRIDGE_CACHE_FILE, {}));
  const bridgeGroups = objectPayload(bridgePayload?.groups);
  const bridgeFields = {};
  if (Object.keys(bridgeGroups).length > 0) {
    bridgeFields.priorityBridge = bridgePayload;
    for (const source of STRATEGY_PRIORITY_BRIDGE_SOURCES) {
      const group = objectPayload(bridgeGroups[source.key]);
      if (["ready", "blocked", "empty"].includes(String(group.status || "").toLowerCase())) {
        bridgeFields[source.key] = Array.isArray(group.symbols) ? group.symbols : [];
      }
    }
  }
  const priceEligiblePriorityRows = (priorityRows || []).filter((row) => {
    const metrics = row?.metrics || row?.payload?.motherPoolMetrics || {};
    const eligible = row?.basePool?.eligible === true
      || row?.payload?.basePoolEligible === true
      || row?.payload?.is_daytrade_allowed === true;
    return eligible
      && Number(metrics.price) >= MOTHER_POOL_MIN_PRICE;
  });
  const daytradeMotherPoolSymbols = priceEligiblePriorityRows
    .map((row) => normalizeCode(row.symbol))
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, MOTHER_POOL_MAX_SYMBOLS);
  const daytradeHotPoolSymbols = daytradeMotherPoolSymbols.slice(0, HOT_POOL_MAX_SYMBOLS);
  const daytradePrioritySymbols = daytradeMotherPoolSymbols.slice(0, MOTHER_POOL_MAX_SYMBOLS);
  const daytradePriorityExtensionSymbols = daytradeMotherPoolSymbols.slice(HOT_POOL_MAX_SYMBOLS, MOTHER_POOL_MAX_SYMBOLS);
  const daytradeFormalPrioritySymbols = daytradeMotherPoolSymbols.slice(0, DEEP_SCAN_POOL_MAX_SYMBOLS);
  const priceEligibleSymbolSet = new Set(priceEligiblePriorityRows
    .map((row) => normalizeCode(row.symbol))
    .filter((code) => /^\d{4}$/.test(code)));
  const openingReportCandlePrioritySymbols = compactDateKey(existing.openingReport0830PrewarmTradeDate) === compactDateKey(taipeiDate())
    ? (existing.openingReport0830PrewarmSymbols || [])
      .map((value) => normalizeCode(value?.symbol || value?.code || value))
      .filter((code) => priceEligibleSymbolSet.has(code))
    : [];
  const fixedUserCasePrefix = [...USER_CASE_SYMBOLS].filter((code) => priceEligibleSymbolSet.has(code));
  const userCaseCandlePrioritySymbols = [...new Set([
    ...fixedUserCasePrefix,
    ...priceEligiblePriorityRows
      .filter((row) => {
        const flags = Array.isArray(row.sourceFlags) ? row.sourceFlags : [];
        return flags.some((source) => /manual_watchlist|user_watchlist/i.test(String(source)))
          || row.userCaseSeedMatched === true;
      })
      .sort((a, b) => Number(b.userCaseSeedMatched === true) - Number(a.userCaseSeedMatched === true)
        || Number(b.userCaseLearningActive === true) - Number(a.userCaseLearningActive === true)
        || Number(b.upgradeScore || 0) - Number(a.upgradeScore || 0))
      .map((row) => normalizeCode(row.symbol))
      .filter((code) => /^\d{4}$/.test(code)),
  ])];
  const daytradeCandlePrioritySymbols = [...new Set([
    ...userCaseCandlePrioritySymbols,
    ...openingReportCandlePrioritySymbols,
    ...priceEligiblePriorityRows
      .filter((row, index) => {
        const flags = Array.isArray(row.sourceFlags) ? row.sourceFlags : [];
        return index < HOT_POOL_MAX_SYMBOLS || flags.some((source) => /manual_watchlist|user_watchlist/i.test(String(source))) || row.userCaseSeedMatched === true || row.userCaseLearningActive === true || row.hotBurstFastPath === true || row.priorityMetrics?.surgeFlag === true || row.priorityMetrics?.volumeSpikeFlag === true || row.priorityMetrics?.trackedBuyPointActive === true;
      })
      .map((row) => normalizeCode(row.symbol))
      .filter((code) => /^\d{4}$/.test(code)),
  ])];
  const activeUniverseSymbols = (activeSymbols || [])
    .map((row) => normalizeCode(row?.symbol || row?.code || row))
    .filter((code) => /^\d{4}$/.test(code));
  const formalPriorityStrategyChip = buildFormalStrategyChipArtifact(
    bridgePayload,
    daytradeFormalPrioritySymbols,
    bridgePayload.tradeDate || taipeiDate(),
  );
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
    ...bridgeFields,
    updatedAt: nowIso(),
    source: "daytrade-dedicated-priority-bridge",
    // Keep the complete mother pool on the WebSocket/data-rotation path.
    // Legacy formal-priority fields remain compatibility readback only; dynamic pools define scanning.
    daytradeMotherPoolSymbols,
    daytradeMotherPoolCount: daytradeMotherPoolSymbols.length,
    daytradeMinimumPrice: MOTHER_POOL_MIN_PRICE,
    daytradePoolPriceBySymbol: Object.fromEntries(priceEligiblePriorityRows.map((row) => [
      normalizeCode(row.symbol),
      Number(row.metrics?.price ?? row.payload?.motherPoolMetrics?.price),
    ])),
    daytradePriceGateStatus: MOTHER_POOL_MIN_PRICE > 0 ? "minimum_price_enforced" : "no_price_floor",
    daytradePrioritySymbols,
    daytradePriorityCount: daytradePrioritySymbols.length,
    daytradeCandlePrioritySymbols: [...new Set(daytradeCandlePrioritySymbols)],
    daytradeCandlePriorityCount: new Set(daytradeCandlePrioritySymbols).size,
    userCaseSymbols: [...new Set(userCaseCandlePrioritySymbols)],
    userCaseCandlePrioritySymbols: [...new Set(userCaseCandlePrioritySymbols)],
    userCaseCandlePriorityCount: new Set(userCaseCandlePrioritySymbols).size,
    userCaseCandlePriorityPolicy: "highest_priority_before_opening_report_and_hot_pool",
    daytradePriorityExtensionSymbols,
    daytradePriorityExtensionCount: daytradePriorityExtensionSymbols.length,
    daytradePriorityExtensionMinRank: DEEP_SCAN_POOL_MAX_SYMBOLS + 1,
    daytradePriorityExtensionMaxRank: HOT_POOL_MAX_SYMBOLS,
    daytradeHotPoolSymbols,
    daytradeHotPoolCount: daytradeHotPoolSymbols.length,
    daytradeHotPoolMinCount: HOT_POOL_MIN_SYMBOLS,
    daytradeHotPoolMaxCount: HOT_POOL_MAX_SYMBOLS,
    daytradeFormalPrioritySymbols: daytradeFormalPrioritySymbols,
    daytradeFormalPriorityCount: daytradeFormalPrioritySymbols.length,
    formalPriorityStrategyChip,
    terminalPrioritySymbols: prependUnique(daytradeMotherPoolSymbols, existing.terminalPrioritySymbols || existing.terminalSymbols || existing.terminalPriority),
    openingPrioritySymbols: prependUnique(daytradeMotherPoolSymbols, existing.openingPrioritySymbols || existing.primaryPrioritySymbols),
    // Keep the complete current active universe on the live quote radar; do not carry a smaller stale list forward.
    symbols: prependUnique(daytradeMotherPoolSymbols, activeUniverseSymbols),
    activeUniverseCount: activeUniverseSymbols.length,
    activeUniverseSource: "run-daytrade-source-writer.activeSymbols",
  };
  const sameSymbols = JSON.stringify(existing.symbols || []) === JSON.stringify(nextPriorityPayload.symbols || []);
  const samePriorityCounts = Number(existing.daytradeMotherPoolCount || 0) === nextPriorityPayload.daytradeMotherPoolCount
    && Number(existing.daytradeFormalPriorityCount || 0) === nextPriorityPayload.daytradeFormalPriorityCount
    && Number(existing.daytradePriorityExtensionCount || 0) === nextPriorityPayload.daytradePriorityExtensionCount;
  const bridgeChanged = Object.keys(bridgeFields).some((key) => JSON.stringify(existing[key]) !== JSON.stringify(bridgeFields[key]));
  const formalPriorityArtifactChanged = JSON.stringify(existing.formalPriorityStrategyChip || {}) !== JSON.stringify(formalPriorityStrategyChip);
  const priceGateArtifactChanged = Number(existing.daytradeMinimumPrice || 0) !== MOTHER_POOL_MIN_PRICE
    || String(existing.daytradePriceGateStatus || "") !== (MOTHER_POOL_MIN_PRICE > 0 ? "minimum_price_enforced" : "no_price_floor")
    || JSON.stringify(existing.daytradePoolPriceBySymbol || {}) !== JSON.stringify(nextPriorityPayload.daytradePoolPriceBySymbol || {});
  if (!sameSymbols || !samePriorityCounts || bridgeChanged || formalPriorityArtifactChanged || priceGateArtifactChanged) {
    writeJson(PRIORITY_SYMBOLS_FILE, nextPriorityPayload);
    writeFugleWebSocketSymbols(nextPriorityPayload.symbols, {
      source: "daytrade-dedicated-priority-bridge",
      prioritySource: "daytrade-dedicated-priority-bridge",
      daytradePriorityCount: daytradeMotherPoolSymbols.length,
      daytradeMotherPoolCount: daytradeMotherPoolSymbols.length,
    daytradeMinimumPrice: MOTHER_POOL_MIN_PRICE,
    daytradePoolPriceBySymbol: Object.fromEntries(priceEligiblePriorityRows.map((row) => [
      normalizeCode(row.symbol),
      Number(row.metrics?.price ?? row.payload?.motherPoolMetrics?.price),
    ])),
    daytradePriceGateStatus: MOTHER_POOL_MIN_PRICE > 0 ? "minimum_price_enforced" : "no_price_floor",
      daytradeHotPoolCount: daytradeHotPoolSymbols.length,
      daytradeFormalPriorityCount: daytradeFormalPrioritySymbols.length,
      terminalPriorityCount: nextPriorityPayload.terminalPrioritySymbols.length,
      openingPriorityCount: nextPriorityPayload.openingPrioritySymbols.length,
      preserveRecentSymbols: false,
    });
  }
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

  const strategy3 = countPriorityValues(payload.strategy3 || payload.strategy3Symbols, universe);
  const strategy4 = countPriorityValues(payload.strategy4 || payload.strategy4Symbols, universe);
  const strategy5 = countPriorityValues(payload.strategy5 || payload.strategy5Symbols, universe);
  const institution = countPriorityValues(payload.institution || payload.institutionSymbols, universe);
  const warrant = countPriorityValues(payload.warrant || payload.warrantSymbols, universe);
  const cb = countPriorityValues(payload.cb || payload.cbSymbols, universe);
  const realtimeRadar = 0;
  const formalPriorityStrategyChip = objectPayload(payload.formalPriorityStrategyChip);
  // Strategy/chip inputs are evidence for pool scoring, not a fixed-count gate.
  const strategyChipCompleteLatestRun = formalPriorityStrategyChip.schemaVersion === 'daytrade-formal-priority-strategy-chip-v1'
    && numberValue(formalPriorityStrategyChip.formalPriorityCount) > 0;
  return {
    source: payload.source || "",
    updatedAt: payload.updatedAt || "",
    daytrade: countPriorityValues(payload.daytradePrioritySymbols || payload.daytradeSymbols || payload.daytrade, universe),
    terminal: countPriorityValues(payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, universe),
    opening: countPriorityValues(payload.openingPrioritySymbols || payload.primaryPrioritySymbols, universe),

    strategy3,
    strategy4,
    strategy5,
    institution,
    warrant,
    cb,
    realtimeRadar,
    formalPriorityStrategyChip,
    strategyChipCompleteLatestRun,
    strategyChipCompleteLatestRunReason: strategyChipCompleteLatestRun ? '' : String(formalPriorityStrategyChip.completeLatestRunReason || 'formal_priority_strategy_chip_missing_or_incomplete'),
    strategyPriority: strategy3 + strategy4 + strategy5 + institution + warrant + cb,
    total: countPriorityValues(payload.symbols, universe),
  };
}

function readWebSocketStatusSummary() {
  const status = readJson(FUGLE_WS_STATUS_FILE, {});
  const streamingChannels = Array.isArray(status.streamingChannels) ? status.streamingChannels : [];
  const requiredChannels = ['trades', 'aggregates', 'candles'];
  const statusAgeSeconds = ageSeconds(status.updatedAt || status.checkedAt || status.timestamp);
  const transportReady = status.ok !== false
    && status.mode === 'streaming'
    && status.websocketConnected === true
    && status.websocketAuthenticated === true
    && status.restDisabled === true
    && requiredChannels.every((channel) => streamingChannels.includes(channel))
    && numberValue(status.subscribedSymbols) > 0
    && numberValue(status.subscribeForbiddenChunks) === 0
    && numberValue(status.streamingMessages) > 0
    && statusAgeSeconds <= 300
    && Boolean(status.lastMessageAt || status.websocketLastMessageAt)
    && ageSeconds(status.lastMessageAt || status.websocketLastMessageAt) <= 300;
  const lastMessageAt = status.lastMessageAt || status.websocketLastMessageAt || "";
  const lastMessageAgeSeconds = lastMessageAt ? ageSeconds(lastMessageAt) : 999999;
  const freshSymbols120s = numberValue(status.freshSymbols120s ?? status.websocketFreshSymbols120s);
  return {
    ok: status.ok !== false,
    mode: status.mode || '',
    channel: status.channel || '',
    streamingChannel: status.streamingChannel || '',
    streamingChannels,
    connected: Boolean(status.websocketConnected),
    authenticated: Boolean(status.websocketAuthenticated),
    subscribed: numberValue(status.subscribed),
    subscribedSymbols: numberValue(status.subscribedSymbols),
    subscribedChannels: numberValue(status.subscribedChannels),
    streamingMessages: numberValue(status.streamingMessages),
    streamingQuotes: numberValue(status.streamingQuotes),
    streamingQuoteSpeedPerSec: numberValue(status.streamingQuoteSpeedPerSec),
    lastMessageAt,
    lastMessageAgeSeconds,
    symbolCount: numberValue(status.websocketSymbolCount ?? status.subscribedSymbols),
    freshSymbols120s,
    priorityDaytradeSymbols: numberValue(status.priorityDaytradeSymbols),
    priorityFileUpdatedAt: status.priorityFileUpdatedAt || '',
    statusAgeSeconds,
    restDisabled: Boolean(status.restDisabled),
    formalReady: transportReady,
    formalReadyReason: transportReady
      ? 'streaming_authenticated_required_channels_and_subscription_ready'
      : (status.formalReadyReason || 'websocket_transport_not_formal_ready'),
    updatedAt: status.updatedAt || '',
  };
}

function strategy3TailCandidateSymbols() {
  // Retired: Strategy3 must consume the Strategy2 Mother Pool only.
  return [];
}

function selectFetchBatch(activeSymbols, priorityRows, quoteMap, state, options = {}) {
  const active = activeSymbols.map((row) => row.symbol);
  const activeSet = new Set(active);
  const priority = priorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol));
  const runtimePriorityPayload = readJson(PRIORITY_SYMBOLS_FILE, {});
  const runtimeList = (value) => Array.isArray(value) ? value : [];
  const terminalRadarPriority = [...new Set([
    ...runtimeList(runtimePriorityPayload.terminalPrioritySymbols),
    ...runtimeList(runtimePriorityPayload.terminalSymbols),
    ...runtimeList(runtimePriorityPayload.terminalPriority),
    ...runtimeList(runtimePriorityPayload.openingPrioritySymbols),
    ...runtimeList(runtimePriorityPayload.primaryPrioritySymbols),

    ...runtimeList(runtimePriorityPayload.strategy3Symbols),
    ...runtimeList(runtimePriorityPayload.strategy4Symbols),
    ...runtimeList(runtimePriorityPayload.strategy5Symbols),
    ...runtimeList(runtimePriorityPayload.chipPrioritySymbols),
    ...runtimeList(runtimePriorityPayload.chipSymbols),
    ...runtimeList(runtimePriorityPayload.institutionSymbols),
    ...runtimeList(runtimePriorityPayload.userCaseCandlePrioritySymbols),
    ...runtimeList(runtimePriorityPayload.userCaseSymbols),
  ].map((value) => normalizeCode(value?.symbol || value?.code || value)).filter((symbol) => symbol && activeSet.has(symbol)))];
  const priorityOnly = Boolean(options.priorityOnly) || futureSeconds(state.priorityOnlyUntil) > 0 || futureSeconds(state.cooldownUntil) > 0;
  const notFoundUntilBySymbol = state.notFoundUntilBySymbol || {};
  const skippedByNotFound = (symbol) => futureSeconds(notFoundUntilBySymbol[symbol]) > 0;
  const stale = (symbol, maxAge = WINDOW_SECONDS) => ageSeconds(quoteFreshnessTime(quoteMap.get(symbol))) > maxAge;
  const selected = [];
  const selectedSet = new Set();
  const add = (symbol) => {
    if (!symbol || selectedSet.has(symbol) || !activeSet.has(symbol) || skippedByNotFound(symbol) || selected.length >= QUOTE_BATCH_SIZE) return;
    selected.push(symbol);
    selectedSet.add(symbol);
  };
  for (const symbol of priority) {
    if (stale(symbol, SELECTED_SYMBOL_MAX_AGE_SECONDS)) add(symbol);
  }
  for (const symbol of terminalRadarPriority) {
    if (stale(symbol, SELECTED_SYMBOL_MAX_AGE_SECONDS)) add(symbol);
  }
  if (!priorityOnly) {
    let cursor = Math.max(0, Math.min(state.cursor || 0, active.length - 1));
    for (let i = 0; i < active.length && selected.length < QUOTE_BATCH_SIZE; i += 1) {
      const symbol = active[(cursor + i) % active.length];
      if (priority.includes(symbol)) continue;
      if (stale(symbol, WINDOW_SECONDS)) add(symbol);
    }
    if (selected.length < QUOTE_BATCH_SIZE) {
      for (let i = 0; i < active.length && selected.length < QUOTE_BATCH_SIZE; i += 1) {
        const symbol = active[(cursor + i) % active.length];
        if (!priority.includes(symbol)) add(symbol);
      }
    }
    state.cursor = active.length ? (cursor + Math.max(1, selected.length)) % active.length : 0;
  }
  if (selected.length < QUOTE_BATCH_SIZE) {
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
  const limitUpPrice = numberValue(payload?.limitUpPrice || payload?.limitUp || payload?.limit_up_price || (previousClose > 0 ? previousClose * 1.1 : 0));
  const limitDownPrice = numberValue(payload?.limitDownPrice || payload?.limitDown || payload?.limit_down_price || (previousClose > 0 ? previousClose * 0.9 : 0));
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
    limit_up_price: limitUpPrice || null,
    limit_down_price: limitDownPrice || null,
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

function computeStats({ activeSymbols, priorityRows, quoteMap, fetchedRows, dailyVolumeMap, intradayMap, futoptRows, websocketFutoptSync = {}, opening0901Evidence = {}, fetchResult, state, supplementalMaps = {} }) {
  const phase = phaseNow();
  const warmupDataFillActive = taipeiMinutes() >= PREOPEN_WARMUP_START_MINUTES;
  const runtimePriority = readRuntimePrioritySummary(activeSymbols);
  const strategyChipCompleteLatestRun = runtimePriority.strategyChipCompleteLatestRun === true;
  const strategyChipReason = runtimePriority.strategyChipCompleteLatestRunReason || 'formal_priority_strategy_chip_missing_or_incomplete';
  const webSocketStatus = readWebSocketStatusSummary();
  // Discovery and formal scanning use dynamic priority/hot/deep-scan pools.
  // Legacy rank fields remain readback-only and never define a hard gate.
  const hotPriorityRows = priorityRows.slice(0, HOT_POOL_MAX_SYMBOLS);
  const priorityExtensionRows = priorityRows.slice(DEEP_SCAN_POOL_MAX_SYMBOLS, HOT_POOL_MAX_SYMBOLS);
  const formalPriorityRows = priorityRows.slice(0, DEEP_SCAN_POOL_MAX_SYMBOLS);
  const minFormalPrioritySymbols = 1;
  const quoteTransport = webSocketStatus.mode === "streaming"
    ? `websocket_${(webSocketStatus.streamingChannel || "streaming").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
    : "rest_quote";
  const after0830 = ["preopen_prepare_0830_0844", "opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0845 = ["opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0900 = ["opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const opening0901Required = after0900 && taipeiMinutes() >= (9 * 60 + 2);

  for (const row of fetchedRows) quoteMap.set(row.symbol, row);
  const activeSet = new Set(activeSymbols.map((row) => row.symbol));
  const prioritySet = new Set(priorityRows.map((row) => normalizeCode(row.symbol)).filter((symbol) => activeSet.has(symbol)));
  const deepScanSet = new Set(priorityRows.filter((row) => row.deepScanEligible === true || row.deep_scan_eligible === true || row.payload?.deep_scan_eligible === true).map((row) => normalizeCode(row.symbol)).filter((symbol) => activeSet.has(symbol)));
  const formalPrioritySet = new Set(formalPriorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol)));
  const priorityExtensionSet = new Set(priorityExtensionRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol)));
  const freshFull = [];
  const freshPriority = [];
  const freshFormalPriority = [];
  const freshDeepScan = [];
  const quoteAges = [];
  let lastQuoteAt = "";
  const priorityAges = [];
  const freshPriorityAges = [];
  for (const symbol of activeSet) {
    const quote = quoteMap.get(symbol);
    const quoteTime = quoteFreshnessTime(quote);
    const quoteAge = ageSeconds(quoteTime);
    if (quote) {
      quoteAges.push(quoteAge);
      if (quoteTime && (!lastQuoteAt || Date.parse(quoteTime) > Date.parse(lastQuoteAt))) lastQuoteAt = quoteTime;
    }
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
  for (const symbol of formalPrioritySet) {
    const quote = quoteMap.get(symbol);
    if (ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS) freshFormalPriority.push(symbol);
  }

  const priorityPoolSymbols = prioritySet.size;
  const deepScanPoolSymbols = deepScanSet.size;
  const formalPriorityPoolSymbols = formalPrioritySet.size;
  const priorityExtensionPoolSymbols = priorityExtensionSet.size;
  const motherPoolSet = new Set(priorityRows.map((row) => normalizeCode(row.symbol)).filter((symbol) => activeSet.has(symbol)));
  const freshMother = freshFull.filter((symbol) => motherPoolSet.has(symbol));
  const motherPoolSymbols = motherPoolSet.size;
  const activeCount = activeSet.size;
  const freshQuoteCoverage = activeCount ? freshFull.length / activeCount : 0;
  const priorityFreshCoverage = priorityPoolSymbols ? freshPriority.length / priorityPoolSymbols : 0;
  const formalPriorityFreshCoverage = formalPriorityPoolSymbols ? freshFormalPriority.length / formalPriorityPoolSymbols : 0;
  const deepScanFreshCoverage = deepScanPoolSymbols ? [...deepScanSet].filter((symbol) => ageSeconds(quoteFreshnessTime(quoteMap.get(symbol))) <= WINDOW_SECONDS).length / deepScanPoolSymbols : 0;
  const motherFreshCoverage = motherPoolSymbols ? freshMother.length / motherPoolSymbols : 0;
  const priorityMaxAge = priorityAges.length ? Math.max(...priorityAges) : 999999;
  const priorityFreshMaxAge = freshPriorityAges.length ? Math.max(...freshPriorityAges) : 999999;
  const priorityCoverageAge = percentile(priorityAges, MIN_PRIORITY_FRESH_COVERAGE);
  const priorityStaleOrMissingSymbols = Math.max(0, priorityPoolSymbols - freshPriority.length);
  const latestQuoteAge = quoteAges.length ? Math.min(...quoteAges) : 999999;
  const prioritySourceInjecting = priorityPoolSymbols >= minFormalPrioritySymbols
    && freshPriority.length >= MIN_PRIORITY_INJECTING_QUOTES
    && latestQuoteAge <= MAX_QUOTE_AGE_SECONDS;
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

  let readyMa3 = 0;
  let readyMa20 = 0;
  let readyMa35 = 0;
  let readyMa58 = 0;
  let today1mSymbols = 0;
  let today1mRows = 0;
  let intraday1mStaleSeconds = 999999;
  let latestCandleTime = '';
  const intraday1mReadySet = new Set();
  for (const [symbol, row] of intradayMap.entries()) {
    if (!activeSet.has(symbol)) continue;
    const continuousCount = numberValue(row.continuous_candle_count ?? row.candle_count);
    if (boolValue(row.ready_ma3) || continuousCount >= 3) readyMa3 += 1;
    if (boolValue(row.ready_ma20_continuous) || continuousCount >= 20) readyMa20 += 1;
    if (boolValue(row.ready_ma35_continuous) || boolValue(row.ready_ge_35) || continuousCount >= 35) readyMa35 += 1;
    if (boolValue(row.ready_ma58) || continuousCount >= 58) readyMa58 += 1;
    if (numberValue(row.today_candle_count) > 0) today1mSymbols += 1;
    if (continuousCount >= 20 && numberValue(row.latest_candle_age_seconds, 999999) <= MAX_INTRADAY_1M_STALE_SECONDS) intraday1mReadySet.add(symbol);
    today1mRows += numberValue(row.today_candle_count);
    if (row.latest_candle_time && (!latestCandleTime || Date.parse(row.latest_candle_time) > Date.parse(latestCandleTime))) latestCandleTime = row.latest_candle_time;
    intraday1mStaleSeconds = Math.min(intraday1mStaleSeconds, numberValue(row.latest_candle_age_seconds, 999999));
  }
  if (intradayMap.aggregate) {
    readyMa3 = Math.max(readyMa3, numberValue(intradayMap.aggregate.readyMa3));
    readyMa20 = Math.max(readyMa20, numberValue(intradayMap.aggregate.readyMa20));
    readyMa35 = Math.max(readyMa35, numberValue(intradayMap.aggregate.readyMa35));
    readyMa58 = Math.max(readyMa58, numberValue(intradayMap.aggregate.readyMa58));
    today1mSymbols = Math.max(today1mSymbols, numberValue(intradayMap.aggregate.todaySymbols));
    today1mRows = Math.max(today1mRows, numberValue(intradayMap.aggregate.todayRows));
    const aggregateStaleSeconds = numberValue(intradayMap.aggregate.staleSeconds, 999999);
    intraday1mStaleSeconds = Math.min(intraday1mStaleSeconds, aggregateStaleSeconds);
    if (Array.isArray(intradayMap.aggregate.ready20Symbols)) {
      for (const symbol of intradayMap.aggregate.ready20Symbols) {
        const normalized = normalizeCode(symbol);
        if (normalized && activeSet.has(normalized)) {
          intraday1mReadySet.add(normalized);
          const previous = intradayMap.get(normalized) || { symbol: normalized };
          intradayMap.set(normalized, {
            ...previous,
            symbol: normalized,
            latest_candle_time: previous.latest_candle_time || intradayMap.aggregate.latestCandleTime || "",
            latest_candle_age_seconds: Math.min(numberValue(previous.latest_candle_age_seconds, 999999), aggregateStaleSeconds),
            ready_ma20_continuous: true,
            continuous_candle_count: Math.max(numberValue(previous.continuous_candle_count), 20),
            today_candle_count: Math.max(numberValue(previous.today_candle_count), 20),
            source: previous.source || "v_fugle_daytrade_intraday_1m_status_aggregate",
          });
        }
      }
    }
    if (Array.isArray(intradayMap.aggregate.ready35Symbols)) {
      for (const symbol of intradayMap.aggregate.ready35Symbols) {
        const normalized = normalizeCode(symbol);
        if (normalized && activeSet.has(normalized)) {
          intraday1mReadySet.add(normalized);
          const previous = intradayMap.get(normalized) || { symbol: normalized };
          intradayMap.set(normalized, {
            ...previous,
            symbol: normalized,
            latest_candle_time: previous.latest_candle_time || intradayMap.aggregate.latestCandleTime || "",
            latest_candle_age_seconds: Math.min(numberValue(previous.latest_candle_age_seconds, 999999), aggregateStaleSeconds),
            ready_ma20_continuous: true,
            ready_ma35_continuous: true,
            ready_ge_35: true,
            continuous_candle_count: Math.max(numberValue(previous.continuous_candle_count), 35),
            today_candle_count: Math.max(numberValue(previous.today_candle_count), 35),
            source: previous.source || "v_fugle_daytrade_intraday_1m_status_aggregate",
          });
        }
      }
    }
    if (intradayMap.aggregate.latestCandleTime && (!latestCandleTime || Date.parse(intradayMap.aggregate.latestCandleTime) > Date.parse(latestCandleTime))) latestCandleTime = intradayMap.aggregate.latestCandleTime;
  }  const warmupEvidence = readWarmupNaturalEvidenceCounts();
  if (after0900 && warmupEvidence && warmupEvidence.scannerCanRunOpening && warmupEvidence.quoteAgeSeconds <= MAX_QUOTE_AGE_SECONDS && warmupEvidence.priorityCoverage >= MIN_PRIORITY_FRESH_COVERAGE) {
    readyMa20 = Math.max(readyMa20, warmupEvidence.readyMa20);
    readyMa35 = Math.max(readyMa35, warmupEvidence.readyMa35);
    intradayMap.warmupEvidenceSource = warmupEvidence.source;
  }
  const opening0901HardRequired = opening0901Required;
  const opening0901GateOk = !opening0901HardRequired
    || Boolean(opening0901Evidence.ready)
    || (after0900 && today1mSymbols > 0 && intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);
  const opening0901Ready = opening0901GateOk;
  const futoptMappedFromRows = Number.isFinite(Number(futoptRows.mappedCount))
    ? Number(futoptRows.mappedCount)
    : futoptRows.filter((row) => normalizeCode(row.underlying_symbol) && ageSeconds(row.updated_at) <= 120).length;
  const futoptMappedFromThisLoop = Number(websocketFutoptSync.stockRows || 0);
  const futoptMapped = Math.max(futoptMappedFromRows, futoptMappedFromThisLoop);
  const futoptRowsFresh = futoptRows.filter((row) => ageSeconds(row.updated_at) <= 180);
  const latestFutoptUpdatedAt = futoptRows
    .map((row) => normalizeTimestamp(row.updated_at || row.payload?.updatedAt || "", ""))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  const latestTxfUpdatedAt = futoptRows
    .filter((row) => String(row.product || row.payload?.product || "").toUpperCase() === "TXF" || String(row.future_symbol || "").toUpperCase().startsWith("TXF"))
    .map((row) => normalizeTimestamp(row.updated_at || row.payload?.updatedAt || "", ""))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  const futoptStockFreshRows = futoptRowsFresh.filter((row) => {
    const product = String(row.product || row.payload?.product || '').toUpperCase();
    const underlying = normalizeCode(row.underlying_symbol || row.payload?.underlying_symbol || row.payload?.underlyingSymbol);
    return product === 'STOCK_FUTURE' || (underlying && underlying !== 'TXF');
  });
  const futoptTxfOk = futoptRowsFresh.some((row) => {
    const product = String(row.product || row.payload?.product || '').toUpperCase();
    const underlying = String(row.underlying_symbol || row.payload?.underlying_symbol || row.payload?.underlyingSymbol || '').toUpperCase();
    const futureSymbol = String(row.future_symbol || '').toUpperCase();
    return product === 'TXF' || underlying === 'TXF' || futureSymbol.startsWith('TXF');
  });
  const futoptContractRows = futoptRows.length;
  const futoptReadyRows = futoptStockFreshRows.length;
  const futoptStaleRows = Math.max(0, futoptContractRows - futoptReadyRows);
  const futoptGateReady = futoptContractRows > 0 && futoptReadyRows > 0 && futoptTxfOk;
  const futoptReason = futoptGateReady
    ? 'ready'
    : futoptContractRows === 0
      ? 'no_contract'
      : !futoptTxfOk
        ? 'txf_stale'
        : futoptReadyRows === 0
          ? 'futopt_stale'
          : 'not_ready';
  const cooldownRemaining = futureSeconds(state.cooldownUntil);
  const last429AgeSeconds = state.last429At ? ageSeconds(state.last429At) : 999999;
  const rateLimitStatus = cooldownRemaining > 0 ? "cooldown" : fetchResult.rateLimited ? "rate_limited" : "ok";
  const restQuoteSpeed = fetchResult.elapsedSeconds ? Number((fetchResult.fetched / fetchResult.elapsedSeconds).toFixed(4)) : 0;
  const websocketQuoteSpeed = numberValue(webSocketStatus.streamingQuoteSpeedPerSec);
  const actualQuoteSpeed = quoteTransport.startsWith("websocket_") && websocketQuoteSpeed > 0
    ? websocketQuoteSpeed
    : restQuoteSpeed;
  const intraday1mReadySymbols = [...motherPoolSet].filter((symbol) => intraday1mReadySet.has(symbol)).length;
  const intraday1mReadyCoverage = motherPoolSymbols ? intraday1mReadySymbols / motherPoolSymbols : 0;
  const priorityIntraday1mReadySymbols = [...prioritySet].filter((symbol) => intraday1mReadySet.has(symbol)).length;
  const priorityIntraday1mReadyCoverage = priorityPoolSymbols ? priorityIntraday1mReadySymbols / priorityPoolSymbols : 0;
  // Mother Pool discovers candidates. Formal Strategy2 water is measured only
  // against priority/hot/deep-scan symbols, never against the discovery pool.
  const formalScanPoolSymbols = deepScanPoolSymbols;
  const formalScanIntraday1mReadySymbols = [...deepScanSet].filter((symbol) => intraday1mReadySet.has(symbol)).length;
  const formalScanIntraday1mReadyCoverage = formalScanPoolSymbols ? formalScanIntraday1mReadySymbols / formalScanPoolSymbols : 0;
  const deepScanIntraday1mDataGapSymbols = [...deepScanSet]
    .filter((symbol) => !intraday1mReadySet.has(symbol));
  const deepScanIntraday1mFreshAges = [...deepScanSet]
    .filter((symbol) => intraday1mReadySet.has(symbol))
    .map((symbol) => Math.min(
      numberValue(intradayMap.get(symbol)?.latest_candle_age_seconds, 999999),
      intraday1mStaleSeconds,
    ));
  // DATA_GAP is per-symbol. One missing/stale candle cannot mark an otherwise-ready formal pool stale.
  const deepScanIntraday1mFreshMaxAgeSeconds = deepScanIntraday1mFreshAges.length
    ? Math.max(...deepScanIntraday1mFreshAges)
    : 999999;
  const deepScanIntraday1mStaleSeconds = deepScanIntraday1mFreshMaxAgeSeconds;
  const intraday1mReadyMinSymbols = Math.max(1, Math.ceil(formalScanPoolSymbols * MIN_INTRADAY_1M_READY_COVERAGE));
  const intraday1mCoverageGateReady = formalScanPoolSymbols >= minFormalPrioritySymbols
    && formalScanIntraday1mReadySymbols >= intraday1mReadyMinSymbols
    && formalScanIntraday1mReadyCoverage >= MIN_INTRADAY_1M_READY_COVERAGE
    && deepScanIntraday1mFreshMaxAgeSeconds <= MAX_INTRADAY_1M_STALE_SECONDS;
  const scannerCanRunQuoteOnly = formalScanPoolSymbols >= minFormalPrioritySymbols
    && deepScanFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && rateLimitStatus === "ok";
  const effectiveMa20Required = Math.min(MIN_READY_MA20_CONTINUOUS, Math.max(1, formalScanPoolSymbols));
  const effectiveMa35Required = Math.min(MIN_READY_MA35_CONTINUOUS, Math.max(1, formalScanPoolSymbols));
  const scannerCanRunOpening = scannerCanRunQuoteOnly
    && dailyVolumeStatus === "ready"
    && readyMa20 >= effectiveMa20Required
    && (!REQUIRE_MA35_FOR_FORMAL_DAYTRADE || readyMa35 >= effectiveMa35Required)
    && (!after0900 || formalScanIntraday1mReadyCoverage >= MIN_INTRADAY_1M_READY_COVERAGE)
    && opening0901GateOk;
  const scannerCanRunPreopen = scannerCanRunQuoteOnly
    && dailyVolumeStatus === "ready"
    && readyMa20 >= effectiveMa20Required
    && (!REQUIRE_MA35_FOR_FORMAL_DAYTRADE || readyMa35 >= effectiveMa35Required);
  const scannerCanRunIntraday = scannerCanRunOpening
    && after0900
    && today1mSymbols > 0
    && intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS;
  const quoteRows = quoteAges.length;
  const quoteStatus = latestQuoteAge <= MAX_QUOTE_AGE_SECONDS
    ? "ready"
    : freshFull.length > 0
    ? "degraded"
    : quoteRows > 0
    ? "stale"
    : "empty";
  const preopenStatus = selectedSymbolsFreshOk
    ? "ready"
    : priorityPoolSymbols >= minFormalPrioritySymbols && freshPriority.length > 0
    ? "degraded"
    : priorityPoolSymbols > 0
    ? "stale"
    : "empty";
  const ma20WarmupStatus = readyMa20 >= effectiveMa20Required ? "ready" : readyMa20 > 0 ? "degraded" : "empty";
  const ma35WarmupStatus = readyMa35 >= effectiveMa35Required ? "ready" : readyMa35 > 0 ? "degraded" : "empty";
  const historical1mWarmupStatus = ma20WarmupStatus === "ready"
    && (!REQUIRE_MA35_FOR_FORMAL_DAYTRADE || ma35WarmupStatus === "ready")
    ? "ready"
    : readyMa20 > 0 || readyMa35 > 0
    ? "degraded"
    : "empty";
  const today1mStatus = after0900
    ? today1mSymbols > 0 && intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS
      ? "ready"
      : today1mSymbols > 0
      ? "degraded"
      : "empty"
    : "not_required_preopen";

  const priorityGateA = sourceGateA({
    after0830,
    after0845,
    after0900,
    selectedSymbolsFreshOk,
    prioritySourceInjecting,
    priorityPoolSymbols,
    priorityFreshCoverage,
    motherPoolSymbols,
    motherFreshCoverage,
    quoteAgeSeconds: latestQuoteAge,
    cooldownRemaining,
    last429AgeSeconds,
    dailyVolumeStatus,
    readyMa20,
    readyMa35,
    effectiveMa20Required,
    effectiveMa35Required,
    futoptMapped,
    futoptGateReady,
    intraday1mStaleSeconds,
    intraday1mReadyCoverage: formalScanIntraday1mReadyCoverage,
    priorityIntraday1mReadyCoverage,
    scannerCanRunOpening,
    strategyChipCompleteLatestRun,
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
  const motherPoolReasonlessRows = priorityRows.filter((row) => !Array.isArray(row.poolReasons) || row.poolReasons.length === 0);
  const stockFutureInitialRows = [...(supplementalMaps.stockFutureInitialMap || new Map()).values()];
  const stockGroupMeta = supplementalMaps.stockGroupContractMap?.meta || { source: "missing", rows: 0 };
  const offSession = ["closed_before_0600", "after_daytrade_window"].includes(phase);
  const formalEntryWindow = !offSession && after0845;
  const openingBoostActive = ["opening_boost_0845_0859", "opening_detection_0900_0934"].includes(phase)
    && quoteFetchAllowedForPhase(phase)
    && FETCH_ENABLED
    && !offSession;
  const openingBoostEffective = openingBoostActive
    && (prioritySourceInjecting || selectedSymbolsFreshOk || fetchResult.fetched > 0);
  const openingBoostScope = openingBoostActive ? "priority_pool_hot_pool" : "inactive";
  const openingBoostReason = openingBoostActive
    ? prioritySourceInjecting
      ? "priority_source_injecting"
      : fetchResult.fetched > 0
      ? "priority_fetch_in_progress"
      : "opening_boost_waiting_for_priority_freshness"
    : `phase_${phase}`;
  const priorityGateGrade = priorityGateA ? "A" : selectedSymbolsFreshOk || prioritySourceInjecting ? "B" : "D";
  const gateGrade = priorityGateA && formalEntryWindow && webSocketStatus.formalReady ? "A" : selectedSymbolsFreshOk || prioritySourceInjecting ? "B" : freshFull.length > 0 ? "C" : "D";
  const sourceInjecting = !offSession && ["ready", "degraded"].includes(quoteStatus) && quoteRows > 0;
  const status = offSession ? "stopped" : gateGrade === "A" ? "ok" : sourceInjecting ? "degraded" : "stale";
  const failedChecks = [];
  const discoveryWarnings = [];
  if (!offSession && deepScanIntraday1mDataGapSymbols.length) {
    discoveryWarnings.push('formal_scan_data_gap_symbols=' + deepScanIntraday1mDataGapSymbols.length);
  }
  if (!offSession && motherPoolSymbols < MOTHER_POOL_MIN_SYMBOLS) discoveryWarnings.push('mother_pool_discovery_below_target_warning');
  // Mother pool is the full-market discovery layer. Formal entry uses dynamic priority/hot/deep-scan pools.
  const motherPoolFreshnessWarning = !offSession && motherFreshCoverage < 0.8;
  if (!offSession && priorityPoolSymbols < minFormalPrioritySymbols) failedChecks.push('priority_pool_empty');
  if (!offSession && priorityFreshCoverage < MIN_PRIORITY_FRESH_COVERAGE) failedChecks.push('priority_pool_fresh_coverage_below_' + String(Math.round(MIN_PRIORITY_FRESH_COVERAGE * 100)).padStart(2, '0'));

  // Strategy/chip results are a formal-entry dependency after the opening gate; before then they remain warmup evidence.
  if (!offSession && latestQuoteAge > MAX_QUOTE_AGE_SECONDS) failedChecks.push('quote_stale');
  if (!offSession && dailyVolumeStatus !== 'ready') failedChecks.push('daily_volume_not_ready');
  if (!offSession && after0900 && motherPoolSymbols < MOTHER_POOL_MIN_SYMBOLS) discoveryWarnings.push('intraday_1m_mother_pool_discovery_below_target_warning');
  if (!offSession && after0900 && formalScanIntraday1mReadySymbols < intraday1mReadyMinSymbols) failedChecks.push('intraday_1m_ready_symbols_below_dynamic_min');
  if (!offSession && after0900 && formalScanIntraday1mReadyCoverage < MIN_INTRADAY_1M_READY_COVERAGE) failedChecks.push('intraday_1m_ready_coverage_below_090');

  if (!offSession && after0900 && intraday1mStaleSeconds > MAX_INTRADAY_1M_STALE_SECONDS) failedChecks.push('intraday_1m_not_ready');
  if (!offSession && opening0901HardRequired && !opening0901GateOk) failedChecks.push('opening_0901_candle_not_ready');
  // Futopt failure disables only futopt/STAR/preopen basis strategies; it never zeros the intraday Mother Pool.
  if (!offSession && !webSocketStatus.formalReady) failedChecks.push('websocket_formal_not_ready');
  if (!offSession && after0845 && !scannerCanRunOpening) failedChecks.push('scanner_opening_not_ready');
  const reasonCode = failedChecks[0] || (offSession ? "off_session_previous_good" : "");
  const message = offSession
    ? `dedicated daytrade source stopped off-session; latest formal entry disabled; quote=${quoteStatus} priority=${freshPriority.length}/${priorityPoolSymbols} full=${freshFull.length}/${activeCount}`
    : gateGrade === "A"
    ? "dedicated daytrade source priority injecting gate A"
    : priorityGateGrade === "A" && !formalEntryWindow
    ? `dedicated daytrade source warmup priority gate A; formal entry not allowed; phase=${phase}; priority=${freshPriority.length}/${priorityPoolSymbols}; full=${freshFull.length}/${activeCount}; rate=${rateLimitStatus}`
    : `dedicated daytrade source ${gateGrade}; status=${status}; reason=${reasonCode || 'none'}; quote=${quoteStatus}; preopen=${preopenStatus}; daily=${dailyVolumeStatus}; historical1m=${historical1mWarmupStatus}; today1m=${today1mStatus}; priority=${freshPriority.length}/${priorityPoolSymbols}; full=${freshFull.length}/${activeCount}; rate=${rateLimitStatus}`;

  const intraday1mReadinessSource = intradayMap.warmupEvidenceSource
    ? `${intradayMap.readinessSource || "unknown"}+natural_0900_warmup_evidence`
    : (intradayMap.readinessSource || "unknown");
  const quoteSourceDaytradeOk = quoteStatus === "ready" && latestQuoteAge <= MAX_QUOTE_AGE_SECONDS;
  const intraday1mSourceDaytradeOk = !after0900
    || (today1mStatus === "ready" && intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);
  const formalSourceAlignmentOk = quoteSourceDaytradeOk && intraday1mSourceDaytradeOk && opening0901GateOk;
  const formalPrioritySpeedOk = motherFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && motherPoolSymbols >= MOTHER_POOL_MIN_SYMBOLS;
  const payload = {
    source_name: SOURCE_NAME,
    writer_version: "daytrade-source-writer-20260702-03",
    daytrade_gate_grade: gateGrade,
    gate_grade: offSession ? "D" : gateGrade,
    gate_status: gateGrade === "A" ? "ready" : "not_ready",
    formal_entry_speed_verdict: gateGrade === "A" ? "YES" : "NO",
    // Formal daytrade speed is measured on the subscribed priority pool.
    // Full-market quote speed is diagnostic only and must not block formal entry.
    daytrade_source_speed_ok: formalPrioritySpeedOk,
    gate_mode: "priority_first",
    formal_gate_scope: "mother_pool_complete_dynamic_scan",
    formal_scan_scope: "mother_pool_complete_dynamic_scan",
    mother_pool_scan_min_symbols: MOTHER_POOL_MIN_SYMBOLS,
    mother_pool_scan_max_symbols: MOTHER_POOL_MAX_SYMBOLS,
    formal_source_name: SOURCE_NAME,
    formal_gate_source: "source_status.payload+v_fugle_daytrade_canonical_gate",
    formal_quote_source: "fugle_daytrade_quotes_live",
    formal_intraday_1m_source: "fugle_daytrade_intraday_1m",
    formal_intraday_1m_readiness_source: intraday1mReadinessSource,
    quote_source_daytrade_ok: quoteSourceDaytradeOk,
    intraday_1m_source_daytrade_ok: intraday1mSourceDaytradeOk,
    formal_source_alignment_ok: formalSourceAlignmentOk,
    reason_code: reasonCode,
    failed_checks: failedChecks,
    discovery_warnings: discoveryWarnings,
    base_pool_eligible_symbols: priorityRows.basePoolMeta?.basePoolEligibleSymbols || motherPoolSymbols,
    base_pool_pending_symbols: priorityRows.basePoolMeta?.basePoolPendingSymbols || 0,
    base_pool_shortfall: Math.max(0, MOTHER_POOL_MIN_SYMBOLS - (priorityRows.basePoolMeta?.basePoolEligibleSymbols || motherPoolSymbols)),
    formal_priority_speed_ok: formalPrioritySpeedOk,
    full_market_speed_ok: fullMarketGateA,
    full_market_speed_blocking: false,
    mother_pool_freshness_warning: motherPoolFreshnessWarning,
    mother_pool_freshness_blocking: false,
    futopt_formal_required: false,
    futopt_scope: "daytrade_mother_pool_evidence_nonblocking_global_formal_gate",
    futopt_mother_pool_evidence_enabled: true,
    gate_speed_ok: formalPrioritySpeedOk,
    quote_speed_scope: "full_market_scorecard_nonblocking",
    formal_speed_scope: "mother_pool_complete_dynamic_scan",
    priority_gate_grade: priorityGateGrade,
    full_market_gate_grade: fullMarketGateA ? "A" : "C",
    fresh_quote_window_seconds: WINDOW_SECONDS,
    fresh_quotes_120s: freshFull.length,
    fresh_quote_coverage_120s: Number(freshQuoteCoverage.toFixed(4)),
    active_symbols: activeCount,
    quote_age_seconds: latestQuoteAge,
    priority_quote_age_p95_seconds: priorityCoverageAge,
    priority_fresh_max_quote_age_seconds: priorityFreshMaxAge,
    priority_max_quote_age_seconds: priorityMaxAge,
    priority_stale_or_missing_symbols: priorityStaleOrMissingSymbols,
    required_quote_speed_per_sec: REQUIRED_SYMBOLS_PER_SECOND,
    actual_quote_speed_per_sec: actualQuoteSpeed,
    rest_quote_speed_per_sec: restQuoteSpeed,
    websocket_quote_speed_per_sec: websocketQuoteSpeed,
    quote_speed_measurement_source: quoteTransport.startsWith("websocket_") && websocketQuoteSpeed > 0 ? "fugle_websocket" : "rest_batch",
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
    websocket_quote_speed_per_sec: webSocketStatus.streamingQuoteSpeedPerSec,
    websocket_last_message_at: webSocketStatus.lastMessageAt,
    websocket_last_message_age_seconds: webSocketStatus.lastMessageAgeSeconds,
    websocket_symbol_count: webSocketStatus.symbolCount,
    websocket_fresh_symbols_120s: webSocketStatus.freshSymbols120s,
    websocket_status_age_seconds: webSocketStatus.statusAgeSeconds,
    websocket_rest_disabled: webSocketStatus.restDisabled,
    websocket_formal_ready: offSession ? false : webSocketStatus.formalReady,
    websocket_formal_ready_reason: offSession ? "off_session_source_stopped" : webSocketStatus.formalReadyReason,
    websocket_priority_daytrade_symbols: webSocketStatus.priorityDaytradeSymbols,
    websocket_priority_file_updated_at: webSocketStatus.priorityFileUpdatedAt,
    websocket_status_updated_at: webSocketStatus.updatedAt,
    runtime_priority_source: runtimePriority.source,
    runtime_priority_updated_at: runtimePriority.updatedAt,
    daytrade_priority_symbols: runtimePriority.daytrade,
    terminal_priority_symbols: runtimePriority.terminal,
    opening_priority_symbols: runtimePriority.opening,
    strategy_priority_symbols: runtimePriority.strategyPriority,

    strategy3_priority_symbols: runtimePriority.strategy3,
    strategy4_priority_symbols: runtimePriority.strategy4,
    strategy5_priority_symbols: runtimePriority.strategy5,
    institution_priority_symbols: runtimePriority.institution,
    warrant_priority_symbols: runtimePriority.warrant,
    cb_priority_symbols: runtimePriority.cb,
    strategy_priority_bridge_status: runtimePriority.strategyPriorityBridgeStatus,
    strategy_priority_bridge_updated_at: runtimePriority.strategyPriorityBridgeUpdatedAt,
    strategy_priority_bridge_counts: runtimePriority.strategyPriorityBridgeCounts,
    strategy_priority_bridge_groups: runtimePriority.strategyPriorityBridgeGroups,
    formal_priority_strategy_chip_status: runtimePriority.formalPriorityStrategyChip.status || 'missing',
    formal_priority_strategy_chip_trade_date: runtimePriority.formalPriorityStrategyChip.tradeDate || '',
    formal_priority_strategy_chip_complete_latest_run_evidence: strategyChipCompleteLatestRun,
    formal_priority_strategy_chip_required_for_formal_entry: true,
    formal_priority_strategy_chip_blocks_formal_entry: !strategyChipCompleteLatestRun,
    formal_priority_strategy_chip_reason: strategyChipReason,
    realtime_radar_priority_symbols: runtimePriority.realtimeRadar,
    batch_size: QUOTE_BATCH_SIZE,
    batch_interval_seconds: TARGET_BATCH_INTERVAL_SECONDS,
    priority_symbols: priorityPoolSymbols,
    priority_pool_symbols: priorityPoolSymbols,
    priority_pool_min_symbols: 1,
    priority_pool_max_symbols: MOTHER_POOL_MAX_SYMBOLS,
    priority_pool_scope: "dynamic_priority_pool",
    priority_scan_pool_symbols: hotPriorityRows.length,
    priority_scan_pool_scope: "priority_pool_plus_hot_pool_plus_deep_scan_pool",
    priority_extension_symbols: priorityExtensionRows.map((row) => row.symbol),
    priority_extension_count: priorityExtensionRows.length,
    priority_extension_min_rank: DEEP_SCAN_POOL_MAX_SYMBOLS + 1,
    priority_extension_max_rank: HOT_POOL_MAX_SYMBOLS,
    priority_extension_scope: "hot_extension_plus_rotating_scan",
    formal_scope: "mother_pool_complete_dynamic_scan",
    opening_boost_active: openingBoostActive,
    opening_boost_effective: openingBoostEffective,
    opening_boost_scope: openingBoostScope,
    opening_boost_reason: openingBoostReason,
    mother_pool_rule_version: MOTHER_POOL_RULE_VERSION,
    intraday_1m_ready_min_symbols: intraday1mReadyMinSymbols,
    intraday_1m_ready_coverage_min: MIN_INTRADAY_1M_READY_COVERAGE,
    priority_intraday_1m_ready_coverage_min: MIN_PRIORITY_INTRADAY_1M_READY_COVERAGE,
    mother_pool_symbols: priorityRows.length,
    mother_pool_fresh_coverage_120s: Number(motherFreshCoverage.toFixed(4)),
    mother_pool_fresh_quotes_120s: freshMother.length,
    mother_pool_source: "dynamic_daytrade_mother_pool",
    mother_pool_source_seed_counts: priorityRows.sourceSeedCounts || {},
    mother_pool_source_seed_union: priorityRows.sourceSeedUnion || [],
    mother_pool_source_seed_updated_at: priorityRows.sourceSeedUpdatedAt || "",
    mother_pool_min_price: MOTHER_POOL_MIN_PRICE,
    mother_pool_min_turnover_rate: MOTHER_POOL_MIN_TURNOVER_RATE,
    mother_pool_turnover_rate_rejected_symbols: priorityRows.basePoolMeta?.turnoverRateRejectedSymbols || [],
    mother_pool_turnover_rate_rejected_count: (priorityRows.basePoolMeta?.turnoverRateRejectedSymbols || []).length,
    mother_pool_turnover_rate_pending_symbols: priorityRows.basePoolMeta?.turnoverRatePendingSymbols || [],
    mother_pool_turnover_rate_pending_count: (priorityRows.basePoolMeta?.turnoverRatePendingSymbols || []).length,
    mother_pool_price_floor_rejected_symbols: priorityRows.basePoolMeta?.priceFloorRejectedSymbols || [],
    mother_pool_price_floor_rejected_count: (priorityRows.basePoolMeta?.priceFloorRejectedSymbols || []).length,
    hot_pool_symbols: Math.min(HOT_POOL_MAX_SYMBOLS, priorityRows.length),
    hot_pool_min_symbols: HOT_POOL_MIN_SYMBOLS,
    hot_pool_max_symbols: HOT_POOL_MAX_SYMBOLS,
    mother_pool_capital_rows: supplementalMaps.capitalMap?.size || 0,
    mother_pool_chip_rows: supplementalMaps.chipMap?.size || 0,
    mother_pool_margin_change_rows: supplementalMaps.marginChangeMap?.size || 0,
    stock_group_contract_source: stockGroupMeta.source || "missing",
    stock_group_contract_rows: stockGroupMeta.rows || supplementalMaps.stockGroupContractMap?.size || 0,
    stock_group_contract_updated_at: stockGroupMeta.updatedAt || "",
    stock_future_initial_0846_source: "fugle_daytrade_futopt_quotes_live",
    stock_future_initial_0846_rows: stockFutureInitialRows.length,
    stock_future_initial_0846_ready_rows: stockFutureInitialRows.filter((row) => String(row.sourceStatus || "").toLowerCase() === "ready").length,
    mother_pool_rule_hit_symbols: motherPoolRuleHitSymbols,
    mother_pool_rule_hit_counts: motherRuleCounts,
    mother_pool_pool_reasons_required: true,
    mother_pool_reasonless_rows: motherPoolReasonlessRows.length,
    priority_extension_pool_symbols: priorityExtensionPoolSymbols,
    priority_extension_fresh_quote_coverage_120s: priorityExtensionPoolSymbols ? Number((priorityExtensionRows.filter((row) => row.priorityMetrics?.quoteFresh === true).length / priorityExtensionPoolSymbols).toFixed(4)) : 0,
    mother_pool_field_coverage_counts: motherFieldCoverageCounts,
    formal_daytrade_priority_limit: DEEP_SCAN_POOL_MAX_SYMBOLS,
    formal_daytrade_priority_symbols: formalPriorityPoolSymbols,
    priority_fresh_quotes_120s: freshPriority.length,
    priority_fresh_quote_coverage_120s: Number(priorityFreshCoverage.toFixed(4)),
    formal_deep_scan_symbols: formalPriorityPoolSymbols,
    formal_deep_scan_fresh_quotes_120s: freshFormalPriority.length,
    formal_deep_scan_fresh_quote_coverage_120s: Number(formalPriorityFreshCoverage.toFixed(4)),
    formal_scan_pool_symbols: formalScanPoolSymbols,
    mother_pool_fresh_quotes_120s: freshMother.length,
    mother_pool_fresh_coverage_120s: Number(motherFreshCoverage.toFixed(4)),
    mother_pool_base_pool_symbols: priorityRows.basePoolMeta?.basePoolEligibleSymbols || 0,
    mother_pool_base_pool_pending_symbols: priorityRows.basePoolMeta?.basePoolPendingSymbols || 0,
    mother_pool_base_pool_excluded_symbols: priorityRows.basePoolMeta?.basePoolExcludedSymbols || 0,
    mother_pool_base_pool_failure_counts: priorityRows.basePoolMeta?.failureCounts || {},
    mother_pool_base_pool_pending_counts: priorityRows.basePoolMeta?.pendingCounts || {},
    mother_pool_signal_candidate_symbols: priorityRows.basePoolMeta?.signalCandidateSymbols || 0,
    mother_pool_rotation_fill_symbols: priorityRows.basePoolMeta?.rotationFillSymbols || 0,
    mother_pool_quote_pending_symbols: priorityRows.basePoolMeta?.quotePendingSymbols || [],
    mother_pool_quote_stale_symbols: priorityRows.basePoolMeta?.quoteStaleSymbols || [],
    mother_pool_avg5_policy: "classification_only_avg5_never_hard_excludes",
    mother_pool_required_readback_fields: ["trade_date", "symbol", "name", "market", "price", "open_price", "previous_close", "change_percent", "total_volume", "trade_value", "avg5_volume", "relative_volume_ratio", "volume_rank", "trade_value_rank", "ma3_turn_up", "ma5_turn_up", "ma10_turn_up", "ma30_turn_up", "ma58_turn_up", "ma_bull_stack_short", "ma_bull_stack_mid", "above_ma30", "above_ma58", "opening_range_break", "surge_flag", "volume_spike_flag", "strategy_source_flags", "sector_name", "sector_strength_score", "liquidity_grade", "mother_pool_score", "entry_score", "upgrade_score", "matched_case_patterns", "upgrade_reasons", "hot_burst_valid_seconds", "hot_burst_cooldown_seconds", "hot_burst_triggered_at", "hot_extension_rank", "mother_pool_rank", "pool_reasons", "source_name", "updated_at"],
    priority_source_injecting: prioritySourceInjecting,
    priority_min_injecting_quotes: MIN_PRIORITY_INJECTING_QUOTES,
    priority_fresh_quote_coverage_target_120s: MIN_PRIORITY_FRESH_COVERAGE,
    selected_symbols_fresh_ok: selectedSymbolsFreshOk,
    eligible_quote_rows: freshFull.length,
    quotes: quoteRows,
    quote_count: quoteRows,
    quote_rows: quoteRows,
    last_quote_at: lastQuoteAt,
    quote_status: quoteStatus,
    preopen_status: preopenStatus,
    preopen_symbols: freshPriority.length,
    preopen_coverage: Number(priorityFreshCoverage.toFixed(4)),
    scanner_can_run_opening: scannerCanRunOpening,
    scanner_can_run_preopen: scannerCanRunPreopen,
    scanner_can_run_intraday: scannerCanRunIntraday,
    scanner_can_run_quote_only: scannerCanRunQuoteOnly,
    daily_volume_status: dailyVolumeStatus,
    daily_volume_rows: dailyVolumeMap.size,
    daily_volume_source: dailyVolumeMap.source || "unknown",
    avg_volume5_eligible: avgVolume5Eligible,
    avg_volume5_coverage: Number(dailyVolumeCoverage.toFixed(4)),
    historical_1m_warmup_status: historical1mWarmupStatus,
    today_1m_status: today1mStatus,
    intraday_1m_status: today1mStatus,
    ma3_warmup_status: readyMa3 >= Math.max(1, Math.min(priorityPoolSymbols || 1, minFormalPrioritySymbols)) ? "ready" : readyMa3 > 0 ? "degraded" : "empty",
    ma20_warmup_status: ma20WarmupStatus,
    ma35_warmup_status: ma35WarmupStatus,
    ma58_warmup_status: readyMa58 >= Math.max(1, Math.min(priorityPoolSymbols || 1, minFormalPrioritySymbols)) ? "ready" : readyMa58 > 0 ? "degraded" : "empty",
    ready_ma3: readyMa3,
    ready_ma20_continuous: readyMa20,
    ready_ma35_continuous: readyMa35,
    ready_ma58: readyMa58,
    ready_ma20_required: effectiveMa20Required,
    ready_ma35_required: effectiveMa35Required,
    indicator_set: ["MA3", "MA5", "MA10", "MA20", "MA30", "MA35", "MA58", "KD", "MACD", "RSI"],
    preopen_today_1m_required_before_formal: false,
    intraday_1m_stale_seconds: intraday1mStaleSeconds,
    latest_candle_time: latestCandleTime,
    today_candle_count: today1mRows,
    ready_ge_35_symbols: readyMa35,
    ready_ge_35: readyMa35,
    ready_ma35_continuous_symbols: readyMa35,
    intraday_1m_ready_symbols: formalScanIntraday1mReadySymbols,
    deep_scan_pool_symbols: deepScanPoolSymbols,
    formal_scan_pool_symbols: formalScanPoolSymbols,
    formal_scan_intraday_1m_ready_symbols: formalScanIntraday1mReadySymbols,
    formal_scan_intraday_1m_ready_coverage: Number(formalScanIntraday1mReadyCoverage.toFixed(4)),
    formal_scan_intraday_1m_fresh_max_age_seconds: deepScanIntraday1mFreshMaxAgeSeconds,
    formal_scan_intraday_1m_data_gap_count: deepScanIntraday1mDataGapSymbols.length,
    formal_scan_intraday_1m_data_gap_symbols: deepScanIntraday1mDataGapSymbols,
    formal_scan_intraday_1m_data_gap_status: deepScanIntraday1mDataGapSymbols.length ? 'DATA_GAP' : 'ready',
    deep_scan_intraday_1m_stale_seconds: deepScanIntraday1mStaleSeconds,
    mother_pool_intraday_1m_ready_symbols: intraday1mReadySymbols,
    intraday_1m_ready_coverage: Number(intraday1mReadyCoverage.toFixed(4)),
    priority_intraday_1m_ready_symbols: priorityIntraday1mReadySymbols,
    priority_intraday_1m_ready_coverage: Number(priorityIntraday1mReadyCoverage.toFixed(4)),
    intraday_1m_coverage_gate_ready: intraday1mCoverageGateReady,
    intraday_1m_coverage_status: intraday1mReadyCoverage >= 0.95 ? "ready" : intraday1mReadyCoverage >= 0.85 ? "degraded_ready" : "not_ready",
    today_1m_symbols: today1mSymbols,
    today_1m_rows: today1mRows,
    futopt_stock_mapped: futoptMapped,
    futopt_gate_status: futoptGateReady ? 'ready' : 'not_ready',
    futopt_txf_ok: futoptTxfOk,
    txf_ok: futoptTxfOk,
    futopt_ready_rows: futoptReadyRows,
    futopt_stale_rows: futoptStaleRows,
    futopt_contract_rows: futoptContractRows,
    futopt_reason: futoptReason,
    futopt_source_status: futoptGateReady ? "ready" : (futoptContractRows > 0 ? "degraded" : "missing"),
    latest_futopt_updated_at: latestFutoptUpdatedAt,
    latest_txf_updated_at: latestTxfUpdatedAt,
    futopt_cache_count: futoptRows.cacheCount || websocketFutoptSync.cacheCount || 0,
    intraday_1m_readiness_source: intraday1mReadinessSource,
    opening_0901_candle_required: opening0901Required,
    opening_0901_candle_hard_required: opening0901HardRequired,
    opening_0901_candle_gate_ok: opening0901GateOk,
    opening_0901_candle_ready: opening0901Ready,
    opening_0901_candle_trade_date: opening0901Evidence.tradeDate || taipeiDate(),
    opening_0901_candle_rows: numberValue(opening0901Evidence.rows),
    opening_0901_candle_symbols: opening0901Evidence.symbols || [],
    opening_0901_candle_required_symbols: opening0901Evidence.requiredSymbolCount || 0,
    opening_0901_candle_missing_symbols: opening0901Evidence.missingSymbols || [],
    opening_0901_candle_source: opening0901Evidence.source || "not_checked",
    opening_0901_candle_rows_written: numberValue(opening0901Evidence.fallbackWritten),
    opening_0901_candle_schema: opening0901Evidence.schema || [],
    natural_0900_warmup_evidence_source: intradayMap.warmupEvidenceSource || "",
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
    warmup_start_taipei: "07:00",
    warmup_data_fill_active: warmupDataFillActive,
    off_session: offSession,
    formal_entry_allowed: !offSession && after0845 && gateGrade === "A" && webSocketStatus.formalReady,
    latest_update_allowed: !offSession && after0845 && gateGrade === "A" && webSocketStatus.formalReady,
    preserve_previous_good: offSession || gateGrade !== "A",
    apply_mode: APPLY,
    fetch_enabled: FETCH_ENABLED,
    quote_fetch_allowed_for_phase: warmupDataFillActive && quoteFetchAllowedForPhase(phase),
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
    && values.quoteAgeSeconds <= MAX_QUOTE_AGE_SECONDS
    && values.cooldownRemaining <= 0
    && values.last429AgeSeconds > RECENT_429_BLOCK_SECONDS
    && (!values.after0830 || values.dailyVolumeStatus === "ready")
    && (!values.after0845 || values.scannerCanRunOpening)
    && (!values.after0845 || values.strategyChipCompleteLatestRun)
    && (!values.after0845 || values.readyMa20 >= (values.effectiveMa20Required || MIN_READY_MA20_CONTINUOUS))
    && (!values.after0845 || !REQUIRE_MA35_FOR_FORMAL_DAYTRADE || values.readyMa35 >= (values.effectiveMa35Required || MIN_READY_MA35_CONTINUOUS))
    && (!values.after0900 || values.intraday1mReadyCoverage >= MIN_INTRADAY_1M_READY_COVERAGE)
    && (!values.after0900 || values.intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);
}

function poolLayerForRank(rank) {
  const normalizedRank = numberValue(rank, 0);
  if (!normalizedRank) return "outside_pool";
  if (normalizedRank <= HOT_POOL_MAX_SYMBOLS) return "hot_pool";
  return "priority_pool";
}

function updateMotherPoolDelta(result) {
  const priorityRows = Array.isArray(result?.priorityRows) ? result.priorityRows : [];
  const payload = result?.payload || {};
  const tradeDate = taipeiDate();
  const checkedAt = nowIso();
  const runId = String(WRITER_INSTANCE_ID || SOURCE_NAME) + ":" + compactDateKey(tradeDate) + ":" + Date.now();
  const previousPayload = readJson(MOTHER_POOL_DELTA_STATE_FILE, {});
  const previous = new Map((Array.isArray(previousPayload.rows) ? previousPayload.rows : []).map((row) => [
    normalizeCode(row.symbol),
    {
      symbol: normalizeCode(row.symbol),
      name: row.name || normalizeCode(row.symbol),
      rank: numberValue(row.rank),
      score: numberValue(row.entry_score ?? row.score),
      entry_score: numberValue(row.entry_score ?? row.score),
      upgrade_score: numberValue(row.upgrade_score),
      pool_layer: row.pool_layer || poolLayerForRank(row.rank),
      score_history: Array.isArray(row.score_history) ? row.score_history : [],
      first_seen_at: row.first_seen_at || "",
    },
  ]).filter(([symbol]) => symbol));

  const current = new Map(priorityRows.map((row, index) => {
    const symbol = normalizeCode(row.symbol);
    const rank = index + 1;
    const prior = previous.get(symbol);
    return [
      symbol,
      {
        symbol,
        name: row.name || symbol,
        rank,
        score: numberValue(row.entryScore ?? row.score),
        entry_score: numberValue(row.entryScore ?? row.score),
        upgrade_score: numberValue(row.upgradeScore),
        pool_layer: poolLayerForRank(rank),
        deep_scan_eligible: index < HOT_POOL_MAX_SYMBOLS || (row.sourceFlags || []).some((source) => /manual_watchlist|user_watchlist/i.test(String(source))) || row.userCaseSeedMatched === true || row.userCaseLearningActive === true || row.hotBurstFastPath === true || row.priorityMetrics?.surgeFlag === true || row.priorityMetrics?.volumeSpikeFlag === true || row.priorityMetrics?.trackedBuyPointActive === true,
        score_history: [],
        first_seen_at: prior?.first_seen_at || checkedAt,
        pool_reasons: Array.isArray(row.poolReasons) ? row.poolReasons : [],
        priority_reason: row.priorityReason || "",
        priority_metrics: row.priorityMetrics || {},
        source_flags: row.sourceFlags || [],
      },
    ];
  }).filter(([symbol]) => symbol));

  const added = [...current.values()].filter((row) => !previous.has(row.symbol));
  const removed = [...previous.values()].filter((row) => !current.has(row.symbol));
  const upgraded = [...current.values()].filter((row) => {
    const prior = previous.get(row.symbol);
    return prior && prior.rank > DEEP_SCAN_POOL_MAX_SYMBOLS && row.rank <= DEEP_SCAN_POOL_MAX_SYMBOLS;
  });
  const downgraded = [
    ...[...current.values()].filter((row) => {
      const prior = previous.get(row.symbol);
      return prior && prior.rank > 0 && prior.rank <= DEEP_SCAN_POOL_MAX_SYMBOLS && row.rank > DEEP_SCAN_POOL_MAX_SYMBOLS;
    }),
    ...removed.filter((row) => row.rank > 0 && row.rank <= DEEP_SCAN_POOL_MAX_SYMBOLS).map((row) => ({
      ...row,
      rank: null,
      pool_layer: "outside_pool",
      priority_metrics: row.priority_metrics || {},
    })),
  ];
  const upgradedAt = checkedAt;
  const upgradeRows = upgraded.map((row) => {
    const prior = previous.get(row.symbol) || {};
    const metrics = row.priority_metrics || {};
    return {
      symbol: row.symbol,
      name: row.name,
      trade_date: tradeDate,
      old_pool_layer: prior.pool_layer || poolLayerForRank(prior.rank),
      new_pool_layer: row.pool_layer,
      upgraded_at: upgradedAt,
      upgrade_reason: row.priority_reason || row.pool_reasons?.join("+") || "priority_score_upgrade",
      old_rank: prior.rank || null,
      new_rank: row.rank,
      score_before: numberValue(prior.entry_score ?? prior.score),
      score_after: numberValue(row.entry_score ?? row.score),
      quote_age_seconds: metrics.quoteAgeSeconds ?? null,
      latest_1m_time: metrics.latestCandleTime || "",
      data_gap_reason: metrics.dataGap?.data_gap_reason || metrics.dataGap?.status || "OK",
      entry_score: numberValue(row.entry_score ?? row.score),
      upgrade_score: numberValue(row.upgrade_score),
      hot_burst_fast_path: row.priority_metrics?.hotBurstFastPath === true,
      user_case_learning_active: row.priority_metrics?.userCaseLearningActive === true,
      run_id: runId,
    };
  });
  const downgradeRows = downgraded.map((row) => {
    const prior = previous.get(row.symbol) || row;
    const metrics = row.priority_metrics || {};
    return {
      symbol: row.symbol,
      name: row.name || row.symbol,
      trade_date: tradeDate,
      old_pool_layer: prior.pool_layer || poolLayerForRank(prior.rank),
      new_pool_layer: row.pool_layer || "outside_pool",
      old_rank: prior.rank || null,
      new_rank: row.rank || null,
      downgrade_reason: row.priority_reason || (row.pool_reasons || []).join("+") || "priority_score_downgrade",
      data_gap_reason: metrics.dataGap?.data_gap_reason || metrics.dataGap?.status || "OK",
      quote_age_seconds: metrics.quoteAgeSeconds ?? null,
      latest_1m_time: metrics.latestCandleTime || "",
      downgraded_at: checkedAt,
      run_id: runId,
    };
  });

  let upgradeReceiptPath = "";
  let downgradeReceiptPath = "";
  if (!DRY_RUN && upgradeRows.length > 0) {
    const receiptDir = runtimePath("data", "scan-receipts");
    fs.mkdirSync(receiptDir, { recursive: true });
    upgradeReceiptPath = path.join(receiptDir, "daytrade-mother-pool-upgrade-" + compactDateKey(tradeDate) + "-" + Date.now() + ".json");
    writeJson(upgradeReceiptPath, {
      contract: "daytrade-mother-pool-upgrade-receipt-v2",
      source_name: SOURCE_NAME,
      trade_date: tradeDate,
      run_id: runId,
      upgraded_at: upgradedAt,
      upgrades: upgradeRows,
    });
  }
  if (!DRY_RUN && downgradeRows.length > 0) {
    const receiptDir = runtimePath("data", "scan-receipts");
    fs.mkdirSync(receiptDir, { recursive: true });
    downgradeReceiptPath = path.join(receiptDir, "daytrade-mother-pool-downgrade-" + compactDateKey(tradeDate) + "-" + Date.now() + ".json");
    writeJson(downgradeReceiptPath, {
      contract: "daytrade-mother-pool-downgrade-receipt-v1",
      source_name: SOURCE_NAME,
      trade_date: tradeDate,
      run_id: runId,
      downgraded_at: checkedAt,
      downgrades: downgradeRows,
    });
  }

  const topReasonCounts = {};
  const dataGapCounts = {};
  for (const row of current.values()) {
    for (const reason of row.pool_reasons || []) topReasonCounts[reason] = (topReasonCounts[reason] || 0) + 1;
    const gap = String(row.priority_metrics?.dataGap?.status || "OK").toUpperCase();
    dataGapCounts[gap] = (dataGapCounts[gap] || 0) + 1;
  }
  const latest1mTimes = [...current.values()]
    .map((row) => row.priority_metrics?.latestCandleTime || "")
    .filter(Boolean)
    .sort();
  const userWatchlistRows = [...current.values()].filter((row) => (row.source_flags || []).some((source) => /manual_watchlist|user_watchlist/i.test(String(source))));
  const targetSymbolDiagnostics = DIAGNOSTIC_SYMBOLS.map((symbol) => {
    const row = current.get(symbol);
    const prior = previous.get(symbol);
    const upgrade = upgradeRows.find((item) => item.symbol === symbol) || null;
    const downgrade = downgradeRows.find((item) => item.symbol === symbol) || null;
    const gap = row?.priority_metrics?.dataGap || {};
    const candleCount = numberValue(gap.candle_count);
    return {
      symbol,
      name: row?.name || prior?.name || symbol,
      trade_date: tradeDate,
      entered_at: row?.first_seen_at || null,
      in_mother_pool: Boolean(row),
      pool_layer: row?.pool_layer || "outside_pool",
      mother_pool_rank: row?.rank ?? null,
      priority_rank: row && row.rank <= DEEP_SCAN_POOL_MAX_SYMBOLS ? row.rank : null,
      pool_reasons: row?.pool_reasons || [],
      upgraded_to_priority: Boolean(upgrade),
      has_upgrade_receipt: Boolean(upgradeReceiptPath && upgrade),
      upgrade_receipt_path: upgrade ? upgradeReceiptPath : "",
      downgraded: Boolean(downgrade),
      has_1m: candleCount > 0 || Boolean(gap.first_candle_time || gap.last_candle_time),
      data_gap_reason: String(gap.data_gap_reason || gap.status || "NO_1M").toUpperCase(),
      candle_count: candleCount,
      first_candle_time: gap.first_candle_time || "",
      last_candle_time: gap.last_candle_time || "",
      missing_window: gap.missing_window || "",
      intraday_1m_stale_seconds: numberValue(gap.intraday_1m_stale_seconds, 999999),
      has_required_1m_window: gap.has_required_1m_window === true,
      latest_1m_time: row?.priority_metrics?.latestCandleTime || "",
      quote_age_seconds: row?.priority_metrics?.quoteAgeSeconds ?? null,
      formal_gate_blocked: payload.formal_entry_allowed !== true,
      blocked_reason: payload.formal_entry_allowed === true ? "" : payload.reason_code || payload.gate_status || "formal_gate_not_ready",
    };
  });
  const roundSummary = {
    trade_date: tradeDate,
    checked_at: checkedAt,
    run_id: runId,
    mother_pool_rows: current.size,
    priority_pool_rows: current.size,
    hot_pool_rows: [...current.values()].filter((row) => row.rank <= HOT_POOL_MAX_SYMBOLS).length,
    deep_scan_pool_rows: [...current.values()].filter((row) => row.deep_scan_eligible === true).length,
    session_ready_count: numberValue(payload.ready_ma20_continuous ?? payload.today_1m_symbols, 0),
    data_gap_count: Object.entries(dataGapCounts).filter(([reason]) => reason !== "OK").reduce((sum, [, count]) => sum + count, 0),
    formal_deep_scan_rows: [...current.values()].filter((row) => row.rank <= DEEP_SCAN_POOL_MAX_SYMBOLS).length,
    hot_pool_extension_rows: [...current.values()].filter((row) => row.rank > DEEP_SCAN_POOL_MAX_SYMBOLS && row.rank <= HOT_POOL_MAX_SYMBOLS).length,
    rotating_scan_rows: [...current.values()].filter((row) => row.rank > HOT_POOL_MAX_SYMBOLS).length,
    new_added_count: added.length,
    removed_count: removed.length,
    upgraded_to_priority_count: upgraded.length,
    downgraded_count: downgraded.length,
    reasonless_rows: [...current.values()].filter((row) => !row.pool_reasons.length).length,
    top_reason_counts: topReasonCounts,
    data_gap_counts: dataGapCounts,
    user_watchlist_quota: 10,
    user_watchlist_quota_symbols: userWatchlistRows.length,
    source_status: payload.source_status || result?.status || "",
    quote_age_seconds: numberValue(payload.quote_age_seconds, 999999),
    latest_1m_time: latest1mTimes.length ? latest1mTimes[latest1mTimes.length - 1] : "",
    intraday_1m_stale_seconds: numberValue(payload.intraday_1m_stale_seconds, 999999),
  };

  if (!DRY_RUN) writeJson(MOTHER_POOL_DELTA_STATE_FILE, {
    source_name: SOURCE_NAME,
    trade_date: tradeDate,
    updated_at: checkedAt,
    run_id: runId,
    rows: [...current.values()].map((row) => {
      const previousRow = previous.get(row.symbol) || {};
      const history = [...(Array.isArray(previousRow.score_history) ? previousRow.score_history : []), row.entry_score]
        .filter((value) => Number.isFinite(Number(value)))
        .slice(-3);
      return {
        symbol: row.symbol,
        name: row.name,
        rank: row.rank,
        pool_layer: row.pool_layer,
        score: row.entry_score,
        entry_score: row.entry_score,
        upgrade_score: row.upgrade_score,
        score_history: history,
        first_seen_at: row.first_seen_at,
      };
    }),
    upgrade_receipt_path: upgradeReceiptPath,
    upgrade_receipt: upgradeReceiptPath ? { contract: "daytrade-mother-pool-upgrade-receipt-v2", run_id: runId, upgraded_at: upgradedAt, upgrades: upgradeRows } : null,
    downgrade_receipt_path: downgradeReceiptPath,
    downgrade_receipt: downgradeReceiptPath ? { contract: "daytrade-mother-pool-downgrade-receipt-v1", run_id: runId, downgraded_at: checkedAt, downgrades: downgradeRows } : null,
    round_summary: roundSummary,
    target_symbol_diagnostics: targetSymbolDiagnostics,
  });
  return {
    previous_count: previous.size,
    current_count: current.size,
    added_count: added.length,
    added_symbols: added.map((row) => row.symbol),
    removed_count: removed.length,
    removed_symbols: removed.map((row) => row.symbol),
    upgraded_to_priority_count: upgraded.length,
    upgraded_to_priority_symbols: upgraded.map((row) => row.symbol),
    upgraded_to_priority_receipts: upgradeRows,
    upgrade_receipt_path: upgradeReceiptPath,
    upgrade_receipt: upgradeReceiptPath ? { contract: "daytrade-mother-pool-upgrade-receipt-v2", run_id: runId, upgraded_at: upgradedAt, upgrades: upgradeRows } : null,
    downgraded_count: downgraded.length,
    downgraded_symbols: downgraded.map((row) => row.symbol),
    downgraded_receipts: downgradeRows,
    downgrade_receipt_path: downgradeReceiptPath,
    downgrade_receipt: downgradeReceiptPath ? { contract: "daytrade-mother-pool-downgrade-receipt-v1", run_id: runId, downgraded_at: checkedAt, downgrades: downgradeRows } : null,
    round_summary: roundSummary,
    target_symbol_diagnostics: targetSymbolDiagnostics,
  };
}async function writeStatusAndScorecard(result) {
  const motherPoolDelta = updateMotherPoolDelta(result);
  result.payload.mother_pool_delta = motherPoolDelta;
  result.payload.mother_pool_round_summary = motherPoolDelta.round_summary;
  result.payload.target_symbol_diagnostics = motherPoolDelta.target_symbol_diagnostics;
  await ensureWriterLease();
  const nonFatalWriteErrors = result.payload.nonfatal_write_errors || [];
  result.payload.source_host_id = SOURCE_HOST_ID;
  result.payload.source_host_role = SOURCE_HOST_ROLE;
  result.payload.writer_instance_id = WRITER_INSTANCE_ID;
  result.payload.writer_lease_required = WRITER_LEASE_REQUIRED;
  result.payload.writer_lease_status = writerLease.status;
  result.payload.writer_heartbeat_at = writerLease.heartbeatAt || nowIso();
  result.payload.writer_lease_expires_at = writerLease.leaseExpiresAt || null;
  result.payload.source_authority = "dedicated_daytrade_source_host";
  result.payload.reader_policy = "supabase_read_only_no_writer_no_fugle_fallback";
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

async function writeEnrichmentPendingHeartbeat({ activeSymbols, priorityRows, quoteMap, dailyVolumeMap, state, errors = [] }) {
  if (!APPLY || !priorityRows.length) return;
  // Enrichment is an in-progress writer phase, not a new source verdict. Do
  // not overwrite the authoritative source_status with an empty 1m/futopt
  // payload while the full tick is still reading and writing its contracts.
  // Otherwise the watchdog observes a false degraded/empty interval between
  // every completed A result and the next completed tick.
  writeJson(ENRICHMENT_PENDING_STATE_FILE, {
    evidence_type: "daytrade_source_enrichment_pending_non_authoritative",
    source_name: SOURCE_NAME,
    checked_at: nowIso(),
    trade_date: taipeiDate(),
    writer_enrichment_pending: true,
    writer_enrichment_pending_reason: "slow_enrichment_pending",
    authoritative_source_status_preserved: true,
    formal_entry_allowed: null,
    latest_update_allowed: false,
    preserve_previous_good: true,
    priority_pool_symbols: priorityRows.length,
    priority_fresh_quotes_120s: priorityRows.filter((row) => ageSeconds(quoteFreshnessTime(quoteMap.get(normalizeCode(row.symbol)))) <= WINDOW_SECONDS).length,
    active_symbols: activeSymbols.length,
    daily_volume_rows: dailyVolumeMap.size,
    state_updated_at: state.updatedAt || "",
    nonfatal_write_errors: errors,
  });
}async function syncDailyVolumeMirror(dailyVolumeMap, activeSymbols) {
  if (DRY_RUN) return { written: 0, skipped: true, reason: 'dry_run' };
  const now = Date.now();
  if (now - lastDailyVolumeMirrorSyncAt < DAILY_VOLUME_MIRROR_SYNC_INTERVAL_MS) {
    return { written: 0, skipped: true, reason: 'interval_cooldown' };
  }
  const activeSet = new Set((activeSymbols || []).map((row) => normalizeCode(row.symbol || row)).filter(Boolean));
  const rows = [...dailyVolumeMap.entries()]
    .filter(([symbol]) => activeSet.has(symbol))
    .map(([symbol, row]) => ({
      symbol,
      market: row.market || '',
      trade_date: row.trade_date,
      volume: row.volume,
      avg_volume5: row.avg_volume5,
      avg5_volume: row.avg_volume5,
      daily_volume_status: row.avg_volume5 > 0 ? 'ready' : 'missing',
      updated_at: row.updated_at || nowIso(),
      source: 'fugle_daytrade_writer:daily_volume_avg_full_market_mirror',
      payload: {
        ...(row.payload || {}),
        source: 'fugle_daytrade_writer:daily_volume_avg_full_market_mirror',
        activeOrdinaryStockUniverse: true,
      },
    }));
  if (!rows.length) return { written: 0, skipped: true, reason: 'no_active_volume_rows' };
  const result = await supabaseUpsert('fugle_daytrade_daily_volume_avg', rows, 'symbol', { batchSize: 250 });
  lastDailyVolumeMirrorSyncAt = now;
  return { written: result.written || 0, skipped: false, rows: rows.length, source: 'full_market_active_ordinary_stock' };
}
async function ensureOpening0901CandleEvidence(formalPriorityRows = []) {
  const tradeDate = taipeiDate();
  const requiredSymbols = [...new Set((formalPriorityRows || []).slice(0, DEEP_SCAN_POOL_MAX_SYMBOLS)
    .map((row) => normalizeCode(row.symbol)).filter(Boolean))];
  const schema = ["symbol", "trade_date", "candle_time", "open", "high", "low", "close", "volume", "updated_at", "payload"];
  const required = taipeiMinutes() >= (9 * 60 + 2);
  const base = { required, tradeDate, requiredSymbols, requiredSymbolCount: requiredSymbols.length, schema };
  if (!required) return { ...base, ready: true, source: "not_required_before_0902", rows: 0, symbols: [], missingSymbols: [] };
  if (!requiredSymbols.length) return { ...base, ready: false, source: "dedicated_daytrade_1m_0901_empty_formal_pool", rows: 0, symbols: [], missingSymbols: [] };
  const start = `${tradeDate}T01:01:00.000Z`;
  const end = `${tradeDate}T01:02:00.000Z`;
  const bySymbol = new Map();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_intraday_1m",
      "select=symbol,market,trade_date,candle_time,open,high,low,close,volume,updated_at,payload"
        + "&trade_date=eq." + encodeURIComponent(tradeDate)
        + "&candle_time=gte." + encodeURIComponent(start)
        + "&candle_time=lt." + encodeURIComponent(end)
        + "&symbol=in.(" + requiredSymbols.join(",") + ")",
      { service: true, pageSize: 1000 },
    );
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const symbol = normalizeCode(row.symbol);
      if (!requiredSymbols.includes(symbol) || !numberValue(row.close)) continue;
      bySymbol.set(symbol, { ...row, symbol, trade_date: tradeDate, payload: { ...(row.payload || {}), opening0901: true, source: row.source || "fugle_daytrade_intraday_1m" } });
    }
  } catch (error) {
    return { ...base, ready: false, source: "dedicated_daytrade_1m_0901_read_failed", rows: 0, symbols: [], missingSymbols: requiredSymbols, error: error?.message || String(error) };
  }

  let fallbackWritten = 0;
  const fallbackRows = [];
  const cache = readFugleWebSocketCandles({ maxAgeMs: 2 * 60 * 60 * 1000 });
  for (const candle of cache.candles.values()) {
    const symbol = normalizeCode(candle.symbol || candle.code);
    const candleTime = normalizeTimestamp(candle.candleTime || candle.date);
    if (!requiredSymbols.includes(symbol) || !candleTime || taipeiDateFrom(candleTime) !== tradeDate) continue;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(candleTime));
    const hhmm = `${parts.find((part) => part.type === "hour")?.value || ""}:${parts.find((part) => part.type === "minute")?.value || ""}`;
    if (hhmm !== "09:01" || bySymbol.has(symbol) || !numberValue(candle.close)) continue;
    fallbackRows.push({
      symbol,
      market: candle.market || "",
      trade_date: tradeDate,
      candle_time: candleTime,
      open: numberValue(candle.open),
      high: numberValue(candle.high),
      low: numberValue(candle.low),
      close: numberValue(candle.close),
      volume: numberValue(candle.volume),
      updated_at: candle.candleSeenAt || cache.payload?.updatedAt || nowIso(),
      source: "fugle_daytrade_writer:websocket_candle_0901",
      payload: { ...(candle.payload || {}), opening0901: true, fallback: true, source: "fugle-daytrade-writer:websocket-candle-0901" },
    });
    bySymbol.set(symbol, fallbackRows[fallbackRows.length - 1]);
  }
  if (fallbackRows.length) {
    try {
      const result = await supabaseUpsert("fugle_daytrade_intraday_1m", fallbackRows, "symbol,candle_time", { batchSize: 40 });
      fallbackWritten = result.written || 0;
    } catch (error) {
      return { ...base, ready: false, source: "dedicated_daytrade_1m_0901_fallback_write_failed", rows: bySymbol.size, symbols: [...bySymbol.keys()], missingSymbols: requiredSymbols.filter((symbol) => !bySymbol.has(symbol)), fallbackRows: fallbackRows.length, error: error?.message || String(error) };
    }
  }
  const symbols = [...bySymbol.keys()];
  const missingSymbols = requiredSymbols.filter((symbol) => !bySymbol.has(symbol));
  return {
    ...base,
    ready: missingSymbols.length === 0,
    source: fallbackRows.length ? "dedicated_daytrade_1m_0901+websocket_candle_fallback" : "dedicated_daytrade_1m_0901",
    rows: bySymbol.size,
    symbols,
    missingSymbols,
    fallbackRows: fallbackRows.length,
    fallbackWritten,
  };
}

async function syncWebSocketIntraday1mCandles(motherPoolRows, state, options = {}) {
  const extraSymbols = Array.isArray(options.extraSymbols) ? options.extraSymbols : [];
  const tradeDate = taipeiDateFrom(nowIso());
  const priorityArtifact = readJson(PRIORITY_SYMBOLS_FILE, {});
  const artifactDate = taipeiDateFrom(priorityArtifact.updatedAt || priorityArtifact.tradeDate || '');
  const artifactMotherPool = artifactDate === tradeDate
    ? (priorityArtifact.daytradeMotherPoolSymbols || priorityArtifact.daytradePrioritySymbols || [])
    : [];
  const motherPoolSymbols = [...new Set([
    ...(motherPoolRows || []).map((row) => normalizeCode(row.symbol || row)),
    ...extraSymbols.map((symbol) => normalizeCode(symbol)),
    ...artifactMotherPool.map((symbol) => normalizeCode(symbol)),
  ].filter(Boolean))].sort();
  const cache = readFugleWebSocketCandles({ maxAgeMs: WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS });
  const allowedSymbols = new Set(motherPoolSymbols);
  const bySymbol = new Map();
  for (const candle of cache.candles.values()) {
    const symbol = normalizeCode(candle.symbol || candle.code);
    const candleTime = normalizeTimestamp(candle.candleTime || candle.date);
    if (!symbol || !allowedSymbols.has(symbol) || !candleTime || !numberValue(candle.close)) continue;
    if (taipeiDateFrom(candleTime) !== tradeDate) continue;
    const row = {
      symbol, market: candle.market || '', candle_time: candleTime,
      trade_date: candle.tradeDate || taipeiDateFrom(candleTime),
      open: numberValue(candle.open), high: numberValue(candle.high), low: numberValue(candle.low),
      close: numberValue(candle.close), volume: numberValue(candle.volume),
      source: 'fugle_daytrade_writer:websocket_candles',
      updated_at: candle.candleSeenAt || cache.payload?.updatedAt || nowIso(),
      payload: { ...(candle.payload || {}), cacheUpdatedAt: cache.payload?.updatedAt || '', source: 'fugle-websocket-candles-cache' },
    };
    const rows = bySymbol.get(symbol) || [];
    rows.push(row);
    bySymbol.set(symbol, rows);
  }
  if (!bySymbol.size) return {
    written: 0,
    skipped: true,
    cacheCount: cache.candles.size,
    source: 'fugle_websocket_candles_dynamic_mother_pool',
    reason: 'no_today_mother_pool_candles',
    motherPoolSymbols: motherPoolSymbols.length,
  };

  const selected = new Map();
  const selectRow = (row) => selected.set(`${row.symbol}|${row.candle_time}`, row);
  const priorMirror = state?.daytradeMotherPoolCandleMirror?.tradeDate === tradeDate
    ? state.daytradeMotherPoolCandleMirror
    : { tradeDate, symbols: {} };
  const nextMirror = { tradeDate, symbols: { ...(priorMirror.symbols || {}) } };
  let seededSymbols = 0;
  let incrementalRows = 0;
  let notReadySymbols = 0;

  for (const [symbol, rows] of bySymbol.entries()) {
    rows.sort((a, b) => Date.parse(b.candle_time) - Date.parse(a.candle_time));
    if (rows[0]) selectRow(rows[0]);
    const prior = nextMirror.symbols[symbol] || {};
    const latestCandleTime = rows[0]?.candle_time || '';
    if (prior.seeded !== true) {
      for (const row of rows.slice(0, INTRADAY_MIRROR_BARS_PER_SYMBOL)) selectRow(row);
      const ready = rows.length >= INTRADAY_MIRROR_BARS_PER_SYMBOL;
      if (ready) seededSymbols += 1;
      else notReadySymbols += 1;
      nextMirror.symbols[symbol] = { seeded: ready, lastCandleTime: latestCandleTime, availableCandleCount: rows.length };
      continue;
    }
    const priorTime = Date.parse(prior.lastCandleTime || '');
    const newRows = rows.filter((row) => !Number.isFinite(priorTime) || Date.parse(row.candle_time) > priorTime);
    for (const row of newRows) selectRow(row);
    incrementalRows += newRows.length;
    nextMirror.symbols[symbol] = { seeded: true, lastCandleTime: latestCandleTime, availableCandleCount: rows.length };
  }

  const rows = [...selected.values()];
  await supabaseUpsert('fugle_daytrade_intraday_1m', rows, 'symbol,candle_time', { batchSize: 500, timeoutMs: 15000, retries: 1 });
  if (state && !DRY_RUN) state.daytradeMotherPoolCandleMirror = nextMirror;
  return {
    written: rows.length,
    skipped: false,
    cacheCount: cache.candles.size,
    source: 'fugle_websocket_candles_full_dynamic_mother_pool',
    latestRows: bySymbol.size,
    motherPoolSymbols: motherPoolSymbols.length,
    seededSymbols,
    incrementalRows,
    notReadySymbols,
  };
}
async function syncWebSocketFutoptQuotes() {
  const cache = readFugleFutoptWebSocketQuotes({ maxAgeMs: FUTOPT_WEBSOCKET_MAX_AGE_MS });
  const rows = [];
  let stockRows = 0;
  let txfRows = 0;
  for (const quote of cache.quotes.values()) {
    const futureSymbol = String(quote.future_symbol || "").trim().toUpperCase();
    if (!futureSymbol) continue;
    const price = numberValue(quote.last_price ?? quote.price);
    if (!price) continue;
    const underlyingSymbol = normalizeCode(quote.underlying_symbol) || (futureSymbol.startsWith("TXF") ? "TXF" : null);
    if (/^\d{4}$/.test(String(underlyingSymbol || ""))) stockRows += 1;
    else if (underlyingSymbol === "TXF" || futureSymbol.startsWith("TXF")) txfRows += 1;
    rows.push({
      future_symbol: futureSymbol,
      underlying_symbol: underlyingSymbol,
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
  if (!rows.length) {
    return { written: 0, skipped: true, cacheCount: cache.quotes.size, stockRows: 0, txfRows: 0 };
  }
  await supabaseUpsert("fugle_daytrade_futopt_quotes_live", rows, "future_symbol", { batchSize: 40, timeoutMs: 30000, retries: 1, retryDelayMs: 1000 });
  return { written: rows.length, skipped: false, cacheCount: cache.quotes.size, stockRows, txfRows };
}

async function captureFutoptPreopenBaseline(futoptRows) {
  const tradeDate = taipeiDate();
  const base = {
    tradeDate,
    source: "fugle_daytrade_futopt_quotes_live",
    captureWindow: "0845_natural",
    naturalScheduleEvidence: false,
    rows: 0,
    status: "not_in_window",
  };
  if (!APPLY) return { ...base, status: "dry_run" };
  const minutes = taipeiMinutes();
  if (minutes < FUTOPT_PREOPEN_BASELINE_START_MINUTES || minutes >= FUTOPT_PREOPEN_BASELINE_END_MINUTES) {
    return base;
  }
  try {
    const existing = await supabaseGet(
      "fugle_daytrade_futopt_preopen_baseline",
      "select=underlying_symbol&trade_date=eq." + encodeURIComponent(tradeDate) + "&limit=1",
      { service: true },
    );
    if (existing.length) {
      return {
        ...base,
        status: "already_captured",
        naturalScheduleEvidence: true,
        rows: existing.length,
      };
    }

    const byUnderlying = new Map();
    for (const row of futoptRows || []) {
      const product = String(row.product || row.payload?.product || "").toUpperCase();
      const underlying = normalizeCode(row.underlying_symbol || row.payload?.underlying_symbol || row.payload?.underlyingSymbol);
      const futureSymbol = String(row.future_symbol || "").trim().toUpperCase();
      const observedAt = normalizeTimestamp(row.updated_at);
      const price = numberValue(row.last_price ?? row.price ?? row.payload?.lastPrice);
      if (product !== "STOCK_FUTURE" || !underlying || !futureSymbol || !observedAt || !price) continue;
      if (taipeiDateFrom(observedAt) !== tradeDate || ageSeconds(observedAt) > 180) continue;
      const previous = byUnderlying.get(underlying);
      if (!previous || Date.parse(observedAt) > Date.parse(previous.baseline_observed_at)) {
        byUnderlying.set(underlying, {
          trade_date: tradeDate,
          underlying_symbol: underlying,
          future_symbol: futureSymbol,
          baseline_price: price,
          baseline_change_percent: numberValue(row.change_percent ?? row.payload?.changePercent),
          baseline_total_volume: numberValue(row.total_volume ?? row.volume ?? row.payload?.total?.tradeVolume),
          baseline_observed_at: observedAt,
          captured_at: nowIso(),
          source: "fugle_daytrade_futopt_quotes_live",
          capture_window: "0845_natural",
          payload: {
            ...(row.payload || {}),
            natural_schedule_evidence: true,
            natural_schedule_phase: "0845",
            source: "fugle_daytrade_futopt_quotes_live",
          },
        });
      }
    }
    const rows = [...byUnderlying.values()];
    if (!rows.length) {
      return { ...base, status: "baseline_source_rows_missing" };
    }
    await supabaseUpsert(
      "fugle_daytrade_futopt_preopen_baseline",
      rows,
      "trade_date,underlying_symbol",
      { batchSize: 100 },
    );
    return {
      ...base,
      status: "ready",
      naturalScheduleEvidence: true,
      rows: rows.length,
    };
  } catch (error) {
    return {
      ...base,
      status: "baseline_write_failed",
      error: error?.message || String(error),
    };
  }
}

async function tick() {
  await ensureWriterLease();
  const state = readWriterState();
  const phase = phaseNow();
  const warmupDataFillActive = taipeiMinutes() >= PREOPEN_WARMUP_START_MINUTES;
  const fetchAllowedForPhase = warmupDataFillActive && quoteFetchAllowedForPhase(phase);
  const fetchPriorityOnlyForPhase = warmupDataFillActive && quoteFetchPriorityOnlyForPhase(phase);
  const activeSymbols = await fetchActiveSymbols();
  await refreshStrategyChipPriorityBridge();
  const dailyVolumeMap = await fetchDailyVolumeAvg();
  const quoteMap = await fetchExistingDaytradeQuotes();
  // Seed pool ranking from the live WebSocket cache before any enrichment
  // reads, so the first formal readthrough of a tick is freshness-first too.
  mergeWebSocketQuoteCache(quoteMap);
  const provisionalPriorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, {});
  await writeEnrichmentPendingHeartbeat({
    activeSymbols,
    priorityRows: provisionalPriorityRows,
    quoteMap,
    dailyVolumeMap,
    state,
  });
  const [capitalMap, chipMap, marginChangeMap, stockFutureInitialMap, stockGroupContractMap] = await Promise.all([
    fetchCapitalMap(),
    fetchChipFlowMap(),
    fetchMarginChangeMap(),
    fetchStockFutureInitialMap(),
    fetchStockGroupContractMap(),
  ]);
  const supplementalMaps = { capitalMap, chipMap, marginChangeMap, stockFutureInitialMap, stockGroupContractMap };
  let priorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, supplementalMaps);
  let intradayMap = await fetchIntradayStatus(activeSymbols);
  supplementalMaps.intradayMap = intradayMap;
  intradayMap = mergeWebSocketQuoteDerivedIntradayStatus(intradayMap, priorityRows);
  priorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, supplementalMaps);
  const nonFatalWriteErrors = [];
  let websocketQuoteReadthroughSync = { written: 0, skipped: true, reason: 'no_fresh_mother_quotes', candidateRows: priorityRows.length, freshRows: 0 };
  if (priorityRows.length) {
    // Re-read the direct WebSocket cache immediately before the mother-pool write.
    // Long enrichment reads must not leave the formal source writeback on an older map.
    const writebackQuoteMap = new Map(quoteMap);
    mergeWebSocketQuoteCache(writebackQuoteMap);
    const websocketQuoteRows = priorityRows
      .map((row) => writebackQuoteMap.get(normalizeCode(row.symbol)))
      .filter((quote) => quote && ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS)
      .map((quote) => ({
        symbol: normalizeCode(quote.symbol),
        name: quote.name || normalizeCode(quote.symbol),
        market: quote.market || '',
        quote_seen_at: normalizeTimestamp(quote.quote_seen_at || quote.updated_at, nowIso()),
        updated_at: normalizeTimestamp(quote.updated_at || quote.quote_seen_at, nowIso()),
        last_trade_time: normalizeTimestamp(quote.last_trade_time || quote.quote_seen_at || quote.updated_at, nowIso()),
        price: numberValue(quote.price),
        open_price: numberValue(quote.open_price),
        high_price: numberValue(quote.high_price),
        low_price: numberValue(quote.low_price),
        previous_close: numberValue(quote.previous_close) || null,
        change_percent: numberValue(quote.change_percent),
        total_volume: numberValue(quote.total_volume),
        trade_value: numberValue(quote.trade_value),
        bid_price: numberValue(quote.bid_price),
        bid_volume: numberValue(quote.bid_volume),
        ask_price: numberValue(quote.ask_price),
        ask_volume: numberValue(quote.ask_volume),
        cumulative_bid_volume: numberValue(quote.cumulative_bid_volume) || null,
        cumulative_ask_volume: numberValue(quote.cumulative_ask_volume) || null,
        cumulative_bid_ask_volume: numberValue(quote.cumulative_bid_ask_volume) || null,
        limit_up_price: numberValue(quote.limit_up_price) || null,
        limit_down_price: numberValue(quote.limit_down_price) || null,
        stock_type: quote.stock_type || '',
        session: quote.session || '',
        source: quote.source || 'fugle_websocket_cache',
        payload: quote.payload || {},
      }))
      .filter((quote) => quote.symbol);
    if (websocketQuoteRows.length) {
      try {
        await supabaseUpsert('fugle_daytrade_quotes_live', websocketQuoteRows, 'symbol', { batchSize: 40 });
        websocketQuoteReadthroughSync = {
          written: websocketQuoteRows.length,
          skipped: false,
          reason: 'websocket_cache_mother_pool_readthrough',
          candidateRows: priorityRows.length,
          freshRows: websocketQuoteRows.length,
        };
      } catch (error) {
        websocketQuoteReadthroughSync = {
          written: 0,
          skipped: false,
          reason: 'write_failed',
          candidateRows: priorityRows.length,
          freshRows: websocketQuoteRows.length,
          error: error?.message || String(error),
        };
        nonFatalWriteErrors.push({ target: 'fugle_daytrade_quotes_live_websocket_readthrough', message: error?.message || String(error) });
      }
    }
  }
  let dailyVolumeMirrorSync = { written: 0, skipped: true, reason: 'not_attempted' };
  try {
    dailyVolumeMirrorSync = await syncDailyVolumeMirror(dailyVolumeMap, activeSymbols);
  } catch (error) {
    nonFatalWriteErrors.push({
      target: 'fugle_daytrade_daily_volume_avg',
      message: error?.message || String(error),
    });
  }
  let websocketCandleSync = { written: 0, skipped: true, cacheCount: 0 };
  let opening0901Evidence = { required: false, ready: true, source: "not_checked", rows: 0, symbols: [], missingSymbols: [], schema: [] };
  let websocketFutoptSync = { written: 0, skipped: true, cacheCount: 0 };

  if (priorityRows.length) {
    try {
      publishDaytradePrioritySymbols(priorityRows, activeSymbols);
    } catch (error) {
      nonFatalWriteErrors.push({
        target: "fugle-ws-priority-symbols.json",
        message: error?.message || String(error),
      });
    }
    try {
      await supabaseUpsert("fugle_daytrade_priority_pool", priorityPoolDbRows(priorityRows), "symbol", {
        batchSize: 40,
        timeoutMs: 30000,
        retries: 1,
        retryDelayMs: 1000,
      });
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
      websocketCandleSync = await syncWebSocketIntraday1mCandles(priorityRows, state);
      if (!websocketCandleSync.skipped && numberValue(websocketCandleSync.written) > 0) {
        // Gate/source_status must evaluate the latest Fugle candles, not the stale pre-sync map.
        intradayMap = await fetchIntradayStatus(activeSymbols);
        supplementalMaps.intradayMap = intradayMap;
        intradayMap = mergeWebSocketQuoteDerivedIntradayStatus(intradayMap, priorityRows);
        supplementalMaps.intradayMap = intradayMap;
        const candleSyncedPriorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, supplementalMaps);
        if (candleSyncedPriorityRows.length) {
          priorityRows = candleSyncedPriorityRows;
          publishDaytradePrioritySymbols(priorityRows, activeSymbols);
          await supabaseUpsert("fugle_daytrade_priority_pool", priorityPoolDbRows(priorityRows), "symbol", {
            batchSize: 40,
            timeoutMs: 30000,
            retries: 1,
            retryDelayMs: 1000,
          });
          await supabaseDelete(
            "fugle_daytrade_priority_pool",
            `updated_at=lt.${encodeURIComponent(priorityRows[0].updated_at)}`,
          );
        }
      }
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

  if (priorityRows.length && taipeiMinutes() >= (9 * 60 + 2)) {
    try {
      opening0901Evidence = await ensureOpening0901CandleEvidence(priorityRows);
    } catch (error) {
      opening0901Evidence = { required: true, ready: false, source: "dedicated_daytrade_1m_0901_unhandled_error", rows: 0, symbols: [], missingSymbols: priorityRows.slice(0, DEEP_SCAN_POOL_MAX_SYMBOLS).map((row) => row.symbol), schema: [], error: error?.message || String(error) };
    }
  }
  const intradayStatusCacheSync = await syncIntradayStatusCache(intradayMap, priorityRows);
  if (intradayStatusCacheSync.error) {
    nonFatalWriteErrors.push({
      target: 'fugle_daytrade_intraday_1m_status_cache',
      message: intradayStatusCacheSync.error,
    });
  }
  const futoptRows = await fetchFutoptRows();
  const futoptPreopenBaseline = await captureFutoptPreopenBaseline(futoptRows);
  let intradaySignalEvidence = buildFullMarketIntradaySignalEvidence({
    activeSymbols,
    dailyVolumeMap,
    quoteMap,
    intradayMap,
  });

  const cooldownActive = futureSeconds(state.cooldownUntil) > 0;
  const selected = cooldownActive || !fetchAllowedForPhase
    ? { symbols: [], priorityOnly: true }
    : selectFetchBatch(activeSymbols, priorityRows, quoteMap, state, { priorityOnly: fetchPriorityOnlyForPhase });
  const fetchResult = fetchAllowedForPhase
    ? await fetchQuoteBatch(selected.symbols)
    : { rows: [], attempted: 0, fetched: 0, rateLimited: false, errors: [], disabledReason: `phase_${phase}_fetch_disabled` };
  fetchResult.errors = [...(fetchResult.errors || []), ...nonFatalWriteErrors];
  if (fetchResult.rows.length) {
    await supabaseUpsert("fugle_daytrade_quotes_live", fetchResult.rows, "symbol");
    for (const row of fetchResult.rows) {
      const symbol = normalizeCode(row.symbol);
      if (symbol) quoteMap.set(symbol, row);
    }
  }
  if (fetchResult.rows.length) {
    // Let freshness-first ranking see the latest WebSocket cache before the
    // Post-fetch Mother Pool and deep-scan rebuild.
    mergeWebSocketQuoteCache(quoteMap);
    const rebuiltPriorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, supplementalMaps);
    if (rebuiltPriorityRows.length) {
      priorityRows = rebuiltPriorityRows;
      try {
        // Persist the post-fetch rebuild so the canonical mother-pool view sees
        // the same fresh quote timestamps used by source_status.payload.
        publishDaytradePrioritySymbols(priorityRows, activeSymbols);
        await supabaseUpsert("fugle_daytrade_priority_pool", priorityPoolDbRows(priorityRows), "symbol", {
        batchSize: 40,
        timeoutMs: 30000,
        retries: 1,
        retryDelayMs: 1000,
      });
        await supabaseDelete(
          "fugle_daytrade_priority_pool",
          "updated_at=lt." + encodeURIComponent(priorityRows[0].updated_at),
        );
      } catch (error) {
        fetchResult.errors.push({ target: "fugle_daytrade_priority_pool_rebuild", message: error?.message || String(error) });
      }
    }
  }

  // The fetch/rebuild can change deep-scan membership. Re-read the
  // WebSocket cache against that final ordering so the live quote table and
  // source payload describe the same formal symbols in the same tick.
  if (priorityRows.length) {
    const postFetchQuoteMap = new Map(quoteMap);
    mergeWebSocketQuoteCache(postFetchQuoteMap);
    const postFetchWebsocketQuoteRows = priorityRows
      .slice(0, DEEP_SCAN_POOL_MAX_SYMBOLS)
      .map((row) => postFetchQuoteMap.get(normalizeCode(row.symbol)))
      .filter((quote) => quote && ageSeconds(quoteFreshnessTime(quote)) <= WINDOW_SECONDS)
      .map((quote) => ({
        symbol: normalizeCode(quote.symbol),
        name: quote.name || normalizeCode(quote.symbol),
        market: quote.market || '',
        quote_seen_at: normalizeTimestamp(quote.quote_seen_at || quote.updated_at, nowIso()),
        updated_at: normalizeTimestamp(quote.updated_at || quote.quote_seen_at, nowIso()),
        last_trade_time: normalizeTimestamp(quote.last_trade_time || quote.quote_seen_at || quote.updated_at, nowIso()),
        price: numberValue(quote.price),
        open_price: numberValue(quote.open_price),
        high_price: numberValue(quote.high_price),
        low_price: numberValue(quote.low_price),
        previous_close: numberValue(quote.previous_close) || null,
        change_percent: numberValue(quote.change_percent),
        total_volume: numberValue(quote.total_volume),
        trade_value: numberValue(quote.trade_value),
        bid_price: numberValue(quote.bid_price),
        bid_volume: numberValue(quote.bid_volume),
        ask_price: numberValue(quote.ask_price),
        ask_volume: numberValue(quote.ask_volume),
        cumulative_bid_volume: numberValue(quote.cumulative_bid_volume) || null,
        cumulative_ask_volume: numberValue(quote.cumulative_ask_volume) || null,
        cumulative_bid_ask_volume: numberValue(quote.cumulative_bid_ask_volume) || null,
        limit_up_price: numberValue(quote.limit_up_price) || null,
        limit_down_price: numberValue(quote.limit_down_price) || null,
        stock_type: quote.stock_type || '',
        session: quote.session || '',
        source: quote.source || 'fugle_websocket_cache',
        payload: quote.payload || {},
      }))
      .filter((quote) => quote.symbol);
    if (postFetchWebsocketQuoteRows.length) {
      try {
        await supabaseUpsert('fugle_daytrade_quotes_live', postFetchWebsocketQuoteRows, 'symbol', { batchSize: 40 });
        for (const quote of postFetchWebsocketQuoteRows) quoteMap.set(quote.symbol, quote);
        websocketQuoteReadthroughSync = {
          ...websocketQuoteReadthroughSync,
          written: Math.max(websocketQuoteReadthroughSync.written || 0, postFetchWebsocketQuoteRows.length),
          skipped: false,
          reason: 'websocket_cache_final_deep_scan_readthrough',
          finalFormalRows: postFetchWebsocketQuoteRows.length,
        };
      } catch (error) {
        fetchResult.errors.push({ target: 'fugle_daytrade_quotes_live_final_deep_scan_readthrough', message: error?.message || String(error) });
      }
    }
  }

  let nextState = { ...state };
  if (fetchResult.rateLimited) {
    nextState = apply429State(nextState);
  } else if (!cooldownActive) {
    nextState.consecutive429Count = Math.max(0, nextState.consecutive429Count - 1);
  }
  nextState = applyQuoteNotFoundState(nextState, fetchResult.errors);
  writeWriterState(nextState);

  // Recompute after the current quote batch has been merged so evidence and persisted quotes share one loop.
  intradaySignalEvidence = buildFullMarketIntradaySignalEvidence({
    activeSymbols,
    dailyVolumeMap,
    quoteMap,
    intradayMap,
  });
  const result = computeStats({
    activeSymbols,
    priorityRows,
    quoteMap,
    fetchedRows: fetchResult.rows,
    dailyVolumeMap,
    intradayMap,
    opening0901Evidence,
    futoptRows,
    websocketFutoptSync,
    fetchResult,
    state: nextState,
    supplementalMaps,
  });
  result.payload.nonfatal_write_errors = fetchResult.errors || [];
  result.payload.websocket_quote_readthrough_written = websocketQuoteReadthroughSync.written || 0;
  result.payload.websocket_quote_readthrough_skipped = Boolean(websocketQuoteReadthroughSync.skipped);
  result.payload.websocket_quote_readthrough_reason = websocketQuoteReadthroughSync.reason || '';
  result.payload.websocket_quote_readthrough_candidate_rows = websocketQuoteReadthroughSync.candidateRows || 0;
  result.payload.websocket_quote_readthrough_fresh_rows = websocketQuoteReadthroughSync.freshRows || 0;
  result.payload.daily_volume_mirror_sync_written = dailyVolumeMirrorSync.written || 0;
  result.payload.daily_volume_mirror_sync_skipped = Boolean(dailyVolumeMirrorSync.skipped);
  result.payload.daily_volume_mirror_sync_reason = dailyVolumeMirrorSync.reason || '';
  result.payload.daily_volume_mirror_sync_source = dailyVolumeMirrorSync.source || '';
  result.payload.websocket_candles_synced_rows = websocketCandleSync.written || 0;
  result.payload.websocket_candles_cache_count = websocketCandleSync.cacheCount || 0;
  result.payload.websocket_candles_sync_skipped = Boolean(websocketCandleSync.skipped);
  result.payload.intraday_status_cache_sync_rows = intradayStatusCacheSync.rows || 0;
  result.payload.intraday_status_cache_sync_written = intradayStatusCacheSync.written || 0;
  result.payload.intraday_status_cache_sync_skipped = Boolean(intradayStatusCacheSync.skipped);
  result.payload.futopt_websocket_synced_rows = websocketFutoptSync.written || 0;
  result.payload.futopt_websocket_cache_count = websocketFutoptSync.cacheCount || 0;
  result.payload.futopt_websocket_sync_skipped = Boolean(websocketFutoptSync.skipped);
  result.payload.futopt_websocket_synced_stock_rows = websocketFutoptSync.stockRows || 0;
  result.payload.futopt_websocket_synced_txf_rows = websocketFutoptSync.txfRows || 0;
  result.payload.futopt_stock_quote_universe = websocketFutoptSync.stockRows || 0;
  result.payload.futopt_stock_quote_attempted = websocketFutoptSync.stockRows || 0;
  result.payload.futopt_stock_quote_fetched = websocketFutoptSync.stockRows || 0;
  result.payload.futopt_stock_quotes_this_loop = websocketFutoptSync.stockRows || 0;
  result.payload.futopt_stock_this_loop = websocketFutoptSync.stockRows || 0;
  result.payload.txf_quotes_this_loop = websocketFutoptSync.txfRows || 0;
  result.payload.futopt_preopen_baseline_trade_date = futoptPreopenBaseline.tradeDate;
  result.payload.futopt_preopen_baseline_source = futoptPreopenBaseline.source;
  result.payload.futopt_preopen_baseline_capture_window = futoptPreopenBaseline.captureWindow;
  result.payload.futopt_preopen_baseline_status = futoptPreopenBaseline.status;
  result.payload.futopt_preopen_baseline_rows = futoptPreopenBaseline.rows || 0;
  result.payload.futopt_preopen_baseline_natural_schedule_evidence = Boolean(futoptPreopenBaseline.naturalScheduleEvidence);
  if (futoptPreopenBaseline.error) result.payload.futopt_preopen_baseline_error = futoptPreopenBaseline.error;
  result.payload.full_market_intraday_signal_evidence = intradaySignalEvidence;
  result.payload.full_market_bullish_gain_volume_candidates = intradaySignalEvidence.bullishGainVolumeCandidates;
  result.payload.full_market_volume_surge_top100_candidates = intradaySignalEvidence.volumeSurgeTop100Candidates;
  result.payload.full_market_bullish_gain_volume_candidate_count = intradaySignalEvidence.bullishGainVolumeCandidateCount;
  result.payload.full_market_volume_surge_top100_candidate_count = intradaySignalEvidence.volumeSurgeTop100CandidateCount;
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
    openingBoostActive: Boolean(result.payload.opening_boost_active),
    formalGateScope: result.payload.formal_gate_scope,
    formalSourceAlignmentOk: Boolean(result.payload.formal_source_alignment_ok),
    gateSpeedOk: Boolean(result.payload.gate_speed_ok),
    openingBoostEffective: Boolean(result.payload.opening_boost_effective),
    openingBoostScope: result.payload.opening_boost_scope,
    priorityPoolSymbols: result.payload.priority_pool_symbols,
    motherPoolSymbols: result.payload.mother_pool_symbols,
    motherPoolRangeMin: MOTHER_POOL_MIN_SYMBOLS,
    motherPoolRangeMax: MOTHER_POOL_MAX_SYMBOLS,
    motherPoolRuleVersion: result.payload.mother_pool_rule_version,
    motherPoolRuleHitCounts: result.payload.mother_pool_rule_hit_counts,
    motherPoolMinPrice: result.payload.mother_pool_min_price,
    motherPoolPriceFloorRejectedCount: result.payload.mother_pool_price_floor_rejected_count,
    hotPoolSymbols: result.payload.hot_pool_symbols,
    indicatorSet: result.payload.indicator_set,
    readyMa3: result.payload.ready_ma3,
    readyMa58: result.payload.ready_ma58,
    ma3WarmupStatus: result.payload.ma3_warmup_status,
    ma58WarmupStatus: result.payload.ma58_warmup_status,
    stockGroupContractSource: result.payload.stock_group_contract_source,
    stockGroupContractRows: result.payload.stock_group_contract_rows,
    stockFutureInitial0846Rows: result.payload.stock_future_initial_0846_rows,
    stockFutureInitial0846ReadyRows: result.payload.stock_future_initial_0846_ready_rows,
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
      sourceHostId: SOURCE_HOST_ID,
      sourceHostRole: SOURCE_HOST_ROLE,
      writerInstanceId: WRITER_INSTANCE_ID,
      writerLeaseRequired: WRITER_LEASE_REQUIRED,
      sourceHostApprovalFile: SOURCE_HOST_APPROVAL_FILE,
      applyDefault: APPLY,
      fetchEnabled: FETCH_ENABLED,
      runtimeConfigFile: RUNTIME_CONFIG_FILE,
      repoConfigFile: REPO_CONFIG_FILE,
      prioritySymbolsFile: PRIORITY_SYMBOLS_FILE,
      batchSize: QUOTE_BATCH_SIZE,
      concurrency: CONCURRENCY,
      targetBatchIntervalSeconds: TARGET_BATCH_INTERVAL_SECONDS,
      requestDelayMs: REQUEST_DELAY_MS,
      maxRunSeconds: MAX_RUN_SECONDS,
      minPriorityPoolSymbols: MIN_PRIORITY_POOL_SYMBOLS,
      maxPriorityPoolSymbols: MAX_PRIORITY_POOL_SYMBOLS,
      formalPriorityLimit: DEEP_SCAN_POOL_MAX_SYMBOLS,
      motherPoolRangeMin: MOTHER_POOL_MIN_SYMBOLS,
      motherPoolRangeMax: MOTHER_POOL_MAX_SYMBOLS,
    }, null, 2));
    return;
  }

  if (APPLY && SOURCE_HOST_ROLE !== "writer") {
    throw new Error("daytrade_writer_host_role_required");
  }
  if (APPLY && (!SOURCE_HOST_ID || SOURCE_HOST_ID === "unknown")) {
    throw new Error("daytrade_writer_host_id_required");
  }
  if (!APPLY) {
    console.error("[daytrade-source-writer] dry-run mode: no Supabase writes. Use --apply only in an approved release-owner window.");
  }
  if (!FETCH_ENABLED) {
    console.log("[daytrade-source-writer] REST quote fetch disabled; continuing with WebSocket/cache-only writer.");
  }

  const runStartedAt = Date.now();
  let maxRunReached = false;
  const maxRunTimer = MAX_RUN_SECONDS > 0
    ? setTimeout(() => {
      // Finish the active tick before stopping. Hard process.exit() here can
      // interrupt a completed source write and leave a false timeout receipt.
      maxRunReached = true;
      console.error(JSON.stringify({
        ok: true,
        sourceName: SOURCE_NAME,
        mode: APPLY ? "apply" : "dry-run",
        stopReason: "max_run_seconds_reached_after_active_tick",
        maxRunSeconds: MAX_RUN_SECONDS,
        checkedAt: nowIso(),
      }, null, 2));
    }, MAX_RUN_SECONDS * 1000)
    : null;
  if (maxRunTimer && typeof maxRunTimer.unref === "function") maxRunTimer.unref();

  try {
    do {
      const started = Date.now();
      const result = await tick();
      console.log(JSON.stringify(result, null, 2));
      if (ONCE) break;
      if (maxRunReached || (MAX_RUN_SECONDS > 0 && (Date.now() - runStartedAt) / 1000 >= MAX_RUN_SECONDS)) break;
      const elapsed = Math.ceil((Date.now() - started) / 1000);
      const sleepMs = Math.max(1000, (LOOP_SECONDS - elapsed) * 1000);
      if (MAX_RUN_SECONDS > 0 && (Date.now() + sleepMs - runStartedAt) / 1000 >= MAX_RUN_SECONDS) break;
      await sleep(sleepMs);
    } while (true);
  } finally {
    if (maxRunTimer) clearTimeout(maxRunTimer);
  }
}

main().catch((error) => {
  const cause = error && typeof error === "object" ? (error.cause || {}) : {};
  console.error(JSON.stringify({
    ok: false,
    sourceName: SOURCE_NAME,
    mode: APPLY ? "apply" : "dry-run",
    error: error.message || String(error),
    errorDetail: {
      name: error?.name || "",
      code: error?.code || cause?.code || "",
      causeMessage: cause?.message || "",
      hostname: cause?.hostname || "",
      syscall: cause?.syscall || "",
    },
    checkedAt: nowIso(),
  }, null, 2));
  process.exit(1);
});
