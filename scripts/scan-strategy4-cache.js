const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const scanStrategy4 = require("../api/scan-strategy4");
const fetchStocks = require("../stocks");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");

const ROOT = path.resolve(__dirname, "..");
const BATCH_SIZE = Number(process.env.STRATEGY4_BATCH_SIZE || 80);
const CHUNK_SIZE = Number(process.env.STRATEGY4_CHUNK_SIZE || BATCH_SIZE);
const RETRY_CHUNK_SIZE = Number(process.env.STRATEGY4_RETRY_CHUNK_SIZE || CHUNK_SIZE);
const BATCHES_PER_RUN = Number(process.env.STRATEGY4_BATCHES_PER_RUN || 999);
const FULL_SCAN = process.env.FULL_SCAN !== "0";
const SYNC_PARTIAL = process.env.STRATEGY4_SYNC_PARTIAL === "1";
const SYNC_SCRIPT = path.join(ROOT, "run-strategy4-partial-sync.ps1");
const PARTIAL_SYNC_EVERY_CHUNKS = Math.max(1, Number(process.env.STRATEGY4_PARTIAL_SYNC_EVERY_CHUNKS || 1));
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const MIN_UNIVERSE_SIZE = Number(process.env.STRATEGY4_MIN_UNIVERSE_SIZE || 1500);
const MIN_MATCH_COUNT = Number(process.env.STRATEGY4_MIN_MATCH_COUNT || 10);
const MIN_MATCH_RATIO_TO_PREVIOUS = Number(process.env.STRATEGY4_MIN_MATCH_RATIO_TO_PREVIOUS || 0.5);
const MAX_YAHOO_SOURCE_RATIO = Number(process.env.STRATEGY4_MAX_YAHOO_SOURCE_RATIO || 0.2);
const MIN_AVG_VOLUME_5 = Number(process.env.STRATEGY4_MIN_AVG_VOLUME_5 || 3000);
const MIN_CUMULATIVE_BID_ASK_VOLUME = Number(process.env.STRATEGY4_MIN_CUMULATIVE_BID_ASK_VOLUME || 3000);
const STRATEGY4_CACHE_SCHEMA_VERSION = "strategy4-cache-v3-unit-contract";
const STRATEGY4_VOLUME_CACHE_SCHEMA_VERSION = "strategy4-volume-avg5-v3-unit-contract";
const STRATEGY4_VOLUME_UNIT = "lots";
const STRATEGY4_DAILY_VIEW = process.env.STRATEGY4_DAILY_VIEW || "strategy4_daily_ohlcv_view";
const VOLUME_CACHE_UNIT = "lots-v2";
const ALLOW_FILTER_RULE_DROP = process.env.STRATEGY4_ALLOW_FILTER_RULE_DROP !== "0";
const ALLOW_LEGACY_VOLUME_FALLBACK = process.env.STRATEGY4_ALLOW_LEGACY_VOLUME_FALLBACK === "1";
const FUGLE_HISTORY_CACHE_DIR = process.env.FUGLE_HISTORY_CACHE_DIR || path.join(process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime", "cache", "fugle", "historical");
const STRATEGY4_VOLUME_CACHE_FILE = path.join(process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime", "cache", "strategy4-volume-avg5.json");
const STRATEGY4_VOLUME_REFRESH_DAYS = Number(process.env.STRATEGY4_VOLUME_REFRESH_DAYS || 20);
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const SECRET_DIR = path.join(RUNTIME_DIR, "secrets");
const CONFIG_DIR = path.join(RUNTIME_DIR, "config");
const BLACKLIST_FILE = process.env.STRATEGY4_BLACKLIST_FILE || path.join(CONFIG_DIR, "fugle-api-blacklist-symbols.txt");
const HISTORY_PREWARM_SCRIPT = path.join(ROOT, "scripts", "prewarm-strategy4-history-cache.js");
const HISTORY_PREWARM_STATUS_FILE = path.join(STATE_DIR, "strategy4-history-prewarm-status.json");
const SUPABASE_STATUS_FILE = path.join(STATE_DIR, "strategy4-supabase-status.json");
const USE_MIS_QUOTES = process.env.STRATEGY4_USE_MIS === "1";
const SUPABASE_FIRST = process.env.STRATEGY4_SUPABASE_FIRST !== "0";
const SKIP_RETRY_ON_SUPABASE_FIRST = process.env.STRATEGY4_SUPABASE_SKIP_RETRY !== "0";
const FAIL_ON_INCOMPLETE = process.env.STRATEGY4_FAIL_ON_INCOMPLETE !== "0";
const ALLOW_PARTIAL_PUBLISH = process.env.STRATEGY4_ALLOW_PARTIAL_PUBLISH === "1";
const ALLOW_DEGRADED_COMPLETE = process.env.STRATEGY4_ALLOW_DEGRADED_COMPLETE !== "0";
const RUN_STAMP = process.env.STRATEGY4_SCAN_STAMP || new Date().toISOString().slice(0, 10).replace(/-/g, "");
const SUPABASE_URL = (
  process.env.STRATEGY4_SUPABASE_URL
  || process.env.SUPABASE_URL
  || readText(path.join(SECRET_DIR, "strategy4-supabase-url.txt"))
  || readText(path.join(SECRET_DIR, "supabase-url.txt"))
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/$/, "");
const SUPABASE_KEY = process.env.STRATEGY4_SUPABASE_ANON_KEY
  || process.env.SUPABASE_ANON_KEY
  || readText(path.join(SECRET_DIR, "strategy4-supabase-anon-key.txt"))
  || readText(path.join(SECRET_DIR, "supabase-anon-key.txt"));
const SUPABASE_SERVICE_ROLE_KEY = process.env.STRATEGY4_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_KEY
  || readText(path.join(SECRET_DIR, "strategy4-supabase-service-role-key.txt"))
  || readText(path.join(SECRET_DIR, "supabase-service-role-key.txt"));
const SUPABASE_RESULTS_TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const SUPABASE_RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const SUPABASE_QUOTE_VIEW = process.env.STRATEGY4_QUOTE_VIEW || "fugle_realtime_quote_latest";
const SUPABASE_RESULTS_ATTEMPTS = Number(process.env.STRATEGY4_SUPABASE_RESULTS_ATTEMPTS || 4);
const SYNC_SUPABASE_RESULTS = process.env.STRATEGY4_SYNC_SUPABASE_RESULTS !== "0";
const STRATEGY4_API_ONLY = true;
let strategy4VolumeCache = null;
let strategy4VolumeCacheSource = `supabase:${STRATEGY4_DAILY_VIEW}`;

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
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

function writeSupabaseStatus(ok, details = {}) {
  writeJson(SUPABASE_STATUS_FILE, {
    ok,
    checkedAt: new Date().toISOString(),
    ...details,
  });
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function flagTrue(value) {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "y";
}
function normalizeVolumeLots(value, row = {}) {
  const volume = cleanNumber(value);
  if (!volume) return 0;
  const unit = String(row?.volumeUnit || row?.volume_unit || "").toLowerCase();
  if (/share|stock|股/.test(unit)) return volume / 1000;
  if (/lot|張/.test(unit)) return volume;

  const close = cleanNumber(row?.close);
  const tradeValue = cleanNumber(row?.value || row?.tradeValue || row?.turnover);
  if (close > 0 && tradeValue > 0) {
    const valueIfShares = close * volume;
    const valueIfLots = close * volume * 1000;
    const shareGap = Math.abs(valueIfShares - tradeValue) / Math.max(tradeValue, 1);
    const lotGap = Math.abs(valueIfLots - tradeValue) / Math.max(tradeValue, 1);
    if (shareGap < lotGap) return volume / 1000;
    if (lotGap < shareGap) return volume;
  }

  return volume >= 100000 ? volume / 1000 : volume;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

async function fetchSupabaseDailyVolumeRows(from, to) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;

  const fetchPages = async (table, select, source) => {
    const out = [];
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      url.searchParams.set("select", select);
      url.searchParams.append("trade_date", `gte.${from}`);
      url.searchParams.append("trade_date", `lte.${to}`);
      url.searchParams.set("order", "trade_date.asc");
      const response = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
      }
      const page = await response.json();
      if (!Array.isArray(page) || !page.length) break;
      out.push(...page.map((row) => ({ ...row, __source: source })));
      if (page.length < pageSize) break;
    }
    return out;
  };

  try {
    rows.push(...await fetchPages(
      STRATEGY4_DAILY_VIEW,
      "symbol,trade_date,close,volume_shares,volume_lots,trade_value_twd,avg_volume_5_lots,avg_volume_20_lots",
      `supabase:${STRATEGY4_DAILY_VIEW}`,
    ));
    strategy4VolumeCacheSource = `supabase:${STRATEGY4_DAILY_VIEW}`;
  } catch (error) {
    rows.length = 0;
    console.log(`strategy4 supabase unit view unavailable, fallback to fugle_daily_volume: ${error.message || error}`);
    rows.push(...await fetchPages(
      "fugle_daily_volume",
      "symbol,trade_date,volume",
      "supabase:fugle_daily_volume:legacy-lots",
    ));
    strategy4VolumeCacheSource = "supabase:fugle_daily_volume:legacy-lots";
  }
  return rows;
}

function refreshVolumeAvg5Cache(rows) {
  if (!rows.length) return 0;
  const cache = readJson(STRATEGY4_VOLUME_CACHE_FILE, { source: strategy4VolumeCacheSource, byCode: {} });
  const byCode = cache.byCode && typeof cache.byCode === "object" ? cache.byCode : {};
  let updated = 0;
  rows.forEach((row) => {
    const code = normalizeCode(row.symbol || row.code || row.stock_id || row.data_id);
    const date = String(row.trade_date || row.date || row.trading_date || "").slice(0, 10);
    const explicitVolumeLots = cleanNumber(row.volume_lots ?? row.volumeLots);
    const volumeLots = explicitVolumeLots
      || (row.__source === "supabase:fugle_daily_volume:legacy-lots" ? cleanNumber(row.volume || row.trade_volume || row.trading_volume) : 0);
    const volumeShares = cleanNumber(row.volume_shares ?? row.volumeShares) || (volumeLots ? volumeLots * 1000 : 0);
    const tradeValueTwd = cleanNumber(row.trade_value_twd ?? row.tradeValueTwd);
    const close = cleanNumber(row.close);
    const avgVolume5Lots = cleanNumber(row.avg_volume_5_lots ?? row.avgVolume5Lots);
    const avgVolume20Lots = cleanNumber(row.avg_volume_20_lots ?? row.avgVolume20Lots);
    if (!/^\d{4}$/.test(code) || !date || !volumeLots) return;
    const current = Array.isArray(byCode[code]) ? byCode[code] : [];
    const map = new Map(current.map((item) => [item.date, item]));
    map.set(date, {
      date,
      volume_lots: Number(volumeLots.toFixed(4)),
      volume: Number(volumeLots.toFixed(4)),
      volume_shares: Number(volumeShares.toFixed(0)),
      trade_value_twd: tradeValueTwd ? Number(tradeValueTwd.toFixed(0)) : null,
      close: close || null,
      avg_volume_5_lots: avgVolume5Lots ? Number(avgVolume5Lots.toFixed(4)) : null,
      avg_volume_20_lots: avgVolume20Lots ? Number(avgVolume20Lots.toFixed(4)) : null,
      volumeUnit: STRATEGY4_VOLUME_UNIT,
      source: row.__source || strategy4VolumeCacheSource,
    });
    byCode[code] = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
    updated += 1;
  });
  validateStrategy4VolumeCache({ byCode }, { throwOnError: true });
  fs.mkdirSync(path.dirname(STRATEGY4_VOLUME_CACHE_FILE), { recursive: true });
  fs.writeFileSync(STRATEGY4_VOLUME_CACHE_FILE, `${JSON.stringify({
    schemaVersion: STRATEGY4_VOLUME_CACHE_SCHEMA_VERSION,
    unit: VOLUME_CACHE_UNIT,
    volumeUnit: STRATEGY4_VOLUME_UNIT,
    source: strategy4VolumeCacheSource,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    refreshDays: STRATEGY4_VOLUME_REFRESH_DAYS,
    byCode,
  }, null, 2)}\n`);
  strategy4VolumeCache = null;
  return updated;
}

async function refreshStrategy4VolumeCacheFromSupabase() {
  const to = new Date().toISOString().slice(0, 10);
  const from = isoDateDaysAgo(STRATEGY4_VOLUME_REFRESH_DAYS);
  try {
    const rows = await fetchSupabaseDailyVolumeRows(from, to);
    const updated = refreshVolumeAvg5Cache(rows);
    console.log(`strategy4 supabase volume avg5 refresh: rows ${rows.length}, writes ${updated}`);
  } catch (error) {
    console.log(`strategy4 supabase volume avg5 refresh failed: ${error.message || error}`);
  }
}

function runSupabaseHistoryPrewarm() {
  if (!SUPABASE_FIRST) return null;
  if (!fs.existsSync(HISTORY_PREWARM_SCRIPT)) {
    console.log(`strategy4 supabase prewarm skipped: missing ${HISTORY_PREWARM_SCRIPT}`);
    return null;
  }
  console.log("strategy4 supabase-first prewarm start");
  const result = spawnSync(process.execPath, [HISTORY_PREWARM_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: Number(process.env.STRATEGY4_PREWARM_TIMEOUT_MS || 900000),
    env: {
      ...process.env,
      STRATEGY4_SUPABASE_URL: SUPABASE_URL,
      STRATEGY4_SUPABASE_ANON_KEY: SUPABASE_KEY || process.env.STRATEGY4_SUPABASE_ANON_KEY || "",
      STRATEGY4_PREWARM_SUPABASE_ONLY: "1",
      STRATEGY4_PREWARM_BATCHES_PER_RUN: process.env.STRATEGY4_PREWARM_BATCHES_PER_RUN || "999",
      STRATEGY4_SUPABASE_HISTORY_TABLES: process.env.STRATEGY4_SUPABASE_HISTORY_TABLES || STRATEGY4_DAILY_VIEW,
      STRATEGY4_SUPABASE_HISTORY_CODE_FIELDS: process.env.STRATEGY4_SUPABASE_HISTORY_CODE_FIELDS || "symbol",
      STRATEGY4_SUPABASE_HISTORY_DATE_FIELDS: process.env.STRATEGY4_SUPABASE_HISTORY_DATE_FIELDS || "trade_date",
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (output) {
    output.split(/\r?\n/).filter(Boolean).slice(-30).forEach((line) => console.log(`strategy4 prewarm: ${line}`));
  }
  if (result.error) {
    console.log(`strategy4 supabase prewarm failed: ${result.error.message}`);
  } else if (result.status !== 0) {
    console.log(`strategy4 supabase prewarm failed: exit ${result.status}`);
  } else {
    console.log("strategy4 supabase-first prewarm done");
  }
  return readJson(HISTORY_PREWARM_STATUS_FILE, null);
}

function getSupabaseCoverageStatus() {
  const status = readJson(HISTORY_PREWARM_STATUS_FILE, null);
  if (!status) return null;
  const universe = Number(status.universe || 0);
  const remainingMiss = Number(status.remainingMiss || 0);
  const syncStatus = String(status.supabaseSyncStatus?.status || status.syncStatus || status.status || "").toLowerCase();
  const qualityStatus = remainingMiss > 0 || syncStatus === "partial" ? "partial" : "complete";
  return {
    ...status,
    universe,
    remainingMiss,
    coverageRatio: universe ? Number(((universe - remainingMiss) / universe).toFixed(4)) : 0,
    qualityStatus,
  };
}

function cachedAvgVolume5(code) {
  if (strategy4VolumeCache === null) {
    strategy4VolumeCache = readJson(STRATEGY4_VOLUME_CACHE_FILE, {});
  }
  const validCacheContract = (
    strategy4VolumeCache?.schemaVersion === STRATEGY4_VOLUME_CACHE_SCHEMA_VERSION
    && strategy4VolumeCache?.volumeUnit === STRATEGY4_VOLUME_UNIT
    && strategy4VolumeCache?.unit === VOLUME_CACHE_UNIT
  );
  const volumeRows = Array.isArray(strategy4VolumeCache?.byCode?.[normalizeCode(code)]) ? strategy4VolumeCache.byCode[normalizeCode(code)] : [];
  if (validCacheContract && volumeRows.length >= 5) {
    const volumes = volumeRows
      .slice()
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .slice(-5)
      .map((row) => cleanNumber(row.volume_lots ?? row.volume));
    const latestAvg = cleanNumber(volumeRows.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).at(-1)?.avg_volume_5_lots);
    if (latestAvg) return Number(latestAvg.toFixed(2));
    const cachedValue = avg(volumes);
    if (cachedValue) return Number(cachedValue.toFixed(2));
  }
  if (!ALLOW_LEGACY_VOLUME_FALLBACK) return null;
  const file = path.join(FUGLE_HISTORY_CACHE_DIR, `${normalizeCode(code)}.json`);
  const payload = readJson(file, null);
  const source = String(payload?.source || "");
  const sourceUnit = /supabase|fugle|finmind|yahoo|twse|tpex/i.test(source) ? "shares" : "";
  const rows = Array.isArray(payload?.rows) ? payload.rows.map((row) => ({
    ...row,
    volumeUnit: row.volumeUnit || row.volume_unit || sourceUnit || undefined,
  })) : [];
  if (rows.length < 5) return null;
  const volumes = rows
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(-5)
    .map((row) => normalizeVolumeLots(row.volume, row));
  const value = avg(volumes);
  return value ? Number(value.toFixed(2)) : null;
}

function buildVolumePrefilter(stocks) {
  const filtered = [];
  let cacheHit = 0;
  let cacheMiss = 0;
  stocks.forEach((stock) => {
    const avgVolume5 = cachedAvgVolume5(stock.code);
    if (avgVolume5 == null) {
      cacheMiss += 1;
      return;
    }
    cacheHit += 1;
    if (avgVolume5 < MIN_AVG_VOLUME_5) {
      filtered.push({ code: stock.code, name: stock.name || stock.code, avgVolume5 });
    }
  });
  return {
    enabled: true,
    rule: "avgVolume5-gte",
    minAvgVolume5: MIN_AVG_VOLUME_5,
    filtered,
    cacheHit,
    cacheMiss,
  };
}

async function fetchSupabaseQuoteLiquidityRows() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${SUPABASE_QUOTE_VIEW}`);
    url.searchParams.set("select", "symbol,volume_lots,cumulative_bid_volume_lots,cumulative_ask_volume_lots,cumulative_bid_ask_volume_lots,quote_updated_at");
    url.searchParams.set("order", "symbol.asc");
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${SUPABASE_QUOTE_VIEW} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
    }
    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function buildQuoteLiquidityPrefilter(stocks) {
  const rows = await fetchSupabaseQuoteLiquidityRows();
  const byCode = new Map();
  rows.forEach((row) => {
    const code = normalizeCode(row.symbol || row.code);
    if (!/^\d{4}$/.test(code)) return;
    const cumulative = cleanNumber(row.cumulative_bid_ask_volume_lots ?? row.cumulative_bid_ask_volume);
    byCode.set(code, {
      code,
      cumulativeBidAskVolume: Number(cumulative.toFixed(4)),
      quoteUpdatedAt: row.quote_updated_at || row.updated_at || "",
    });
  });

  const filtered = [];
  let cacheHit = 0;
  let cacheMiss = 0;
  stocks.forEach((stock) => {
    const quote = byCode.get(normalizeCode(stock.code));
    if (!quote) {
      cacheMiss += 1;
      filtered.push({
        code: stock.code,
        name: stock.name || stock.code,
        cumulativeBidAskVolume: null,
        reason: "missing-quote-liquidity",
      });
      return;
    }
    cacheHit += 1;
    if (quote.cumulativeBidAskVolume < MIN_CUMULATIVE_BID_ASK_VOLUME) {
      filtered.push({
        code: stock.code,
        name: stock.name || stock.code,
        cumulativeBidAskVolume: quote.cumulativeBidAskVolume,
        quoteUpdatedAt: quote.quoteUpdatedAt,
        reason: "cumulative-bid-ask-below-min",
      });
    }
  });

  return {
    enabled: true,
    rule: "cumulativeBidAskVolume-gte",
    minCumulativeBidAskVolume: MIN_CUMULATIVE_BID_ASK_VOLUME,
    source: `supabase:${SUPABASE_QUOTE_VIEW}`,
    filtered,
    cacheHit,
    cacheMiss,
    quoteRows: rows.length,
  };
}

function volumeFilterRuleChanged(previous, current) {
  const previousFilter = previous?.volumeFilter || null;
  const currentFilter = current?.volumeFilter || null;
  const previousThreshold = Number(previousFilter?.minAvgVolume5 || previousFilter?.threshold || 0);
  const currentThreshold = Number(currentFilter?.minAvgVolume5 || currentFilter?.threshold || 0);
  const previousFiltered = Number(previous?.volumeFilteredCount || previousFilter?.filtered?.length || 0);
  const currentFiltered = Number(current?.volumeFilteredCount || currentFilter?.filtered?.length || 0);
  const previousQuoteFiltered = Number(previous?.quoteLiquidityFilteredCount || previous?.quoteLiquidityFilter?.filtered?.length || 0);
  const currentQuoteFiltered = Number(current?.quoteLiquidityFilteredCount || current?.quoteLiquidityFilter?.filtered?.length || 0);
  if (!currentFilter || currentFiltered <= 0) return false;
  if (!previousFilter && currentFiltered > 0) return true;
  if (previousThreshold !== currentThreshold) return true;
  return previousFiltered === 0 && currentFiltered > 0 || previousQuoteFiltered === 0 && currentQuoteFiltered > 0;
}

async function fetchJson(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function callLocalStocksHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `stocks HTTP ${this.statusCode}`));
        else if ((payload?.errors || []).length) reject(new Error(payload.errors.join("; ")));
        else resolve(payload);
      },
      end() { resolve({ ok: false, stocks: [] }); },
    };
    Promise.resolve(fetchStocks(req, res)).catch(reject);
  });
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code || row.symbol || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  const industry = String(row.industry || row.officialIndustry || row.primaryIndustry || "").trim();
  const text = `${code} ${name} ${industry}`;
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  if (flagTrue(row.is_etf) || flagTrue(row.is_warrant) || flagTrue(row.is_cb) || flagTrue(row.is_blacklisted)) return null;
  if (/(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) return null;
  if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) return null;
  return {
    code,
    name,
    market: String(row.Market || row.market || row["市場"] || "").trim().toUpperCase().replace(/^TSE$/, "TWSE").replace(/^OTC$/, "TPEX"),
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume || row.volume),
    industry,
  };
}

function normalizeStrategy4UniverseStock(row) {
  const code = normalizeCode(row.Code || row.code || row.symbol || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  if (!/^\d{4}$/.test(code) || !name) return null;
  return {
    code,
    name,
    market: String(row.Market || row.market || row["市場"] || "").trim().toUpperCase().replace(/^TSE$/, "TWSE").replace(/^OTC$/, "TPEX"),
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume || row.volume),
    industry: String(row.industry || row.officialIndustry || row.primaryIndustry || "").trim(),
  };
}

function loadExcludedCodes() {
  const codes = new Set();
  const files = [
    BLACKLIST_FILE,
    path.join(CONFIG_DIR, "strategy4-excluded-symbols.txt"),
  ];
  files.forEach((file) => {
    const text = readText(file);
    text.split(/\r?\n|,/)
      .map((item) => normalizeCode(item))
      .filter((code) => /^\d{4}$/.test(code))
      .forEach((code) => codes.add(code));
  });
  return codes;
}

function isExcludedStock(stock, excludedCodes) {
  if (!stock) return true;
  if (excludedCodes.has(stock.code)) return true;
  const text = `${stock.code || ""} ${stock.name || ""} ${stock.industry || ""}`;
  if (/^00/.test(stock.code || "")) return true;
  if (/(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) return true;
  if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) return true;
  return false;
}

async function fetchSupabaseUniverse() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;
  for (const table of ["strategy4_stock_universe_view", "stock_universe", "stock_tickers"]) {
    rows.length = 0;
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      url.searchParams.set("select", table === "strategy4_stock_universe_view"
        ? "symbol,name,market,industry,is_strategy4_eligible,is_active"
        : (table === "stock_universe"
          ? "symbol,name,market,industry,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,is_active"
          : "symbol,name,market,stock_type,industry,is_etf,is_suspended"));
      if (table === "strategy4_stock_universe_view") {
        url.searchParams.set("is_strategy4_eligible", "eq.true");
      } else if (table === "stock_universe") {
        url.searchParams.set("is_active", "eq.true");
        url.searchParams.set("is_etf", "eq.false");
        url.searchParams.set("is_warrant", "eq.false");
        url.searchParams.set("is_cb", "eq.false");
        url.searchParams.set("is_blacklisted", "eq.false");
      } else {
        url.searchParams.set("stock_type", "eq.COMMONSTOCK");
        url.searchParams.set("is_etf", "eq.false");
        url.searchParams.set("is_suspended", "eq.false");
      }
      url.searchParams.set("order", "symbol.asc");
      const response = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      });
      if (!response.ok) break;
      const page = await response.json();
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (rows.length) {
      console.log(`strategy4 supabase ${table} universe: ${rows.length}`);
      const normalized = rows
        .map(table === "strategy4_stock_universe_view" ? normalizeStrategy4UniverseStock : normalizeStock)
        .filter(Boolean);
      return table === "strategy4_stock_universe_view"
        ? normalized
        : normalized.filter((stock) => !isExcludedStock(stock, new Set()));
    }
  }
  return [];
}

async function fetchUniverse() {
  let parsed = [];
  try {
    parsed = await fetchSupabaseUniverse();
  } catch (error) {
    console.log(`strategy4 supabase universe fallback: ${error.message}`);
  }
  if (!parsed.length) {
    const payload = await fetchJson(STOCK_URL, 30000);
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    parsed = rows.map(normalizeStock).filter(Boolean);
    if (parsed.length < MIN_UNIVERSE_SIZE) {
      console.log(`stock endpoint partial universe: ${parsed.length}, fallback to local TWSE+TPEX fetch`);
      parsed = [];
    }
  }

  if (!parsed.length) {
    const payload = await callLocalStocksHandler();
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    parsed = rows.map(normalizeStock).filter(Boolean);
  }
  const byCode = new Map();
  const excludedCodes = loadExcludedCodes();
  let excludedCount = 0;
  parsed.forEach((stock) => {
    if (isExcludedStock(stock, excludedCodes)) {
      excludedCount += 1;
      return;
    }
    byCode.set(stock.code, stock);
  });
  parsed = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  console.log(`strategy4 universe after exclusions: ${parsed.length}, excluded ${excludedCount}, blacklist ${excludedCodes.size}`);
  if (parsed.length < MIN_UNIVERSE_SIZE) {
    throw new Error(`Strategy4 stock universe too small: ${parsed.length}/${MIN_UNIVERSE_SIZE}`);
  }
  if (!USE_MIS_QUOTES) return parsed;
  const quotes = await fetchMisQuotes(parsed.map((stock) => stock.code));
  return parsed.map((stock) => {
    const quote = quotes.get(stock.code);
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
}
function runHandler(stocks) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      query: {
        codes: stocks.map((stock) => stock.code).join(","),
        markets: stocks.map((stock) => stock.market || "").join(","),
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanStrategy4(req, res)).catch(reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHandlerWithRetry(codes, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runHandler(codes);
    } catch (error) {
      lastError = error;
      console.log(`${label} attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) await sleep(2500 * attempt);
    }
  }
  throw lastError;
}

function mergeMatches(matches, universe, currentMatches) {
  (matches || []).forEach((item) => {
    const base = universe.find((stock) => stock.code === item.code) || {};
    currentMatches.set(item.code, {
      ...base,
      ...item,
      name: base.name || item.name || item.code,
    });
  });
}

function removeScannedMisses(scannedCodes, payload, currentMatches) {
  const matchedCodes = new Set((payload.matches || []).map((item) => item.code));
  const noDataCodes = new Set(payload.noDataCodes || []);
  const errorCodes = new Set((payload.errors || [])
    .map((error) => String(error || "").match(/^(\d{4})\b/)?.[1])
    .filter(Boolean));
  scannedCodes.forEach((code) => {
    if (!matchedCodes.has(code) && !noDataCodes.has(code) && !errorCodes.has(code)) {
      currentMatches.delete(code);
    }
  });
}

function mergeSourceCounts(sourceCounts, currentSourceCounts) {
  Object.entries(sourceCounts || {}).forEach(([source, count]) => {
    const key = source || "unknown";
    currentSourceCounts.set(key, (currentSourceCounts.get(key) || 0) + Number(count || 0));
  });
}

function buildOutput({ codes, scannedThisRun, scanned, noDataCodes, scanErrors, currentMatches, dataSourceCounts, complete, runMode, scanStamp, volumeFilter, quoteLiquidityFilter, supabaseCoverage }) {
  const expectedMatchDate = normalizeIsoDate(scanStamp) || scanDateFromOutput({ scanStamp });
  const allMatches = [...currentMatches.values()];
  const staleMatches = allMatches.filter((item) => normalizeIsoDate(item.date || item.tradeDate || item.usedDate) !== expectedMatchDate);
  const matches = allMatches
    .filter((item) => normalizeIsoDate(item.date || item.tradeDate || item.usedDate) === expectedMatchDate)
    .sort((a, b) => (b.swingScore || b.score || 0) - (a.swingScore || a.score || 0) || (b.percent || 0) - (a.percent || 0));
  const noDataCount = noDataCodes.size;
  const errorCount = scanErrors.length;
  const pendingCount = codes.length - scanned.size + noDataCount;
  const sourceCounts = Object.fromEntries([...dataSourceCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const yahooSourceCount = Object.entries(sourceCounts)
    .filter(([source]) => /^yahoo/i.test(source))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const misSourceCount = Object.entries(sourceCounts)
    .filter(([source]) => /\+mis$/i.test(source) || /^mis$/i.test(source))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const totalSourceCount = Object.values(sourceCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const yahooSourceRatio = totalSourceCount ? Number((yahooSourceCount / totalSourceCount).toFixed(4)) : 0;
  const misSourceRatio = totalSourceCount ? Number((misSourceCount / totalSourceCount).toFixed(4)) : 0;
  const sourceWarnings = [];
  if (complete && yahooSourceRatio > MAX_YAHOO_SOURCE_RATIO) {
    sourceWarnings.push(`Yahoo fallback ratio ${yahooSourceRatio} above ${MAX_YAHOO_SOURCE_RATIO}`);
  }
  const coveragePartial = supabaseCoverage?.qualityStatus === "partial";
  const degradedComplete = ALLOW_DEGRADED_COMPLETE && scanned.size === codes.length && errorCount === 0;
  const baseComplete = degradedComplete || (complete && noDataCount === 0 && errorCount === 0 && !coveragePartial);
  const qualityStatus = coveragePartial
    ? (baseComplete ? "degraded" : "partial")
    : (baseComplete ? ((sourceWarnings.length || noDataCount > 0) ? "degraded" : "complete") : "incomplete");
  if (baseComplete && coveragePartial) {
    sourceWarnings.push("Supabase history coverage partial; published as degraded complete after scanning full universe");
  }
  if (baseComplete && noDataCount > 0) {
    sourceWarnings.push(`No daily-K history for ${noDataCount} scanned codes; published as degraded complete`);
  }
  if (staleMatches.length) {
    const staleDates = [...new Set(staleMatches.map((item) => normalizeIsoDate(item.date || item.tradeDate || item.usedDate)).filter(Boolean))].slice(0, 8);
    sourceWarnings.push(`Filtered ${staleMatches.length} stale Strategy4 matches not on scan date ${expectedMatchDate}${staleDates.length ? `: ${staleDates.join(", ")}` : ""}`);
  }
  return {
    ok: true,
    schemaVersion: STRATEGY4_CACHE_SCHEMA_VERSION,
    volumeUnit: STRATEGY4_VOLUME_UNIT,
    source: baseComplete ? "github-actions" : "github-actions-partial",
    dataContractSource: strategy4VolumeCacheSource,
    priceSource: USE_MIS_QUOTES ? "official-daily-k-plus-mis" : "official-daily-k",
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scanStamp,
    fullScan: FULL_SCAN,
    runMode,
    complete: baseComplete,
    qualityStatus,
    supabaseFirst: SUPABASE_FIRST,
    supabaseCoverage: supabaseCoverage || null,
    pendingCount,
    noDataCount,
    errorCount,
    total: codes.length,
    scannedThisRun,
    scannedCodes: [...scanned].filter((code) => codes.includes(code)),
    noDataCodes: [...noDataCodes],
    errors: scanErrors,
    dataSourceCounts: sourceCounts,
    yahooSourceCount,
    yahooSourceRatio,
    misSourceCount,
    misSourceRatio,
    sourceWarnings,
    volumeFilter: volumeFilter || null,
    volumeFilteredCount: volumeFilter?.filtered?.length || 0,
    volumeFilteredCodes: (volumeFilter?.filtered || []).map((item) => item.code),
    quoteLiquidityFilter: quoteLiquidityFilter || null,
    quoteLiquidityFilteredCount: quoteLiquidityFilter?.filtered?.length || 0,
    quoteLiquidityFilteredCodes: (quoteLiquidityFilter?.filtered || []).map((item) => item.code),
    staleFilteredCount: staleMatches.length,
    staleFilteredDates: [...new Set(staleMatches.map((item) => normalizeIsoDate(item.date || item.tradeDate || item.usedDate)).filter(Boolean))].slice(0, 8),
    count: matches.length,
    matches,
  };
}

function writeStrategy4Output(output, writeBackup = false) {
  const contract = validateStrategy4VolumeCache(readJson(STRATEGY4_VOLUME_CACHE_FILE, {}), { throwOnError: true, requireMetadata: true });
  if (contract.warnings.length) {
    output.sourceWarnings = [
      ...(output.sourceWarnings || []),
      ...contract.warnings.slice(0, 20).map((warning) => `Strategy4 volume contract warning: ${warning}`),
    ];
  }
  console.log(`strategy4 API-only: skipped static data/strategy4*.json output, backup=${writeBackup ? "requested" : "no"}`);
}

function validateStrategy4VolumeCache(cache, options = {}) {
  const errors = [];
  const warnings = [];
  if (options.requireMetadata) {
    if (cache?.schemaVersion !== STRATEGY4_VOLUME_CACHE_SCHEMA_VERSION) errors.push("cache schemaVersion missing or stale");
    if (cache?.volumeUnit !== STRATEGY4_VOLUME_UNIT) errors.push("cache volumeUnit missing or not lots");
    if (cache?.unit !== VOLUME_CACHE_UNIT) errors.push("cache unit missing or stale");
    if (!cache?.source) errors.push("cache source missing");
    if (!cache?.generatedAt && !cache?.updatedAt) errors.push("cache generatedAt/updatedAt missing");
  }
  const byCode = cache?.byCode && typeof cache.byCode === "object" ? cache.byCode : {};
  Object.entries(byCode).forEach(([code, rows]) => {
    if (!Array.isArray(rows)) return;
    rows.slice(-20).forEach((row) => {
      const date = String(row.date || "");
      const label = `${code} ${date}`.trim();
      const volumeLots = cleanNumber(row.volume_lots ?? row.volume);
      const volumeShares = cleanNumber(row.volume_shares);
      const close = cleanNumber(row.close);
      const tradeValueTwd = cleanNumber(row.trade_value_twd);
      if (!(volumeLots > 0)) errors.push(`${label}: volume_lots <= 0`);
      if (volumeShares > 0 && volumeLots > 0) {
        const ratio = volumeShares / volumeLots;
        if (Math.abs(ratio - 1000) > 2) errors.push(`${label}: volume_shares/volume_lots=${ratio.toFixed(2)} not 1000`);
      }
      if (close > 0 && tradeValueTwd > 0 && volumeShares > 0) {
        const expected = close * volumeShares;
        const gap = Math.abs(tradeValueTwd - expected) / Math.max(expected, 1);
        if (gap > 0.35) errors.push(`${label}: trade_value_twd gap ${(gap * 100).toFixed(1)}%`);
      }
      if (close > 0 && volumeLots > 0) {
        if (close < 10 && volumeLots > 200000) warnings.push(`${label}: low price high volume check close=${close}, lots=${volumeLots}`);
        if (close > 500 && volumeLots < 1) warnings.push(`${label}: high price low volume check close=${close}, lots=${volumeLots}`);
      }
    });
  });
  if (options.throwOnError && errors.length) {
    throw new Error(`Strategy4 volume unit contract failed: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? ` ... +${errors.length - 8}` : ""}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

function normalizeSignal(signal) {
  if (!signal || typeof signal !== "object") return null;
  const id = String(signal.id || signal.signalId || "").trim();
  if (!id) return null;
  return {
    id,
    title: String(signal.title || signal.name || signal.short || id).trim(),
    short: String(signal.short || signal.title || signal.name || id).trim(),
    icon: String(signal.icon || "").trim(),
    reason: String(signal.reason || signal.message || "").trim(),
  };
}

function strategy4Signals(stock) {
  const primary = normalizeArray(stock?.signals).length ? stock.signals : stock?.swingSignals;
  return normalizeArray(primary).map(normalizeSignal).filter(Boolean);
}

function scanDateFromOutput(output) {
  const stamp = String(output.scanStamp || output.date || "").trim();
  if (/^\d{8}$/.test(stamp)) return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp;
  const updatedAt = String(output.updatedAt || "");
  return /^\d{4}-\d{2}-\d{2}/.test(updatedAt) ? updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(value) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function strategy4RunIdFromOutput(output) {
  const scanDate = scanDateFromOutput(output).replace(/-/g, "");
  const stamp = Date.parse(String(output.generatedAt || output.updatedAt || ""));
  const time = Number.isFinite(stamp)
    ? new Date(stamp).toISOString().replace(/\D/g, "").slice(0, 14)
    : new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return String(process.env.STRATEGY4_RUN_ID || `strategy4-${scanDate}-${time}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildSupabaseRunRow(output, runId) {
  const scanDate = scanDateFromOutput(output);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return {
    run_id: runId,
    strategy: "strategy4",
    scan_date: scanDate,
    started_at: String(output.startedAt || output.generatedAt || output.updatedAt || new Date().toISOString()),
    finished_at: scanTime,
    status: output.complete ? "complete" : "failed",
    expected_total: cleanNumber(output.total),
    scanned_count: cleanNumber(output.scannedCount || output.scanned || output.total),
    result_count: cleanNumber(output.count),
    no_data_count: cleanNumber(output.noDataCount),
    error_count: cleanNumber(output.errorCount),
    complete: Boolean(output.complete),
    quality_status: String(output.qualityStatus || "").trim(),
    schema_version: String(output.schemaVersion || STRATEGY4_CACHE_SCHEMA_VERSION).trim(),
    volume_unit: String(output.volumeUnit || STRATEGY4_VOLUME_UNIT).trim(),
    data_contract_source: String(output.dataContractSource || strategy4VolumeCacheSource || "").trim(),
    source: String(output.source || "").trim(),
    generated_at: String(output.generatedAt || output.updatedAt || new Date().toISOString()),
    updated_at: scanTime,
    payload: {
      count: cleanNumber(output.count),
      total: cleanNumber(output.total),
      zones: output.zones || null,
      runMode: output.runMode || "",
      scanStamp: output.scanStamp || "",
      sourceWarnings: output.sourceWarnings || [],
      yahooSourceCount: cleanNumber(output.yahooSourceCount),
      yahooSourceRatio: cleanNumber(output.yahooSourceRatio),
      misSourceCount: cleanNumber(output.misSourceCount),
      misSourceRatio: cleanNumber(output.misSourceRatio),
      dataSourceCounts: output.dataSourceCounts || {},
      supabaseCoverage: output.supabaseCoverage || null,
    },
  };
}

function buildSupabaseScanRows(output, mode = "full", runId = "", includeRunId = true) {
  const matches = normalizeArray(output.matches);
  const scanDate = scanDateFromOutput(output);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return matches.map((stock, index) => {
    const signals = strategy4Signals(stock);
    const hasWalletStrongBuy = signals.some((signal) => signal.id === "wallet_strong_buy");
    const hasWalletVolumeCross = signals.some((signal) => signal.id === "wallet_volume_cross");
    const base = {
      ...(includeRunId && runId ? { run_id: runId } : {}),
      scan_date: scanDate,
      scan_time: scanTime,
      strategy: "strategy4",
      code: normalizeCode(stock.code),
      name: String(stock.name || stock.code || "").trim(),
      signals,
      has_wallet_strong_buy: hasWalletStrongBuy,
      has_wallet_volume_cross: hasWalletVolumeCross,
      updated_at: scanTime,
    };
    if (mode === "minimal") return base;
    return {
      ...base,
      market: String(stock.market || "").trim(),
      price: cleanNumber(stock.close || stock.price),
      change_percent: cleanNumber(stock.percent ?? stock.changePercent ?? stock.pct),
      volume: cleanNumber(stock.volume || stock.tradeVolume),
      trade_value: cleanNumber(stock.value || stock.tradeValue),
      score: cleanNumber(stock.swingScore || stock.score),
      zone: String(stock.swingZone || stock.zone || "").trim(),
      zone_label: String(stock.swingZoneLabel || stock.zoneLabel || "").trim(),
      rank: index + 1,
      reason: String(stock.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
      source: String(output.source || "").trim(),
      price_source: String(stock.priceSource || output.priceSource || "").trim(),
      scan_stamp: String(output.scanStamp || "").trim(),
      run_mode: String(output.runMode || "").trim(),
      complete: Boolean(output.complete),
      quality_status: String(output.qualityStatus || "").trim(),
      schema_version: String(output.schemaVersion || STRATEGY4_CACHE_SCHEMA_VERSION).trim(),
      volume_unit: String(output.volumeUnit || STRATEGY4_VOLUME_UNIT).trim(),
      data_contract_source: String(output.dataContractSource || strategy4VolumeCacheSource || "").trim(),
      generated_at: String(output.generatedAt || output.updatedAt || new Date().toISOString()),
      payload: stock,
    };
  }).filter((row) => /^\d{4}$/.test(row.code));
}

async function upsertStrategy4RunToSupabase(output, runId) {
  const row = buildSupabaseRunRow(output, runId);
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/rest/v1/${SUPABASE_RUNS_TABLE}?on_conflict=run_id`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([row]),
    });
    if (response.ok) return true;
    const text = await response.text().catch(() => "");
    console.warn(`strategy4 supabase run upsert skipped: HTTP ${response.status} ${text.slice(0, 220)}`.trim());
  } catch (error) {
    console.warn(`strategy4 supabase run upsert skipped: ${error?.message || String(error)}`);
  }
  return false;
}

async function upsertStrategy4ResultsToSupabase(output) {
  if (!SYNC_SUPABASE_RESULTS) {
    writeSupabaseStatus(false, { skipped: true, reason: "disabled" });
    return false;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    writeSupabaseStatus(false, { skipped: true, reason: "missing Supabase service credentials" });
    return false;
  }
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
  const runId = strategy4RunIdFromOutput(output);
  const includeRunId = true;
  const conflictTarget = "run_id,strategy,code";
  let url = `${baseUrl}/rest/v1/${SUPABASE_RESULTS_TABLE}?on_conflict=${conflictTarget}`;
  let mode = process.env.STRATEGY4_SUPABASE_RESULTS_MODE === "minimal" ? "minimal" : "full";
  let rows = buildSupabaseScanRows(output, mode, runId, includeRunId);
  if (!rows.length) {
    writeSupabaseStatus(false, { skipped: true, reason: "no strategy4 matches", table: SUPABASE_RESULTS_TABLE });
    return false;
  }
  let lastMessage = "";
  for (let attempt = 1; attempt <= SUPABASE_RESULTS_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(rows),
      });
      if (response.ok) {
        if (includeRunId) {
          const runOk = await upsertStrategy4RunToSupabase(output, runId);
          if (!runOk) {
            lastMessage = "strategy4 complete run upsert failed";
            throw new Error(lastMessage);
          }
        }
        await publishStrategyCacheStatus("strategy4", "策略4-主力籌碼", output, {
          used_date: output.scanStamp || output.date || scanDateFromOutput(output),
          updated_at: output.updatedAt || new Date().toISOString(),
          scan_status: output.complete === false ? "failed" : "complete",
          scanned: output.total,
          total: output.total,
          match_count: output.count,
          source: SUPABASE_RESULTS_TABLE,
          log: `run_id=${runId}`,
        });
        writeSupabaseStatus(true, {
          table: SUPABASE_RESULTS_TABLE,
          runTable: includeRunId ? SUPABASE_RUNS_TABLE : "",
          runId: includeRunId ? runId : "",
          scanDate: rows[0].scan_date,
          rowCount: rows.length,
          walletStrongBuyCount: rows.filter((row) => row.has_wallet_strong_buy).length,
          walletVolumeCrossCount: rows.filter((row) => row.has_wallet_volume_cross).length,
          qualityStatus: output.qualityStatus,
          mode,
          attempt,
        });
        console.log(`strategy4 supabase upsert ok: ${rows.length} rows into ${SUPABASE_RESULTS_TABLE}, wallet ◆ ${rows.filter((row) => row.has_wallet_strong_buy).length}, 🔺 ${rows.filter((row) => row.has_wallet_volume_cross).length}, quality ${output.qualityStatus}`);
        return true;
      }
      const text = await response.text().catch(() => "");
      lastMessage = `HTTP ${response.status} ${text.slice(0, 500)}`.trim();
      if (includeRunId && /run_id|constraint|schema cache|Could not find|no unique|ON CONFLICT/i.test(lastMessage)) {
        throw new Error(`strategy4 supabase run_id gate unavailable: ${lastMessage}`);
      }
      if (mode === "full" && /column|schema cache|Could not find/i.test(lastMessage)) {
        mode = "minimal";
        rows = buildSupabaseScanRows(output, mode, runId, includeRunId);
        console.warn(`strategy4 supabase full row rejected, retrying minimal columns: ${lastMessage}`);
        continue;
      }
    } catch (error) {
      const cause = error?.cause?.message ? ` (${error.cause.message})` : "";
      lastMessage = `${error?.message || String(error || "unknown error")}${cause}`;
    }
    console.warn(`strategy4 supabase upsert attempt ${attempt}/${SUPABASE_RESULTS_ATTEMPTS} failed: ${lastMessage}`);
    if (attempt < SUPABASE_RESULTS_ATTEMPTS) await sleep(Math.min(15000, 1500 * attempt));
  }
  writeSupabaseStatus(false, {
    table: SUPABASE_RESULTS_TABLE,
    error: lastMessage || "unknown error",
    attempts: SUPABASE_RESULTS_ATTEMPTS,
    mode,
  });
  return false;
}

function refreshSlimCache(label) {
  if (STRATEGY4_API_ONLY) {
    console.log(`strategy4 API-only: skipped slim static output (${label})`);
    return;
  }
  const script = path.join(ROOT, "scripts", "generate-slim-cache.js");
  if (!fs.existsSync(script)) return;
  const result = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (output) {
    output.split(/\r?\n/).filter(Boolean).slice(-10).forEach((line) => console.log(`strategy4 slim (${label}): ${line}`));
  }
  if (result.error) {
    console.log(`strategy4 slim failed (${label}): ${result.error.message}`);
  } else if (result.status !== 0) {
    console.log(`strategy4 slim failed (${label}): exit ${result.status}`);
  }
}

function syncStrategy4Output(label) {
  if (STRATEGY4_API_ONLY) {
    console.log(`strategy4 API-only: skipped static sync (${label})`);
    return;
  }
  if (!SYNC_PARTIAL) return;
  if (!fs.existsSync(SYNC_SCRIPT)) {
    console.log(`strategy4 sync skipped (${label}): missing ${SYNC_SCRIPT}`);
    return;
  }
  refreshSlimCache(label);
  console.log(`strategy4 sync start (${label})`);
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    SYNC_SCRIPT,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (output) {
    output.split(/\r?\n/).filter(Boolean).slice(-20).forEach((line) => console.log(`strategy4 sync: ${line}`));
  }
  if (result.error) {
    console.log(`strategy4 sync failed (${label}): ${result.error.message}`);
  } else if (result.status !== 0) {
    console.log(`strategy4 sync failed (${label}): exit ${result.status}`);
  } else {
    console.log(`strategy4 sync done (${label})`);
  }
}

async function main() {
  if (!FULL_SCAN) {
    throw new Error("Strategy4 API-only requires full scan -> Supabase complete run; partial static JSON runs are disabled");
  }
  const prewarmStatus = runSupabaseHistoryPrewarm();
  const supabaseCoverage = getSupabaseCoverageStatus() || prewarmStatus || null;
  const universe = await fetchUniverse();
  const codes = universe.map((stock) => stock.code);
  if (!codes.length) throw new Error("No stock universe");
  await refreshStrategy4VolumeCacheFromSupabase();

  const previousRaw = {
    ok: true,
    total: codes.length,
    scannedCodes: [],
    matches: [],
  };
  const scanStamp = FULL_SCAN ? RUN_STAMP : (previousRaw.scanStamp || previousRaw.stamp || RUN_STAMP);
  const currentMatches = new Map();
  const dataSourceCounts = new Map();
  const scanned = new Set();
  const noDataCodes = new Set();
  const scanErrors = [];
  let scannedThisRun = 0;
  if (!FULL_SCAN) {
    (previousRaw.matches || []).forEach((item) => currentMatches.set(item.code, item));
    mergeSourceCounts(previousRaw.dataSourceCounts, dataSourceCounts);
    (previousRaw.scannedCodes || []).forEach((code) => {
      if (codes.includes(code)) scanned.add(code);
    });
    (previousRaw.noDataCodes || []).forEach((code) => {
      if (codes.includes(code)) noDataCodes.add(code);
    });
  }

  const volumeFilter = buildVolumePrefilter(universe);
  volumeFilter.filtered.forEach((item) => {
    currentMatches.delete(item.code);
    noDataCodes.delete(item.code);
    scanned.add(item.code);
  });
  const quoteLiquidityFilter = await buildQuoteLiquidityPrefilter(universe);
  quoteLiquidityFilter.filtered.forEach((item) => {
    currentMatches.delete(item.code);
    noDataCodes.delete(item.code);
    scanned.add(item.code);
  });

  const pendingCodes = FULL_SCAN
    ? codes.filter((code) => !scanned.has(code))
    : [...new Set([
      ...codes.filter((code) => !scanned.has(code)),
      ...noDataCodes,
    ])].filter((code) => codes.includes(code));
  const chunksToRun = Math.min(Math.ceil(pendingCodes.length / CHUNK_SIZE), BATCHES_PER_RUN);
  const runMode = FULL_SCAN ? "full" : "resume";

  console.log(`strategy4 volume prefilter: cacheHit ${volumeFilter.cacheHit}, cacheMiss ${volumeFilter.cacheMiss}, filtered ${volumeFilter.filtered.length} below avg5 ${MIN_AVG_VOLUME_5}`);
  console.log(`strategy4 quote liquidity prefilter: cacheHit ${quoteLiquidityFilter.cacheHit}, cacheMiss ${quoteLiquidityFilter.cacheMiss}, quoteRows ${quoteLiquidityFilter.quoteRows}, filtered ${quoteLiquidityFilter.filtered.length} below cumulative bid+ask ${MIN_CUMULATIVE_BID_ASK_VOLUME}`);
  console.log(`strategy4 cache start: ${runMode} scan, ${codes.length} total codes, ${pendingCodes.length} pending codes, ${chunksToRun} chunks in this run`);
  for (let chunk = 0; chunk < chunksToRun; chunk++) {
    const start = chunk * CHUNK_SIZE;
    const chunkSet = new Set(pendingCodes.slice(start, start + CHUNK_SIZE));
    const chunkStocks = universe.filter((stock) => chunkSet.has(stock.code));
    const chunkCodes = chunkStocks.map((stock) => stock.code);
    const label = `strategy4 chunk ${chunk + 1}/${chunksToRun} (${chunkCodes[0]}-${chunkCodes[chunkCodes.length - 1]})`;
    console.log(`${label} start`);
    try {
      const payload = await runHandlerWithRetry(chunkStocks, label);
      chunkCodes.forEach((code) => {
        scanned.add(code);
        noDataCodes.delete(code);
      });
      (payload.noDataCodes || []).forEach((code) => noDataCodes.add(code));
      (payload.errors || []).forEach((error) => scanErrors.push(`${label}: ${error}`));
      mergeSourceCounts(payload.sourceCounts, dataSourceCounts);
      removeScannedMisses(chunkCodes, payload, currentMatches);
      mergeMatches(payload.matches, universe, currentMatches);
      scannedThisRun += chunkCodes.length;
      console.log(`${label} done: matches ${(payload.matches || []).length}`);
    } catch (error) {
      chunkCodes.forEach((code) => noDataCodes.add(code));
      scanErrors.push(`${label}: ${error.message || error}`);
      console.log(`${label} failed; ${chunkCodes.length} codes queued for resume`);
    }
    if (SYNC_PARTIAL && ((chunk + 1) % PARTIAL_SYNC_EVERY_CHUNKS === 0 || chunk + 1 === chunksToRun)) {
      const chunkOutput = buildOutput({
        codes,
        scannedThisRun,
        scanned,
        noDataCodes,
        scanErrors,
        currentMatches,
        dataSourceCounts,
        complete: false,
        runMode,
        scanStamp,
        volumeFilter,
        quoteLiquidityFilter,
        supabaseCoverage,
      });
      writeStrategy4Output(chunkOutput, false);
      syncStrategy4Output(`chunk-${chunk + 1}-of-${chunksToRun}`);
    }
  }

  if (FULL_SCAN && !ALLOW_PARTIAL_PUBLISH && scanned.size !== codes.length) {
    throw new Error(`Strategy4 full scan incomplete: scanned ${scanned.size}/${codes.length}`);
  }

  const firstPassOutput = buildOutput({
    codes,
    scannedThisRun,
    scanned,
    noDataCodes,
    scanErrors,
    currentMatches,
    dataSourceCounts,
    complete: scanned.size === codes.length && !scanErrors.length && !noDataCodes.size,
    runMode,
    scanStamp,
    volumeFilter,
    quoteLiquidityFilter,
    supabaseCoverage,
  });
  console.log(`strategy4 first pass done: ${runMode} scannedThisRun ${scannedThisRun}, scannedTotal ${scanned.size}/${codes.length}, matches ${firstPassOutput.count}, noData ${noDataCodes.size}`);
  if (SYNC_PARTIAL) {
    writeStrategy4Output(firstPassOutput, false);
    syncStrategy4Output("first-pass");
  }

  if (noDataCodes.size && !(SUPABASE_FIRST && SKIP_RETRY_ON_SUPABASE_FIRST)) {
    const retryCodes = [...noDataCodes];
    console.log(`strategy4 retry noData start: ${retryCodes.length} codes, chunk size ${RETRY_CHUNK_SIZE}`);
    for (let index = 0; index < retryCodes.length; index += RETRY_CHUNK_SIZE) {
      const retryChunkCodes = retryCodes.slice(index, index + RETRY_CHUNK_SIZE);
      const retryStocks = retryChunkCodes
        .map((code) => universe.find((stock) => stock.code === code))
        .filter(Boolean);
      const label = `strategy4 retry ${Math.floor(index / RETRY_CHUNK_SIZE) + 1}/${Math.ceil(retryCodes.length / RETRY_CHUNK_SIZE)} (${retryChunkCodes[0]}-${retryChunkCodes[retryChunkCodes.length - 1]})`;
      console.log(`${label} start`);
      const payload = await runHandlerWithRetry(retryStocks, label);
      retryChunkCodes.forEach((code) => noDataCodes.delete(code));
      (payload.noDataCodes || []).forEach((code) => noDataCodes.add(code));
      (payload.errors || []).forEach((error) => scanErrors.push(`${label}: ${error}`));
      mergeSourceCounts(payload.sourceCounts, dataSourceCounts);
      removeScannedMisses(retryChunkCodes, payload, currentMatches);
      mergeMatches(payload.matches, universe, currentMatches);
      const retryOutput = buildOutput({
        codes,
        scannedThisRun,
        scanned,
        noDataCodes,
        scanErrors,
        currentMatches,
        dataSourceCounts,
        complete: false,
        runMode,
        scanStamp,
        volumeFilter,
        quoteLiquidityFilter,
        supabaseCoverage,
      });
      if (SYNC_PARTIAL) {
        writeStrategy4Output(retryOutput, false);
      }
      console.log(`${label} done: matches ${(payload.matches || []).length}, remaining noData ${noDataCodes.size}`);
      await sleep(500);
    }
  }

  const output = buildOutput({
    codes,
    scannedThisRun,
    scanned,
    noDataCodes,
    scanErrors,
    currentMatches,
    dataSourceCounts,
    complete: scanned.size === codes.length && !scanErrors.length && !noDataCodes.size,
    runMode,
    scanStamp,
    volumeFilter,
    quoteLiquidityFilter,
    supabaseCoverage,
  });

  writeStrategy4Output(output, true);
  await upsertStrategy4ResultsToSupabase(output);
  syncStrategy4Output("complete");
  console.log(`strategy4 cache updated: ${runMode} scannedThisRun ${scannedThisRun}, scannedTotal ${scanned.size}/${codes.length}, matches ${output.count}, complete ${output.complete}`);
  if (FAIL_ON_INCOMPLETE && !ALLOW_PARTIAL_PUBLISH && !output.complete) {
    throw new Error(`Strategy4 scan incomplete: noData ${output.noDataCount}, errors ${output.errorCount}`);
  }
  if (FULL_SCAN && output.complete && output.count < MIN_MATCH_COUNT) {
    throw new Error(`Strategy4 suspiciously low match count: ${output.count}/${codes.length}, minimum ${MIN_MATCH_COUNT}`);
  }
  if (FULL_SCAN && output.complete && output.yahooSourceRatio > MAX_YAHOO_SOURCE_RATIO) {
    console.warn(`Strategy4 degraded source mix: Yahoo fallback ${output.yahooSourceCount}/${Object.values(output.dataSourceCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0)} (${output.yahooSourceRatio}), warning threshold ${MAX_YAHOO_SOURCE_RATIO}`);
  }
  const previousCompleteCount = previousRaw?.complete === true ? Number(previousRaw.count || 0) : 0;
  if (FULL_SCAN && output.complete && previousCompleteCount >= MIN_MATCH_COUNT) {
    const minByHistory = Math.max(MIN_MATCH_COUNT, Math.floor(previousCompleteCount * MIN_MATCH_RATIO_TO_PREVIOUS));
    if (output.count < minByHistory) {
      if (ALLOW_FILTER_RULE_DROP && volumeFilterRuleChanged(previousRaw, output)) {
        console.warn(`Strategy4 match drop allowed after filter rule change: ${output.count} vs previous ${previousCompleteCount}, filtered ${output.volumeFilteredCount}, minimum ${minByHistory}`);
        return;
      }
      throw new Error(`Strategy4 suspicious match drop: ${output.count} vs previous ${previousCompleteCount}, minimum ${minByHistory}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});








