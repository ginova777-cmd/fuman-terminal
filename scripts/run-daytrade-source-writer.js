const fs = require("fs");
const path = require("path");
const { runtimePath, cachePath, statePath, repoPath } = require("./runtime-paths");

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
const FETCH_ENABLED = !NO_FETCH && (APPLY || hasFlag("fetch") || envFlag("FUMAN_DAYTRADE_WRITER_FETCH"));
const ONCE = hasFlag("once") || envFlag("FUMAN_DAYTRADE_WRITER_ONCE");

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
const BATCH_SIZE = positiveNumber(CONFIG.collector?.quoteBatchSize, 40);
const CONCURRENCY = Math.max(1, Math.min(4, positiveNumber(CONFIG.collector?.quoteConcurrency, 1)));
const TARGET_BATCH_INTERVAL_SECONDS = positiveNumber(CONFIG.collector?.targetBatchIntervalSeconds, 3.2);
const REQUEST_DELAY_MS = Math.max(0, Math.floor((TARGET_BATCH_INTERVAL_SECONDS * 1000) / Math.max(1, BATCH_SIZE)));
const COOLDOWN_INITIAL_SECONDS = positiveNumber(CONFIG.collector?.cooldownInitialSeconds, 90);
const COOLDOWN_MAX_SECONDS = positiveNumber(CONFIG.collector?.cooldownMaxSeconds, 900);
const RECENT_429_BLOCK_SECONDS = positiveNumber(CONFIG.rateLimitGate?.recent429BlocksASeconds, 90);
const FULL_MARKET_PAUSE_MIN_SECONDS = positiveNumber(CONFIG.rateLimitGate?.pauseFullMarketAfter429SecondsMin, 60);
const FULL_MARKET_PAUSE_MAX_SECONDS = positiveNumber(CONFIG.rateLimitGate?.pauseFullMarketAfter429SecondsMax, 180);
const MAX_INTRADAY_1M_STALE_SECONDS = positiveNumber(CONFIG.intraday1m?.maxStaleSeconds, 120);
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

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    "preopen_prepare_0830_0844",
    "opening_boost_0845_0859",
    "opening_detection_0900_0934",
    "regular_daytrade_0935_1330",
  ].includes(phase);
}

function quoteFreshnessTime(quote) {
  return quote?.updated_at || quote?.last_trade_time || quote?.quote_seen_at || "";
}

function ageSeconds(value, fallback = 999999) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return fallback;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
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
    signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
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
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
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
      signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${resource} upsert HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    written += chunk.length;
  }
  return { written };
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
      signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
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
  return {
    cursor: Math.max(0, Number(state.cursor || 0)),
    last429At: state.last429At || "",
    cooldownUntil: state.cooldownUntil || "",
    priorityOnlyUntil: state.priorityOnlyUntil || "",
    consecutive429Count: Math.max(0, Number(state.consecutive429Count || 0)),
    selfHealCount: Math.max(0, Number(state.selfHealCount || 0)),
    lastSelfHealAt: state.lastSelfHealAt || "",
    lastSelfHealReason: state.lastSelfHealReason || "",
    lastSelfHealAction: state.lastSelfHealAction || "",
    intradayMirrorCursor: Math.max(0, Number(state.intradayMirrorCursor || 0)),
  };
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
  try {
    const rows = await supabaseGetPaged(
      "fugle_daytrade_quotes_live",
      "select=symbol,quote_seen_at,updated_at,last_trade_time,price,total_volume,trade_value&order=symbol.asc",
      { service: true },
    );
    return new Map(rows.map((row) => [normalizeCode(row.symbol), row]).filter(([symbol]) => symbol));
  } catch {
    return new Map();
  }
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
      "select=symbol,latest_candle_time,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma20_continuous,ready_ma35_continuous,latest_candle_age_seconds&order=symbol.asc",
      { service: true },
    );
    if (rows.length) return toMap(rows, "dedicated_daytrade_intraday_1m");
  } catch {
    // Dedicated daytrade source must not borrow shared-source readiness.
    return toMap([], "missing_intraday_1m_status");
  }
  return toMap([], "missing_intraday_1m_status");
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

  addMany("terminal", payload.terminalPrioritySymbols || payload.terminalSymbols || payload.terminalPriority, 100);
  addMany("opening", payload.openingPrioritySymbols || payload.primaryPrioritySymbols, 100);
  addMany("strategy1", payload.strategy1 || payload.strategy1Symbols, 90);
  addMany("strategy3", payload.strategy3 || payload.strategy3Symbols, 90);
  addMany("daytrade_hot", payload.hot || payload.daytradeHotSymbols || payload.priorityStrongSymbols, 75);
  addMany("symbols", payload.symbols, 10);

  return {
    symbols: [...bySymbol.values()],
    counts,
    updatedAt: payload.updatedAt || "",
    source: payload.source || "runtime_priority_file",
  };
}

function buildPriorityPool(activeSymbols, dailyVolumeMap) {
  const activeBySymbol = new Map(activeSymbols.map((row) => [row.symbol, row]));
  const seeds = readRuntimePrioritySeeds(activeSymbols);
  const bySymbol = new Map();
  for (const seed of seeds.symbols) {
    const row = activeBySymbol.get(seed.symbol);
    if (!row) continue;
    bySymbol.set(seed.symbol, {
      ...row,
      score: seed.score,
      prioritySource: seed.sources.join(","),
      priorityReason: "runtime_priority",
    });
  }

  const volumeRanked = [...activeSymbols]
    .map((row) => ({
      ...row,
      avgVolume5: dailyVolumeMap.get(row.symbol)?.avg_volume5 || 0,
    }))
    .sort((a, b) => b.avgVolume5 - a.avgVolume5 || a.symbol.localeCompare(b.symbol));

  for (const row of volumeRanked) {
    if (bySymbol.size >= MAX_PRIORITY_POOL_SYMBOLS) break;
    if (bySymbol.has(row.symbol)) continue;
    bySymbol.set(row.symbol, {
      ...row,
      score: row.avgVolume5 || 1,
      prioritySource: row.avgVolume5 > 0 ? "avg_volume5_fill" : "active_symbol_fill",
      priorityReason: row.avgVolume5 > 0 ? "fill_priority_pool_by_avg_volume5" : "fill_priority_pool_by_active_symbol",
    });
  }

  const rows = [...bySymbol.values()]
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, MAX_PRIORITY_POOL_SYMBOLS)
    .map((row, index) => ({
      symbol: row.symbol,
      name: row.name || row.symbol,
      market: row.market || "",
      priority_rank: index + 1,
      priority_reason: row.priorityReason || "",
      source: row.prioritySource || "unknown",
      updated_at: nowIso(),
      payload: {
        score: numberValue(row.score),
        selected: true,
        consumerScope: ["daytrade", "strategy1", "strategy3"],
        runtimePrioritySource: seeds.source,
        runtimePriorityUpdatedAt: seeds.updatedAt,
        runtimePriorityCounts: seeds.counts,
      },
    }));
  return rows;
}

function selectFetchBatch(activeSymbols, priorityRows, quoteMap, state) {
  const active = activeSymbols.map((row) => row.symbol);
  const activeSet = new Set(active);
  const priority = priorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol));
  const priorityOnly = futureSeconds(state.priorityOnlyUntil) > 0 || futureSeconds(state.cooldownUntil) > 0;
  const stale = (symbol, maxAge = WINDOW_SECONDS) => ageSeconds(quoteFreshnessTime(quoteMap.get(symbol))) > maxAge;
  const selected = [];
  const selectedSet = new Set();
  const add = (symbol) => {
    if (!symbol || selectedSet.has(symbol) || !activeSet.has(symbol) || selected.length >= BATCH_SIZE) return;
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
  const quoteTime = payload?.lastUpdated || payload?.lastTrade?.time || null;
  return {
    symbol: code,
    name: payload?.name || code,
    market: payload?.market || payload?.exchange || "",
    updated_at: quoteTime || quoteSeenAt,
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
    last_trade_time: payload?.lastTrade?.time || payload?.lastUpdated || null,
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

function computeStats({ activeSymbols, priorityRows, quoteMap, fetchedRows, dailyVolumeMap, intradayMap, futoptRows, fetchResult, state }) {
  const phase = phaseNow();
  const after0830 = ["preopen_prepare_0830_0844", "opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0845 = ["opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0900 = ["opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);

  for (const row of fetchedRows) quoteMap.set(row.symbol, row);
  const activeSet = new Set(activeSymbols.map((row) => row.symbol));
  const prioritySet = new Set(priorityRows.map((row) => row.symbol).filter((symbol) => activeSet.has(symbol)));
  const freshFull = [];
  const freshPriority = [];
  const quoteAges = [];
  const priorityAges = [];
  for (const symbol of activeSet) {
    const quote = quoteMap.get(symbol);
    const quoteAge = ageSeconds(quoteFreshnessTime(quote));
    if (quote) quoteAges.push(quoteAge);
    if (quoteAge <= WINDOW_SECONDS) freshFull.push(symbol);
  }
  for (const symbol of prioritySet) {
    const quote = quoteMap.get(symbol);
    const quoteAge = ageSeconds(quoteFreshnessTime(quote));
    if (quote) priorityAges.push(quoteAge);
    if (quoteAge <= WINDOW_SECONDS) freshPriority.push(symbol);
  }

  const priorityPoolSymbols = prioritySet.size;
  const activeCount = activeSet.size;
  const freshQuoteCoverage = activeCount ? freshFull.length / activeCount : 0;
  const priorityFreshCoverage = priorityPoolSymbols ? freshPriority.length / priorityPoolSymbols : 0;
  const priorityMaxAge = priorityAges.length ? Math.max(...priorityAges) : 999999;
  const latestQuoteAge = quoteAges.length ? Math.min(...quoteAges) : 999999;
  const selectedSymbolsFreshOk = priorityPoolSymbols >= MIN_PRIORITY_POOL_SYMBOLS
    && priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && priorityMaxAge <= SELECTED_SYMBOL_MAX_AGE_SECONDS;

  let avgVolume5Eligible = 0;
  for (const symbol of prioritySet) {
    if ((dailyVolumeMap.get(symbol)?.avg_volume5 || 0) > 0) avgVolume5Eligible += 1;
  }
  const dailyVolumeStatus = avgVolume5Eligible >= Math.min(MIN_PRIORITY_POOL_SYMBOLS, priorityPoolSymbols || MIN_PRIORITY_POOL_SYMBOLS)
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
  const scannerCanRunOpening = scannerCanRunQuoteOnly
    && dailyVolumeStatus === "ready"
    && readyMa20 >= MIN_READY_MA20_CONTINUOUS
    && readyMa35 >= MIN_READY_MA35_CONTINUOUS
    && (!after0845 || futoptMapped >= MIN_FUTOPT_MAPPED)
    && (!after0900 || intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);

  const priorityGateA = sourceGateA({
    after0830,
    after0845,
    after0900,
    selectedSymbolsFreshOk,
    priorityPoolSymbols,
    priorityFreshCoverage,
    quoteAgeSeconds: priorityMaxAge,
    cooldownRemaining,
    last429AgeSeconds,
    dailyVolumeStatus,
    readyMa20,
    readyMa35,
    futoptMapped,
    intraday1mStaleSeconds,
    scannerCanRunOpening,
  });
  const fullMarketGateA = freshFull.length >= TARGET_FRESH_QUOTES && freshQuoteCoverage >= MIN_FRESH_QUOTE_COVERAGE;
  const gateGrade = priorityGateA ? "A" : selectedSymbolsFreshOk ? "B" : freshFull.length > 0 ? "C" : "D";
  const status = gateGrade === "A" ? "ok" : gateGrade === "B" || gateGrade === "C" ? "degraded" : "stale";
  const message = gateGrade === "A"
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
    quote_age_seconds: priorityPoolSymbols ? priorityMaxAge : latestQuoteAge,
    required_quote_speed_per_sec: REQUIRED_SYMBOLS_PER_SECOND,
    actual_quote_speed_per_sec: actualQuoteSpeed,
    batch_size: BATCH_SIZE,
    batch_interval_seconds: TARGET_BATCH_INTERVAL_SECONDS,
    priority_symbols: priorityPoolSymbols,
    priority_pool_symbols: priorityPoolSymbols,
    priority_fresh_quotes_120s: freshPriority.length,
    priority_fresh_quote_coverage_120s: Number(priorityFreshCoverage.toFixed(4)),
    selected_symbols_fresh_ok: selectedSymbolsFreshOk,
    eligible_quote_rows: freshFull.length,
    scanner_can_run_opening: scannerCanRunOpening,
    scanner_can_run_quote_only: scannerCanRunQuoteOnly,
    daily_volume_status: dailyVolumeStatus,
    avg_volume5_eligible: avgVolume5Eligible,
    ready_ma20_continuous: readyMa20,
    ready_ma35_continuous: readyMa35,
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
    && values.priorityPoolSymbols >= MIN_PRIORITY_POOL_SYMBOLS
    && values.priorityFreshCoverage >= MIN_PRIORITY_FRESH_COVERAGE
    && values.quoteAgeSeconds <= MAX_QUOTE_AGE_SECONDS
    && values.cooldownRemaining <= 0
    && values.last429AgeSeconds > RECENT_429_BLOCK_SECONDS
    && (!values.after0830 || values.dailyVolumeStatus === "ready")
    && (!values.after0845 || values.scannerCanRunOpening)
    && (!values.after0845 || values.readyMa20 >= MIN_READY_MA20_CONTINUOUS)
    && (!values.after0845 || values.readyMa35 >= MIN_READY_MA35_CONTINUOUS)
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

async function tick() {
  const state = readWriterState();
  const phase = phaseNow();
  const fetchAllowedForPhase = quoteFetchAllowedForPhase(phase);
  const activeSymbols = await fetchActiveSymbols();
  const dailyVolumeMap = await fetchDailyVolumeAvg();
  const priorityRows = buildPriorityPool(activeSymbols, dailyVolumeMap);
  const quoteMap = await fetchExistingDaytradeQuotes();
  const intradayMap = await fetchIntradayStatus();
  const futoptRows = await fetchFutoptRows();
  const nonFatalWriteErrors = [];

  if (priorityRows.length) {
    try {
      await supabaseUpsert("fugle_daytrade_priority_pool", priorityRows, "symbol");
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
  }

  const cooldownActive = futureSeconds(state.cooldownUntil) > 0;
  const selected = cooldownActive || !fetchAllowedForPhase
    ? { symbols: [], priorityOnly: true }
    : selectFetchBatch(activeSymbols, priorityRows, quoteMap, state);
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
  });
  result.payload.nonfatal_write_errors = fetchResult.errors || [];
  await writeStatusAndScorecard(result);
  return {
    ok: result.gateGrade === "A",
    mode: APPLY ? "apply" : "dry-run",
    fetchEnabled: FETCH_ENABLED,
    sourceName: SOURCE_NAME,
    phase: result.phase,
    gateGrade: result.gateGrade,
    status: result.status,
    priorityPoolSymbols: result.payload.priority_pool_symbols,
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
      minPriorityPoolSymbols: MIN_PRIORITY_POOL_SYMBOLS,
      maxPriorityPoolSymbols: MAX_PRIORITY_POOL_SYMBOLS,
    }, null, 2));
    return;
  }

  if (!APPLY) {
    console.error("[daytrade-source-writer] dry-run mode: no Supabase writes. Use --apply only in an approved release-owner window.");
  }
  if (!FETCH_ENABLED) {
    console.error("[daytrade-source-writer] fetch disabled. Use --fetch for dry-run probing or --apply for the approved writer.");
  }

  do {
    const started = Date.now();
    const result = await tick();
    console.log(JSON.stringify(result, null, 2));
    if (ONCE) break;
    const elapsed = Math.ceil((Date.now() - started) / 1000);
    await sleep(Math.max(1000, (LOOP_SECONDS - elapsed) * 1000));
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
