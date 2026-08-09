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
    key: "strategy2",
    latestResource: "v_strategy2_latest_complete_run",
    latestQuery: "select=*&limit=1",
    resultsResource: "strategy2_scan_results",
    resultSelect: "code,rank,score,complete,quality_status,scan_date,run_id,payload",
    codeMode: "stock",
  },
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
const MIN_PRIORITY_POOL_SYMBOLS = positiveNumber(CONFIG.priorityPool?.targetSymbolsMin, 300);
const MAX_PRIORITY_POOL_SYMBOLS = positiveNumber(CONFIG.priorityPool?.targetSymbolsMax, 500);
const MIN_PRIORITY_FRESH_COVERAGE = positiveNumber(CONFIG.priorityPool?.minFreshQuoteCoverageForA, 0.95);
const MIN_PRIORITY_INJECTING_QUOTES = positiveNumber(CONFIG.priorityPool?.minFreshQuotesForInjectingA, 1);
const FORMAL_DAYTRADE_PRIORITY_LIMIT = Math.max(1, positiveNumber(process.env.DAYTRADE_FORMAL_PRIORITY_LIMIT, 40));
const FORMAL_SIGNAL_MIN_TOTAL_VOLUME = positiveNumber(process.env.DAYTRADE_FORMAL_SIGNAL_MIN_TOTAL_VOLUME, 5000);
const FORMAL_SIGNAL_MIN_TRADE_VALUE = positiveNumber(process.env.DAYTRADE_FORMAL_SIGNAL_MIN_TRADE_VALUE, 30000000);
const FORMAL_SIGNAL_MAX_VOLUME_RANK = positiveNumber(process.env.DAYTRADE_FORMAL_SIGNAL_MAX_VOLUME_RANK, 300);
const MOTHER_POOL_MIN_SYMBOLS = Math.max(
  FORMAL_DAYTRADE_PRIORITY_LIMIT,
  positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MIN_SYMBOLS || CONFIG.motherPool?.targetSymbolsMin, 300),
);
// The mother pool is dynamic: it can expand from 300 to 600 when
// the full-market ranking has enough eligible candidates.
const MOTHER_POOL_MAX_SYMBOLS = Math.max(
  MOTHER_POOL_MIN_SYMBOLS,
  Math.min(600, positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MAX_SYMBOLS || CONFIG.motherPool?.targetSymbolsMax, 600)),
);const REST_PRIORITY_BATCH_LIMIT = Math.max(1, positiveNumber(process.env.DAYTRADE_REST_PRIORITY_BATCH_LIMIT, 40));
const BATCH_SIZE = Math.max(1, Math.min(FORMAL_DAYTRADE_PRIORITY_LIMIT, REST_PRIORITY_BATCH_LIMIT, positiveNumber(CONFIG.collector?.quoteBatchSize, 40)));
const CONCURRENCY = 1;
const TARGET_BATCH_INTERVAL_SECONDS = Math.max(5, positiveNumber(CONFIG.collector?.targetBatchIntervalSeconds, 5));
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
const WRITER_LEASE_OWNER = `${process.env.COMPUTERNAME || "writer-host"}:${process.pid}:daytrade-source-writer`;
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

async function ensureWriterLease() {
  if (!APPLY) return;
  const key = requireSupabaseKey(true);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/acquire_fugle_daytrade_intraday_writer_lease`, {
    method: "POST", headers: headers(key), body: JSON.stringify({ p_owner_id: WRITER_LEASE_OWNER, p_lease_seconds: 180 }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(SUPABASE_WRITE_TIMEOUT_MS) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`writer lease RPC HTTP ${response.status}: ${text.slice(0, 240)}`);
  const result = text ? JSON.parse(text) : {};
  if (!result.ok) throw new Error(`writer lease unavailable: ${result.reason || "unknown"}`);
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

async function supabaseRpc(resource, body, options = {}) {
  const key = requireSupabaseKey(Boolean(options.service));
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${resource}`, {
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

function evaluateMotherPoolBasePool(row, metrics) {
  const market = String(row.market || "").toLowerCase();
  const type = String(row.stockType || row.type || row.payload?.stockType || row.payload?.type || "").toLowerCase();
  const failedChecks = [];
  const pendingChecks = [];
  if (!market || !/(twse|tse|tpex|otc|上市|上櫃)/i.test(market)) failedChecks.push("market_not_twse_otc");
  if (row.isTrial === true || row.payload?.isTrial === true || /(etf|warrant|preferred|test|trial|權證|特別股|優先股|測試)/i.test(type)) failedChecks.push("not_common_stock");
  if (metrics.price > 0 && (metrics.price < 10 || metrics.price > 1000)) failedChecks.push("price_out_of_range_10_1000");
  else pendingChecks.push("price_pending");
  // Five-day average volume ranks liquidity; it is not a hard membership gate.
  // The full-market ordinary-stock pool must be able to rotate to 300-600 symbols.
  // Missing history remains pending and cannot be promoted without evidence.
  if (!(metrics.avgVolume5 > 0)) pendingChecks.push("avg5_volume_pending");
  if (metrics.totalVolume > 0) {
    if (metrics.changePercent < -5) failedChecks.push("change_percent_below_minus5");
  } else {
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
      industry: row.industry || row.payload?.industry || row.payload?.category || "",
      isTrial: row.is_trial === true || row.payload?.isTrial === true || row.payload?.is_trial === true,
      payload: row.payload || {},
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
    if (!loaded && spec.resource === "fugle_daytrade_daily_volume_avg" && combined.size >= FORMAL_DAYTRADE_PRIORITY_LIMIT) break;
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
    const ma5 = firstNumber(intraday.ma5, intraday.sma5);
    const ma10 = firstNumber(intraday.ma10, intraday.sma10);
    const ma35 = firstNumber(intraday.ma35, intraday.sma35);
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
      ma5,
      ma10,
      ma35,
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
    ma5: row.ma5,
    ma10: row.ma10,
    ma35: row.ma35,
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
      formalEntryScope: "priority_top40",
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
        today_candle_count: 0,
        warmup_candle_count: 0,
        continuous_candle_count: 0,
        ready_ma5: false,
        ready_ma10: false,
        ready_ma20_continuous: false,
        ready_ma30: false,
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
      if (candleTime && (!current.latest_candle_time || Date.parse(candleTime) > Date.parse(current.latest_candle_time))) {
        current.latest_candle_time = candleTime;
        current.latest_candle_age_seconds = ageSeconds(candleTime);
      }
      current.ready_ma5 = current.continuous_candle_count >= 5;
      current.ready_ma10 = current.continuous_candle_count >= 10;
      current.ready_ma20_continuous = current.continuous_candle_count >= 20;
      current.ready_ma30 = current.continuous_candle_count >= 30;
      current.ready_ma35_continuous = current.continuous_candle_count >= 35;
      grouped.set(symbol, current);
    }
    for (const current of grouped.values()) {
      const closes = current._closes || [];
      const volumes = current._volumes || [];
      const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      const movingAverage = (count, offset = 0) => average(closes.slice(offset, offset + count));
      const volumeSum = (count, offset = 0) => volumes.slice(offset, offset + count).reduce((sum, value) => sum + value, 0);
      current.ma5 = movingAverage(5);
      current.ma10 = movingAverage(10);
      current.ma30 = movingAverage(30);
      current.ma35 = movingAverage(35);
      current.ma5_ma10_ma35_bullish = Number.isFinite(current.ma5)
        && Number.isFinite(current.ma10)
        && Number.isFinite(current.ma35)
        && current.ma5 > current.ma10
        && current.ma10 > current.ma35
        && current.ma35 > 0;
      current.ma_bullish_alignment = current.ma5_ma10_ma35_bullish;
      current.ma5_rising = closes.length >= 10 && movingAverage(5, 0) > movingAverage(5, 5);
      current.ma10_rising = closes.length >= 20 && movingAverage(10, 0) > movingAverage(10, 10);
      current.ma30_rising = closes.length >= 60 && movingAverage(30, 0) > movingAverage(30, 30);
      current.ma35_rising = closes.length >= 70 && movingAverage(35, 0) > movingAverage(35, 35);
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
  try {
    const rows = await supabaseGetPaged(
      "v_fugle_daytrade_intraday_1m_status",
      "select=symbol,latest_candle_time,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma5,ready_ma10,ready_ma20_continuous,ready_ma30,ready_ma35_continuous,latest_candle_age_seconds,ma5,ma10,ma35,ma5_ma10_ma35_bullish,ma_bullish_alignment,ma30",
      { service: true, pageSize: 1000 },
    );
    if (rows.length) {
      const currentReadyRows = rows.filter((row) =>
        taipeiDateFrom(row.latest_candle_time || "") === taipeiDateFrom(nowIso())
        && numberValue(row.today_candle_count) > 0
        && numberValue(row.latest_candle_age_seconds, 999999) <= MAX_INTRADAY_1M_STALE_SECONDS
      );
      if (currentReadyRows.length >= Math.min(40, rows.length)) return toMap(rows, "dedicated_daytrade_intraday_1m_view_fresh");
    }
  } catch {
    // The view may timeout under load; use the narrow dedicated-table read below.
  }

  const tradeDate = taipeiDateFrom(nowIso());
  try {
    const symbols = [...new Set((activeSymbols || []).map((row) => normalizeCode(row.symbol || row)).filter(Boolean))];
    const rpcRows = [];
    for (let i = 0; i < symbols.length; i += 200) {
      const batch = symbols.slice(i, i + 200);
      const rows = await supabaseRpc(
        'get_fugle_daytrade_intraday_1m_latest_n',
        { symbols: batch, bars_per_symbol: 200 },
        { service: true },
      );
      if (Array.isArray(rows)) rpcRows.push(...rows);
    }
    const grouped = buildGrouped(rpcRows, tradeDate);
    if (grouped.size) return toMap([...grouped.values()], 'dedicated_daytrade_intraday_1m_latest_n_rpc');
  } catch {
    // Fall through to direct reads; a missing/slow RPC must not weaken the gate.
  }
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_intraday_1m",
      "select=symbol,market,candle_time,trade_date,updated_at&trade_date=eq." + encodeURIComponent(tradeDate) + "&order=symbol.asc,candle_time.desc",
      { service: true, pageSize: 1000 },
    );
    const grouped = buildGrouped(rows, tradeDate);
    if (grouped.size) return toMap([...grouped.values()], "dedicated_daytrade_intraday_1m_direct_today");
  } catch {
    // A current-day read failure is diagnosed separately; do not call it an empty source yet.
  }

  const warmupCutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_intraday_1m",
      "select=symbol,market,candle_time,trade_date,updated_at&candle_time=gte." + encodeURIComponent(warmupCutoff),
      { service: true, pageSize: 1000 },
    );
    const grouped = buildGrouped(rows, tradeDate);
    if (grouped.size) return toMap([...grouped.values()], "dedicated_daytrade_intraday_1m_direct_warmup");
  } catch {
    const failed = toMap([], "dedicated_daytrade_intraday_1m_read_failed");
    failed.readError = true;
    return failed;
  }
  const empty = toMap([], "dedicated_daytrade_intraday_1m_empty");
  empty.readError = false;
  return empty;
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
        ready_ma20_continuous: boolValue(row.ready_ma20_continuous),
        ready_ma35_continuous: boolValue(row.ready_ma35_continuous),
        latest_candle_age_seconds: Math.max(0, Math.floor(numberValue(row.latest_candle_age_seconds, 999999))),
        ready_ma5: boolValue(row.ready_ma5),
        ready_ma10: boolValue(row.ready_ma10),
        ready_ma30: boolValue(row.ready_ma30),
        ma5: Number.isFinite(Number(row.ma5)) ? Number(row.ma5) : null,
        ma10: Number.isFinite(Number(row.ma10)) ? Number(row.ma10) : null,
        ma35: Number.isFinite(Number(row.ma35)) ? Number(row.ma35) : null,
        ma5_ma10_ma35_bullish: boolValue(row.ma5_ma10_ma35_bullish),
        ma_bullish_alignment: boolValue(row.ma_bullish_alignment),
        ma30: Number.isFinite(Number(row.ma30)) ? Number(row.ma30) : null,
        ma5_rising: boolValue(row.ma5_rising),
        ma10_rising: boolValue(row.ma10_rising),
        ma30_rising: boolValue(row.ma30_rising),
        ma35_rising: boolValue(row.ma35_rising),
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

async function syncIntradayStatusCache(intradayMap) {
  if (DRY_RUN || !intradayMap?.size) return { written: 0, skipped: true, reason: 'dry_run_or_empty' };
  const now = Date.now();
  if (now - lastIntradayStatusCacheSyncAt < INTRADAY_STATUS_CACHE_SYNC_INTERVAL_MS) {
    return { written: 0, skipped: true, reason: 'interval_cooldown' };
  }
  const rows = intradayStatusCacheRows(intradayMap);
  if (!rows.length) return { written: 0, skipped: true, reason: 'no_valid_rows' };
  try {
    const result = await supabaseUpsert(
      'fugle_daytrade_intraday_1m_status_cache',
      rows,
      'symbol',
      { batchSize: 250 },
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
  const prioritySymbols = new Set((priorityRows || []).map((row) => normalizeCode(row.symbol)).filter(Boolean));
  if (!prioritySymbols.size) return intradayMap;
  const quoteCache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  let merged = 0;
  if (envFlag("DAYTRADE_ALLOW_QUOTE_DERIVED_1M")) for (const quote of quoteCache.quotes.values()) {
    const symbol = normalizeCode(quote.symbol || quote.code);
    if (!symbol || !prioritySymbols.has(symbol)) continue;
    const seenAt = normalizeTimestamp(quote.quoteSeenAt || quote.updatedAt || quoteCache.payload?.updatedAt, "");
    if (!seenAt || ageSeconds(seenAt) > WINDOW_SECONDS) continue;
    const previous = intradayMap.get(symbol) || { symbol };
    const previousContinuous = numberValue(previous.continuous_candle_count ?? previous.candle_count);
    const previousToday = numberValue(previous.today_candle_count);
    const readyMa5 = boolValue(previous.ready_ma5) || previousContinuous >= 5;
    const readyMa10 = boolValue(previous.ready_ma10) || previousContinuous >= 10;
    const readyMa20 = boolValue(previous.ready_ma20_continuous) || previousContinuous >= 20;
    const readyMa30 = boolValue(previous.ready_ma30) || previousContinuous >= 30;
    const readyMa35 = boolValue(previous.ready_ma35_continuous) || boolValue(previous.ready_ge_35) || previousContinuous >= 35;
    intradayMap.set(symbol, {
      ...previous,
      symbol,
      latest_candle_time: seenAt,
      today_candle_count: Math.max(previousToday, 1),
      warmup_candle_count: Math.max(numberValue(previous.warmup_candle_count), previousContinuous, readyMa35 ? 35 : readyMa20 ? 20 : 1),
      continuous_candle_count: Math.max(previousContinuous, readyMa35 ? 35 : readyMa20 ? 20 : 1),
      ready_ma5: readyMa5,
      ready_ma10: readyMa10,
      ready_ma20_continuous: readyMa20,
      ready_ma30: readyMa30,
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
  const blocked = run?.publish_blocked === true
    || run?.publishBlocked === true
    || payload.publish_blocked === true
    || payload.publishBlocked === true
    || payload.fallbackUsed === true
    || payload.fallback_used === true
    || payload.preservePreviousGood === true
    || payload.preserve_previous_good === true;
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
    const top40Symbols = sourceSymbols.filter((symbol) => formalSet.has(symbol));
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
      top40SymbolCount: top40Symbols.length,
      top40Symbols,
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
    formalPriorityLimit: FORMAL_DAYTRADE_PRIORITY_LIMIT,
    formalPriorityCount: Array.isArray(formalPrioritySymbols) ? formalPrioritySymbols.length : 0,
    formalPrioritySymbols: Array.isArray(formalPrioritySymbols) ? formalPrioritySymbols : [],
    groups,
    counts: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, group.top40SymbolCount])),
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
      existing.daytradeFormalPrioritySymbols || existing.priorityTop40Symbols || [],
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
      bySymbol.set(symbol, prev);
    }
    counts[source] = accepted;
  };

  addMany("daytrade", payload.daytradePrioritySymbols || payload.daytradeSymbols || payload.daytrade, 120);
  addMany("terminal", payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, 100);
  addMany("opening", payload.openingPrioritySymbols || payload.primaryPrioritySymbols, 100);
  addMany("strategy2", payload.strategy2 || payload.strategy2Symbols || bridgeValues("strategy2"), 90);
  addMany("strategy3", payload.strategy3 || payload.strategy3Symbols || bridgeValues("strategy3"), 90);
  addMany("strategy4", payload.strategy4 || payload.strategy4Symbols || bridgeValues("strategy4"), 80);
  addMany("strategy5", payload.strategy5 || payload.strategy5Symbols || bridgeValues("strategy5"), 80);
  addMany("institution", payload.institution || payload.institutionSymbols || bridgeValues("institution"), 75);
  addMany("warrant", payload.warrant || payload.warrantSymbols || bridgeValues("warrant"), 70);
  addMany("cb", payload.cb || payload.cbSymbols || bridgeValues("cb"), 60);
  addMany("realtime_radar", payload.realtimeRadar || payload.realtimeRadarSymbols, 75);
  addMany("daytrade_hot", payload.hot || payload.daytradeHotSymbols || payload.priorityStrongSymbols, 75);
  addMany("symbols", payload.symbols, 10);

  return {
    symbols: [...bySymbol.values()],
    counts,
    updatedAt: payload.updatedAt || bridge.updatedAt || "",
    source: payload.source || bridge.source || "runtime_priority_file",
    strategyPriorityBridgeStatus: bridge.status || "missing",
    strategyPriorityBridgeUpdatedAt: bridge.updatedAt || "",
    strategyPriorityBridgeCounts: bridge.counts || {},
    strategyPriorityBridgeGroups: bridgeGroups,
  };
}

function buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap = new Map(), supplementalMaps = {}) {
  const activeBySymbol = new Map(activeSymbols.map((row) => [row.symbol, row]));
  supplementalMaps.activeBySymbol = activeBySymbol;
  const seeds = readRuntimePrioritySeeds(activeSymbols);
  const bySymbol = new Map();
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
  const rankingCandidates = [...qualifiedCandidates, ...pendingCandidates];
  const changeRanks = rankMap(rankingCandidates, (row) => row.metrics.changePercent, { minValue: 0 });
  const volumeSurgeRanks = rankMap(rankingCandidates, (row) => row.metrics.volumeRatio5, { minValue: 0 });
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
    let score = 0;

    score += Math.min(130, Math.log10(Math.max(1, metrics.avgVolume5)) * 30);
    score += topRankScore(changeRank, 120, 190);
    score += topRankScore(volumeSurgeRank, 120, 180);
    score += topRankScore(estimatedVolumeRank, 120, 180);
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
    if (metrics.estimatedVolumeRatioUsable && metrics.estimatedVolumeRatio >= 2) {
      score += 160;
      reasons.push("estimated_volume_ratio_gt2");
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
    if (metrics.estimatedVolumeRatioUsable && metrics.estimatedVolumeRatio >= 2 && metrics.totalVolume >= 10000 && volumeRank && volumeRank <= 100) {
      score += 210;
      reasons.push("estimated_volume_ratio_gt2_volume_rank_top100");
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
      score += 680;
      reasons.push(`turnover_3_5d_rank_top${turnoverRank}`);
    }
    if (metrics.stockFutureInitial0846Ok) {
      score += 170;
      reasons.push("stock_future_initial_0846_observe");
      if (String(metrics.stockFutureInitial0846.sourceStatus || "").toLowerCase() === "ready") {
        score += 30;
        reasons.push("stock_future_source_ready");
      }
    }
    if (groupLeader && metrics.price > 0 && (metrics.changePercent >= 1 || metrics.volumeRatio5 >= 1 || metrics.tradeValue >= 30000000)) {
      score += 155;
      reasons.push("strong_group_limit_up_leader");
    }
    if (metrics.changePercent > 0 && (metrics.foreignNet > 0 || metrics.trustNet > 0 || metrics.dealerNet > 0 || metrics.mainForceNet > 0)) {
      score += 100;
      reasons.push("institution_or_main_force_buy_price_strong");
    }
    if (metrics.changePercent > 0 && metrics.hasMargin3To5d && (metrics.marginChange3d < 0 || metrics.marginChange5d < 0 || metrics.marginChange3To5d < 0)) {
      score += 95;
      reasons.push("margin_down_3_5d_price_strong");
    }
    if (metrics.changePercent > 0 && metrics.hasMargin3To5d && (
      (metrics.marginChange3d > 0 && metrics.shortChange3d > 0)
      || (metrics.marginChange5d > 0 && metrics.shortChange5d > 0)
      || (metrics.marginChange3To5d > 0 && metrics.shortChange3To5d > 0)
    )) {
      score += 80;
      reasons.push("margin_short_both_up_3_5d_price_strong");
    }
    if (metrics.exDividend3To5d) {
      score -= 250;
      reasons.push("ex_dividend_3_5d_watch");
    } else if (metrics.exDividend) {
      score -= 160;
      reasons.push("exclude_ex_dividend_watch");
    }
    if (metrics.daytradeCrowded3To5d) {
      score -= 90;
      reasons.push("daytrade_crowded_3_5d_watch");
    } else if (metrics.daytradeCrowded) {
      score -= 60;
      reasons.push("daytrade_crowded_watch");
    }

    return {
      ...row,
      score,
      prioritySource: "dynamic_daytrade_mother_pool",
      priorityReason: reasons.length ? reasons.join("+") : "dynamic_liquidity_fill",
      priorityMetrics: {
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
        formalLiquidityEligible,
        formalLiquidityRejectReason,
        changeRank,
        volumeSurgeRank,
        estimatedVolumeRank,
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
        fieldCoverage: metrics.fieldCoverage,
        ruleHits: reasons,
        basePoolEligible: row.basePool.eligible,
        basePoolPending: row.basePool.pending,
        basePoolFailedChecks: row.basePool.failedChecks,
        basePoolPendingChecks: row.basePool.pendingChecks,
      },
    };
  }).sort((a, b) => Number(b.metrics?.quoteFresh === true) - Number(a.metrics?.quoteFresh === true) || b.score - a.score || a.symbol.localeCompare(b.symbol));

  for (const row of rankedCandidates) {
    if (bySymbol.size >= MOTHER_POOL_MAX_SYMBOLS) break;
    if (!row.formalLiquidityEligible) continue;
    bySymbol.set(row.symbol, {
      ...row,
      score: row.score,
      prioritySource: row.prioritySource,
      priorityReason: row.priorityReason,
    });
  }
  const rankedBySymbol = new Map(rankedCandidates.map((row) => [row.symbol, row]));
  for (const seed of seeds.symbols) {
    const row = rankedBySymbol.get(seed.symbol);
    if (!row || !row.formalLiquidityEligible) continue;
    const prev = bySymbol.get(seed.symbol);
    if (!prev) {
      // Runtime seeds may boost a candidate already selected in the warming
      // pool. They cannot bypass the ordinary-stock filter or fill excluded rows.
      continue;
    }
    prev.score += seed.score;
    prev.prioritySource = `${prev.prioritySource},${seed.sources.join(",")}`;
    prev.priorityReason = `${prev.priorityReason}+runtime_priority`;
  }

  const rows = [...bySymbol.values()]
    .sort((a, b) => Number(b.metrics?.quoteFresh === true) - Number(a.metrics?.quoteFresh === true) || b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, MOTHER_POOL_MAX_SYMBOLS);
  const priorityUpdatedAt = nowIso();
  const output = rows.map((row, index) => ({
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
        consumerScope: ["daytrade", "strategy3"],
        motherPoolRuleVersion: "daytrade_mother_pool_base_filter_20260731_max600",
        motherPoolMetrics: row.priorityMetrics || {},
        motherPoolRuleHits: row.priorityMetrics?.ruleHits || [],
        basePoolEligible: row.priorityMetrics?.basePoolEligible === true,
        basePoolPending: row.priorityMetrics?.basePoolPending === true,
        runtimePrioritySource: seeds.source,
        runtimePriorityUpdatedAt: seeds.updatedAt,
        runtimePriorityCounts: seeds.counts,
      },
    }));
  output.basePoolMeta = {
    activeSymbols: candidates.length,
    basePoolEligibleSymbols: qualifiedCandidates.length,
    basePoolPendingSymbols: pendingCandidates.length,
    basePoolExcludedSymbols: Math.max(0, candidates.length - qualifiedCandidates.length - pendingCandidates.length),
    minimumSymbols: MOTHER_POOL_MIN_SYMBOLS,
    maximumSymbols: MOTHER_POOL_MAX_SYMBOLS,
    ruleVersion: "daytrade_mother_pool_base_filter_20260731_max600",
    failureCounts: basePoolFailureCounts,
    pendingCounts: basePoolPendingCounts,
  };
  return output;
}

function publishDaytradePrioritySymbols(priorityRows) {
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
  const daytradeMotherPoolSymbols = priorityRows
    .map((row) => normalizeCode(row.symbol))
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, MOTHER_POOL_MAX_SYMBOLS);
  const daytradePrioritySymbols = daytradeMotherPoolSymbols.slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  const formalPriorityStrategyChip = buildFormalStrategyChipArtifact(
    bridgePayload,
    daytradePrioritySymbols,
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
    // Formal entry remains explicitly limited to the first top40 rows below.
    daytradeMotherPoolSymbols,
    daytradeMotherPoolCount: daytradeMotherPoolSymbols.length,
    daytradePrioritySymbols: daytradeMotherPoolSymbols,
    daytradePriorityCount: daytradeMotherPoolSymbols.length,
    daytradeFormalPrioritySymbols: daytradePrioritySymbols,
    daytradeFormalPriorityCount: daytradePrioritySymbols.length,
    formalPriorityStrategyChip,
    terminalPrioritySymbols: prependUnique(daytradeMotherPoolSymbols, existing.terminalPrioritySymbols || existing.terminalSymbols || existing.terminalPriority),
    openingPrioritySymbols: prependUnique(daytradeMotherPoolSymbols, existing.openingPrioritySymbols || existing.primaryPrioritySymbols),
    symbols: prependUnique(daytradeMotherPoolSymbols, existing.symbols),
  };
  const sameSymbols = JSON.stringify(existing.symbols || []) === JSON.stringify(nextPriorityPayload.symbols || []);
  const samePriorityCounts = Number(existing.daytradeMotherPoolCount || 0) === nextPriorityPayload.daytradeMotherPoolCount
    && Number(existing.daytradeFormalPriorityCount || 0) === nextPriorityPayload.daytradeFormalPriorityCount;
  const bridgeChanged = Object.keys(bridgeFields).some((key) => JSON.stringify(existing[key]) !== JSON.stringify(bridgeFields[key]));
  const formalPriorityArtifactChanged = JSON.stringify(existing.formalPriorityStrategyChip || {}) !== JSON.stringify(formalPriorityStrategyChip);
  if (!sameSymbols || !samePriorityCounts || bridgeChanged || formalPriorityArtifactChanged) {
    writeJson(PRIORITY_SYMBOLS_FILE, nextPriorityPayload);
    writeFugleWebSocketSymbols(nextPriorityPayload.symbols, {
      source: "daytrade-dedicated-priority-bridge",
      prioritySource: "daytrade-dedicated-priority-bridge",
      daytradePriorityCount: daytradeMotherPoolSymbols.length,
      daytradeMotherPoolCount: daytradeMotherPoolSymbols.length,
      daytradeFormalPriorityCount: daytradePrioritySymbols.length,
      terminalPriorityCount: nextPriorityPayload.terminalPrioritySymbols.length,
      openingPriorityCount: nextPriorityPayload.openingPrioritySymbols.length,
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
  const strategy2 = countPriorityValues(payload.strategy2 || payload.strategy2Symbols, universe);
  const strategy3 = countPriorityValues(payload.strategy3 || payload.strategy3Symbols, universe);
  const strategy4 = countPriorityValues(payload.strategy4 || payload.strategy4Symbols, universe);
  const strategy5 = countPriorityValues(payload.strategy5 || payload.strategy5Symbols, universe);
  const institution = countPriorityValues(payload.institution || payload.institutionSymbols, universe);
  const warrant = countPriorityValues(payload.warrant || payload.warrantSymbols, universe);
  const cb = countPriorityValues(payload.cb || payload.cbSymbols, universe);
  const realtimeRadar = countPriorityValues(payload.realtimeRadar || payload.realtimeRadarSymbols, universe);
  const formalPriorityStrategyChip = objectPayload(payload.formalPriorityStrategyChip);
  const strategyChipCompleteLatestRun = formalPriorityStrategyChip.schemaVersion === 'daytrade-formal-priority-strategy-chip-v1'
    && formalPriorityStrategyChip.status === 'ready'
    && numberValue(formalPriorityStrategyChip.formalPriorityLimit) === FORMAL_DAYTRADE_PRIORITY_LIMIT
    && numberValue(formalPriorityStrategyChip.formalPriorityCount) === FORMAL_DAYTRADE_PRIORITY_LIMIT
    && formalPriorityStrategyChip.completeLatestRunEvidence === true;
  return {
    source: payload.source || "",
    updatedAt: payload.updatedAt || "",
    daytrade: countPriorityValues(payload.daytradePrioritySymbols || payload.daytradeSymbols || payload.daytrade, universe),
    terminal: countPriorityValues(payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, universe),
    opening: countPriorityValues(payload.openingPrioritySymbols || payload.primaryPrioritySymbols, universe),
    strategy2,
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
    strategyPriority: strategy2 + strategy3 + strategy4 + strategy5 + institution + warrant + cb + realtimeRadar,
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
    authenticatedAt: status.authenticatedAt || "",
    authenticationCount: numberValue(status.authenticationCount),
    subscriptionAckCount: numberValue(status.subscriptionAckCount),
    subscriptionAckExpected: numberValue(status.subscriptionAckExpected),
    subscriptionAckChannels: Array.isArray(status.subscriptionAckChannels) ? status.subscriptionAckChannels : [],
    subscriptionAckReady: Boolean(status.subscriptionAckReady),
    intradayOddLot: status.intradayOddLot === false ? false : null,
    subscriptionMode: status.subscriptionMode || "",
    lastMessageAt: status.lastMessageAt || "",
    lastCandleTime: status.lastCandleTime || "",
    subscribed: numberValue(status.subscribed),
    subscribedSymbols: numberValue(status.subscribedSymbols),
    subscribedChannels: numberValue(status.subscribedChannels),
    streamingMessages: numberValue(status.streamingMessages),
    streamingQuotes: numberValue(status.streamingQuotes),
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
  const runtimePriority = readRuntimePrioritySummary(activeSymbols);
  const strategyChipCompleteLatestRun = runtimePriority.strategyChipCompleteLatestRun === true;
  const strategyChipReason = runtimePriority.strategyChipCompleteLatestRunReason || 'formal_priority_strategy_chip_missing_or_incomplete';
  const webSocketStatus = readWebSocketStatusSummary();
  const formalPriorityRows = priorityRows.slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  const minFormalPrioritySymbols = Math.min(MIN_PRIORITY_POOL_SYMBOLS, FORMAL_DAYTRADE_PRIORITY_LIMIT);
  const quoteTransport = webSocketStatus.mode === "streaming"
    ? `websocket_${(webSocketStatus.streamingChannel || "streaming").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
    : "rest_quote";
  const after0830 = ["preopen_prepare_0830_0844", "opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0845 = ["opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0900 = ["opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const opening0901Required = after0900 && taipeiMinutes() >= (9 * 60 + 2);

  for (const row of fetchedRows) quoteMap.set(row.symbol, row);
  const activeSet = new Set(activeSymbols.map((row) => row.symbol));
  const prioritySet = new Set(formalPriorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol)));
  const freshFull = [];
  const freshPriority = [];
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

  const priorityPoolSymbols = prioritySet.size;
  const motherPoolSet = new Set(priorityRows.map((row) => normalizeCode(row.symbol)).filter((symbol) => activeSet.has(symbol)));
  const freshMother = freshFull.filter((symbol) => motherPoolSet.has(symbol));
  const motherPoolSymbols = motherPoolSet.size;
  const activeCount = activeSet.size;
  const freshQuoteCoverage = activeCount ? freshFull.length / activeCount : 0;
  const priorityFreshCoverage = priorityPoolSymbols ? freshPriority.length / priorityPoolSymbols : 0;
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
  const warmupEvidence = readWarmupNaturalEvidenceCounts();
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
  const actualQuoteSpeed = fetchResult.elapsedSeconds ? Number((fetchResult.fetched / fetchResult.elapsedSeconds).toFixed(4)) : 0;
  const scannerCanRunQuoteOnly = selectedSymbolsFreshOk && rateLimitStatus === "ok";
  const effectiveMa20Required = Math.min(MIN_READY_MA20_CONTINUOUS, Math.max(minFormalPrioritySymbols, priorityPoolSymbols || minFormalPrioritySymbols));
  const effectiveMa35Required = Math.min(MIN_READY_MA35_CONTINUOUS, Math.max(minFormalPrioritySymbols, priorityPoolSymbols || minFormalPrioritySymbols));
  const scannerCanRunOpening = scannerCanRunQuoteOnly
    && dailyVolumeStatus === "ready"
    && readyMa20 >= effectiveMa20Required
    && (!REQUIRE_MA35_FOR_FORMAL_DAYTRADE || readyMa35 >= effectiveMa35Required)
    && (!REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE || !after0845 || futoptMapped >= MIN_FUTOPT_MAPPED)
    && (!REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE || !after0845 || futoptGateReady)
    && (!after0900 || intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS)
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
  const openingBoostScope = openingBoostActive ? "priority_top40" : "inactive";
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
  if (!offSession && motherPoolSymbols < MOTHER_POOL_MIN_SYMBOLS) failedChecks.push('mother_pool_below_min_300');
  // Mother pool is a rotating discovery layer. Low freshness is reported as health evidence,
  // but formal entry is gated by priority_top40 + 1m + daily + optional futopt.
  const motherPoolFreshnessWarning = !offSession && motherFreshCoverage < 0.8;
  if (!offSession && priorityPoolSymbols < minFormalPrioritySymbols) failedChecks.push('priority_top40_below_40');
  if (!offSession && priorityFreshCoverage < MIN_PRIORITY_FRESH_COVERAGE) failedChecks.push('priority_top40_fresh_coverage_below_095');
  if (!offSession && after0845 && !strategyChipCompleteLatestRun) failedChecks.push('strategy_chip_complete_latest_run_missing');
  if (!offSession && latestQuoteAge > MAX_QUOTE_AGE_SECONDS) failedChecks.push('quote_stale');
  if (!offSession && dailyVolumeStatus !== 'ready') failedChecks.push('daily_volume_not_ready');
  if (!offSession && after0900 && intraday1mStaleSeconds > MAX_INTRADAY_1M_STALE_SECONDS) failedChecks.push('intraday_1m_not_ready');
  if (!offSession && opening0901HardRequired && !opening0901GateOk) failedChecks.push('opening_0901_candle_not_ready');
  if (!offSession && REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE && after0845 && futoptMapped < MIN_FUTOPT_MAPPED) failedChecks.push('futopt_stock_mapping_not_ready');
  if (!offSession && REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE && after0845 && !futoptGateReady) failedChecks.push('futopt_gate_not_ready');
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
  const formalPrioritySpeedOk = priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && priorityPoolSymbols >= minFormalPrioritySymbols;
  const payload = {
    source_name: SOURCE_NAME,
    writer_version: "daytrade-source-writer-20260702-03",
    daytrade_gate_grade: gateGrade,
    gate_grade: offSession ? "D" : gateGrade,
    gate_status: gateGrade === "A" ? "ready" : "not_ready",
    formal_entry_speed_verdict: gateGrade === "A" ? "YES" : "NO",
    daytrade_source_speed_ok: gateGrade === "A",
    gate_mode: "priority_first",
    formal_gate_scope: "mother_pool_rotation_priority_top40",
    formal_scan_scope: "mother_pool_300_600_rotation",
    mother_pool_scan_min_symbols: MOTHER_POOL_MIN_SYMBOLS,
    mother_pool_scan_max_symbols: MOTHER_POOL_MAX_SYMBOLS,
    formal_source_name: SOURCE_NAME,
    formal_gate_source: "source_status.payload+v_fugle_daytrade_canonical_gate",
    formal_quote_source: "fugle_daytrade_quotes_live",
    formal_intraday_1m_source: intraday1mReadinessSource,
    quote_source_daytrade_ok: quoteSourceDaytradeOk,
    intraday_1m_source_daytrade_ok: intraday1mSourceDaytradeOk,
    formal_source_alignment_ok: formalSourceAlignmentOk,
    reason_code: reasonCode,
    failed_checks: failedChecks,
    base_pool_eligible_symbols: priorityRows.basePoolMeta?.basePoolEligibleSymbols || motherPoolSymbols,
    base_pool_pending_symbols: priorityRows.basePoolMeta?.basePoolPendingSymbols || 0,
    base_pool_shortfall: Math.max(0, MOTHER_POOL_MIN_SYMBOLS - (priorityRows.basePoolMeta?.basePoolEligibleSymbols || motherPoolSymbols)),
    formal_priority_speed_ok: formalPrioritySpeedOk,
    full_market_speed_ok: fullMarketGateA,
    full_market_speed_blocking: false,
    mother_pool_freshness_warning: motherPoolFreshnessWarning,
    mother_pool_freshness_blocking: false,
    futopt_formal_required: REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE,
    gate_speed_ok: formalPrioritySpeedOk,
    quote_speed_scope: "full_market_scorecard_nonblocking",
    formal_speed_scope: "priority_top40",
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
    quote_transport: quoteTransport,
    websocket_status_ok: webSocketStatus.ok,
    websocket_mode: webSocketStatus.mode,
    websocket_channel: webSocketStatus.channel,
    websocket_streaming_channel: webSocketStatus.streamingChannel,
    websocket_streaming_channels: webSocketStatus.streamingChannels,
    websocket_connected: webSocketStatus.connected,
    websocket_authenticated: webSocketStatus.authenticated,
    websocket_authenticated_at: webSocketStatus.authenticatedAt,
    websocket_authentication_count: webSocketStatus.authenticationCount,
    websocket_subscription_ack_count: webSocketStatus.subscriptionAckCount,
    websocket_subscription_ack_expected: webSocketStatus.subscriptionAckExpected,
    websocket_subscription_ack_channels: webSocketStatus.subscriptionAckChannels,
    websocket_subscription_ack_ready: webSocketStatus.subscriptionAckReady,
    websocket_intraday_odd_lot: webSocketStatus.intradayOddLot,
    websocket_subscription_mode: webSocketStatus.subscriptionMode,
    websocket_last_message_at: webSocketStatus.lastMessageAt,
    websocket_last_candle_time: webSocketStatus.lastCandleTime,
    websocket_subscribed: webSocketStatus.subscribed,
    websocket_subscribed_symbols: webSocketStatus.subscribedSymbols,
    websocket_subscribed_channels: webSocketStatus.subscribedChannels,
    websocket_streaming_messages: webSocketStatus.streamingMessages,
    websocket_streaming_quotes: webSocketStatus.streamingQuotes,
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
    strategy2_priority_symbols: runtimePriority.strategy2,
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
    formal_priority_strategy_chip_blocks_formal_entry: !strategyChipCompleteLatestRun,
    formal_priority_strategy_chip_reason: strategyChipReason,
    realtime_radar_priority_symbols: runtimePriority.realtimeRadar,
    batch_size: BATCH_SIZE,
    batch_interval_seconds: TARGET_BATCH_INTERVAL_SECONDS,
    priority_symbols: priorityPoolSymbols,
    priority_pool_symbols: priorityPoolSymbols,
    formal_scope: "mother_pool_rotation_priority_top40",
    opening_boost_active: openingBoostActive,
    opening_boost_effective: openingBoostEffective,
    opening_boost_scope: openingBoostScope,
    opening_boost_reason: openingBoostReason,
    mother_pool_rule_version: "daytrade_mother_pool_base_filter_20260731_max600",
    mother_pool_symbols: priorityRows.length,
    mother_pool_fresh_coverage_120s: Number(motherFreshCoverage.toFixed(4)),
    mother_pool_fresh_quotes_120s: freshMother.length,
    mother_pool_source: "dynamic_daytrade_mother_pool",
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
    mother_pool_field_coverage_counts: motherFieldCoverageCounts,
    formal_daytrade_priority_limit: FORMAL_DAYTRADE_PRIORITY_LIMIT,
    formal_daytrade_priority_symbols: priorityPoolSymbols,
    priority_fresh_quotes_120s: freshPriority.length,
    priority_fresh_quote_coverage_120s: Number(priorityFreshCoverage.toFixed(4)),
    priority_top40_symbols: priorityPoolSymbols,
    priority_top40_fresh_quotes_120s: freshPriority.length,
    priority_top40_fresh_quote_coverage_120s: Number(priorityFreshCoverage.toFixed(4)),
    formal_scan_pool_symbols: motherPoolSymbols,
    mother_pool_fresh_quotes_120s: freshMother.length,
    mother_pool_fresh_coverage_120s: Number(motherFreshCoverage.toFixed(4)),
    mother_pool_base_pool_symbols: priorityRows.basePoolMeta?.basePoolEligibleSymbols || 0,
    mother_pool_base_pool_pending_symbols: priorityRows.basePoolMeta?.basePoolPendingSymbols || 0,
    mother_pool_base_pool_excluded_symbols: priorityRows.basePoolMeta?.basePoolExcludedSymbols || 0,
    mother_pool_base_pool_failure_counts: priorityRows.basePoolMeta?.failureCounts || {},
    mother_pool_base_pool_pending_counts: priorityRows.basePoolMeta?.pendingCounts || {},
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
    ma20_warmup_status: ma20WarmupStatus,
    ma35_warmup_status: ma35WarmupStatus,
    ready_ma20_continuous: readyMa20,
    ready_ma35_continuous: readyMa35,
    ready_ma20_required: effectiveMa20Required,
    ready_ma35_required: effectiveMa35Required,
    intraday_1m_stale_seconds: intraday1mStaleSeconds,
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
    off_session: offSession,
    formal_entry_allowed: !offSession && after0845 && gateGrade === "A" && webSocketStatus.formalReady,
    latest_update_allowed: !offSession && after0845 && gateGrade === "A" && webSocketStatus.formalReady,
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
    && (!values.after0845 || values.motherPoolSymbols >= MOTHER_POOL_MIN_SYMBOLS)
    && true
    && values.priorityPoolSymbols >= (values.minPriorityPoolSymbols || MIN_PRIORITY_POOL_SYMBOLS)
    && values.quoteAgeSeconds <= MAX_QUOTE_AGE_SECONDS
    && values.cooldownRemaining <= 0
    && values.last429AgeSeconds > RECENT_429_BLOCK_SECONDS
    && (!values.after0830 || values.dailyVolumeStatus === "ready")
    && (!values.after0845 || values.scannerCanRunOpening)
    && (!values.after0845 || values.strategyChipCompleteLatestRun === true)
    && (!values.after0845 || values.readyMa20 >= (values.effectiveMa20Required || MIN_READY_MA20_CONTINUOUS))
    && (!values.after0845 || !REQUIRE_MA35_FOR_FORMAL_DAYTRADE || values.readyMa35 >= (values.effectiveMa35Required || MIN_READY_MA35_CONTINUOUS))
    && (!REQUIRE_FUTOPT_FOR_FORMAL_DAYTRADE || !values.after0845 || values.futoptMapped >= MIN_FUTOPT_MAPPED)
    && (!values.after0900 || values.intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);
}

async function writeStatusAndScorecard(result) {
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
  const requiredSymbols = [...new Set((formalPriorityRows || []).slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT)
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
      source_channel: "candles",
      candle_origin: "websocket_candle",
      synthetic: false,
      volume_strategy_usable: true,
      websocket_row: true,
      rest_repair_row: false,
      intraday_odd_lot: false,
      updated_at: candle.candleSeenAt || cache.payload?.updatedAt || nowIso(),
      payload: {
        ...(candle.payload || {}),
        cacheUpdatedAt: cache.payload?.updatedAt || "",
        source: "fugle-websocket-candles-cache",
        source_channel: "candles",
        candle_origin: "websocket_candle",
        synthetic: false,
        volume_strategy_usable: true,
        websocket_row: true,
        rest_repair_row: false,
        intradayOddLot: false,
      },
    });
  }
  const quoteCache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  const rowKeys = new Set(rows.map((row) => `${row.symbol}|${row.candle_time}`));
  const candleRowCount = rows.length;
  if (envFlag("DAYTRADE_ALLOW_QUOTE_DERIVED_1M")) for (const quote of quoteCache.quotes.values()) {
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
      source_channel: "aggregates",
      candle_origin: "quote_derived_disallowed",
      synthetic: false,
      volume_strategy_usable: false,
      websocket_row: false,
      rest_repair_row: false,
      intraday_odd_lot: false,
      updated_at: seenAt,
      payload: {
        ...(quote.payload || {}),
        quoteSeenAt: seenAt,
        cacheUpdatedAt: quoteCache.payload?.updatedAt || "",
        source: "fugle-websocket-quote-derived-current-1m",
        source_channel: "aggregates",
        candle_origin: "quote_derived_disallowed",
        synthetic: false,
        volume_strategy_usable: false,
        websocket_row: false,
        rest_repair_row: false,
        intradayOddLot: false,
      },
    });
  }
  if (!rows.length) return { written: 0, skipped: true, cacheCount: cache.candles.size, quoteDerivedCount: 0 };
  await supabaseUpsert("fugle_daytrade_intraday_1m", rows, "symbol,candle_time", { batchSize: 40 });
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
  await supabaseUpsert("fugle_daytrade_futopt_quotes_live", rows, "future_symbol", { batchSize: 80 });
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
  const fetchAllowedForPhase = quoteFetchAllowedForPhase(phase);
  const fetchPriorityOnlyForPhase = quoteFetchPriorityOnlyForPhase(phase);
  const activeSymbols = await fetchActiveSymbols();
  await refreshStrategyChipPriorityBridge();
  const dailyVolumeMap = await fetchDailyVolumeAvg();
  const quoteMap = await fetchExistingDaytradeQuotes();
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
  intradayMap = mergeWebSocketQuoteDerivedIntradayStatus(intradayMap, priorityRows);
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
      publishDaytradePrioritySymbols(priorityRows);
    } catch (error) {
      nonFatalWriteErrors.push({
        target: "fugle-ws-priority-symbols.json",
        message: error?.message || String(error),
      });
    }
    try {
      await supabaseUpsert("fugle_daytrade_priority_pool", priorityRows, "symbol", { batchSize: 40 });
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

  if (priorityRows.length && taipeiMinutes() >= (9 * 60 + 2)) {
    try {
      opening0901Evidence = await ensureOpening0901CandleEvidence(priorityRows);
    } catch (error) {
      opening0901Evidence = { required: true, ready: false, source: "dedicated_daytrade_1m_0901_unhandled_error", rows: 0, symbols: [], missingSymbols: priorityRows.slice(0, FORMAL_DAYTRADE_PRIORITY_LIMIT).map((row) => row.symbol), schema: [], error: error?.message || String(error) };
    }
  }
  const intradayStatusCacheSync = await syncIntradayStatusCache(intradayMap);
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
    const rebuiltPriorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap, quoteMap, supplementalMaps);
    if (rebuiltPriorityRows.length) {
      priorityRows = rebuiltPriorityRows;
      try {
        // Persist the post-fetch rebuild so the canonical mother-pool view sees
        // the same fresh quote timestamps used by source_status.payload.
        publishDaytradePrioritySymbols(priorityRows);
        await supabaseUpsert("fugle_daytrade_priority_pool", priorityRows, "symbol", { batchSize: 40 });
        await supabaseDelete(
          "fugle_daytrade_priority_pool",
          "updated_at=lt." + encodeURIComponent(priorityRows[0].updated_at),
        );
      } catch (error) {
        fetchResult.errors.push({ target: "fugle_daytrade_priority_pool_rebuild", message: error?.message || String(error) });
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
    motherPoolMinSymbols: MOTHER_POOL_MIN_SYMBOLS,
    motherPoolMaxSymbols: MOTHER_POOL_MAX_SYMBOLS,
    motherPoolRuleVersion: result.payload.mother_pool_rule_version,
    motherPoolRuleHitCounts: result.payload.mother_pool_rule_hit_counts,
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
  console.error(JSON.stringify({
    ok: false,
    sourceName: SOURCE_NAME,
    mode: APPLY ? "apply" : "dry-run",
    error: error.message || String(error),
    checkedAt: nowIso(),
  }, null, 2));
  process.exit(1);
});
