const fs = require("fs");
const path = require("path");
const scanStrategy4 = require("../api/scan-strategy4");
const fetchStocks = require("../stocks");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const FUGLE_HISTORY_CACHE_DIR = process.env.FUGLE_HISTORY_CACHE_DIR || path.join(RUNTIME_DIR, "cache", "fugle", "historical");
const SECRET_DIR = path.join(RUNTIME_DIR, "secrets");
const STATUS_FILE = path.join(STATE_DIR, "strategy4-history-prewarm-status.json");
const VOLUME_AVG5_FILE = path.join(RUNTIME_DIR, "cache", "strategy4-volume-avg5.json");
const BATCH_SIZE = Number(process.env.STRATEGY4_PREWARM_BATCH_SIZE || 40);
const BATCHES_PER_RUN = Number(process.env.STRATEGY4_PREWARM_BATCHES_PER_RUN || 0);
const SLEEP_MS = Number(process.env.STRATEGY4_PREWARM_SLEEP_MS || 800);
const MAX_REMAINING_MISS = Number(process.env.STRATEGY4_PREWARM_MAX_REMAINING_MISS || 2000);
const SUPABASE_ONLY = process.env.STRATEGY4_PREWARM_SUPABASE_ONLY !== "0";
const SUPABASE_TABLES = String(process.env.STRATEGY4_SUPABASE_HISTORY_TABLES || "strategy4_daily_ohlcv_view")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const SUPABASE_CODE_FIELDS = String(process.env.STRATEGY4_SUPABASE_HISTORY_CODE_FIELDS || "code,symbol,stock_id,data_id")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const SUPABASE_DATE_FIELDS = String(process.env.STRATEGY4_SUPABASE_HISTORY_DATE_FIELDS || "trade_date,date,trading_date")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function historyCacheFile(code) {
  return path.join(FUGLE_HISTORY_CACHE_DIR, `${normalizeCode(code)}.json`);
}

function normalizeHistoryRow(row) {
  const date = String(row.date || row.trade_date || row.trading_date || "").slice(0, 10);
  const close = cleanNumber(row.close || row.closing_price || row.price);
  const volumeLots = cleanNumber(row.volume_lots ?? row.volumeLots ?? row.volume ?? row.trade_volume ?? row.trading_volume);
  const volumeShares = cleanNumber(row.volume_shares ?? row.volumeShares) || (volumeLots ? volumeLots * 1000 : 0);
  if (!date || !close || !volumeLots) return null;
  return {
    date,
    volume: Number(volumeLots.toFixed(4)),
    volume_lots: Number(volumeLots.toFixed(4)),
    volume_shares: Number(volumeShares.toFixed(0)),
    volumeUnit: "lots",
    value: cleanNumber(row.trade_value_twd ?? row.tradeValueTwd ?? row.value ?? row.turnover ?? row.trade_value ?? row.trading_money),
    open: cleanNumber(row.open || row.opening_price),
    high: cleanNumber(row.high || row.max || row.highest_price),
    low: cleanNumber(row.low || row.min || row.lowest_price),
    close,
    change: cleanNumber(row.change || row.spread),
  };
}

function normalizeVolumeRow(row) {
  const date = String(row.date || row.trade_date || row.trading_date || "").slice(0, 10);
  const volumeLots = cleanNumber(row.volume_lots ?? row.volumeLots ?? row.volume ?? row.trade_volume ?? row.trading_volume);
  const volumeShares = cleanNumber(row.volume_shares ?? row.volumeShares) || (volumeLots ? volumeLots * 1000 : 0);
  if (!date || !volumeLots) return null;
  return {
    date,
    volume: Number(volumeLots.toFixed(4)),
    volume_lots: Number(volumeLots.toFixed(4)),
    volume_shares: Number(volumeShares.toFixed(0)),
    volumeUnit: "lots",
  };
}

function writePrefilterVolumeCache(code, from, to, rows, source = "supabase-fugle-volume") {
  const normalizedRows = rows
    .map(normalizeVolumeRow)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5);
  if (normalizedRows.length < 5) return false;
  fs.mkdirSync(FUGLE_HISTORY_CACHE_DIR, { recursive: true });
  fs.writeFileSync(historyCacheFile(code), `${JSON.stringify({
    code: normalizeCode(code),
    from,
    to,
    source,
    updatedAt: new Date().toISOString(),
    rows: normalizedRows,
  }, null, 2)}\n`);
  return true;
}

function writeHistoryCache(code, from, to, rows, source = "supabase-fugle") {
  const normalizedRows = rows
    .map(normalizeHistoryRow)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-180);
  if (normalizedRows.length < 60) return false;
  fs.mkdirSync(FUGLE_HISTORY_CACHE_DIR, { recursive: true });
  fs.writeFileSync(historyCacheFile(code), `${JSON.stringify({
    code: normalizeCode(code),
    from,
    to,
    source,
    updatedAt: new Date().toISOString(),
    rows: normalizedRows,
  }, null, 2)}\n`);
  return true;
}

function hasFreshHistoryCache(code, from, to) {
  try {
    const payload = JSON.parse(fs.readFileSync(historyCacheFile(code), "utf8"));
    return payload?.code === normalizeCode(code)
      && payload?.from === from
      && payload?.to === to
      && Array.isArray(payload?.rows)
      && payload.rows.length >= 60;
  } catch {
    return false;
  }
}

function writeStatus(status) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify({
    ...status,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function updateVolumeAvg5Cache(rows) {
  const cache = readJson(VOLUME_AVG5_FILE, { source: "supabase:fugle_daily_volume", byCode: {} });
  const byCode = cache.byCode && typeof cache.byCode === "object" ? cache.byCode : {};
  let updated = 0;
  rows.forEach((row) => {
    const code = normalizeCode(row.symbol || row.code || row.stock_id || row.data_id);
    const date = String(row.trade_date || row.date || row.trading_date || "").slice(0, 10);
    const volume = cleanNumber(row.volume || row.trade_volume || row.trading_volume);
    if (!/^\d{4}$/.test(code) || !date || !volume) return;
    const current = Array.isArray(byCode[code]) ? byCode[code] : [];
    const map = new Map(current.map((item) => [item.date, item]));
    map.set(date, { date, volume });
    byCode[code] = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
    updated += 1;
  });
  fs.mkdirSync(path.dirname(VOLUME_AVG5_FILE), { recursive: true });
  fs.writeFileSync(VOLUME_AVG5_FILE, `${JSON.stringify({
    source: "supabase:fugle_daily_volume",
    updatedAt: new Date().toISOString(),
    byCode,
  }, null, 2)}\n`);
  return updated;
}

async function fetchSupabaseDailyVolumeRows(from, to) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/fugle_daily_volume`);
    url.searchParams.set("select", "symbol,trade_date,volume");
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
    if (!response.ok) break;
    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function readSupabaseSyncStatus(to) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const url = new URL(`${SUPABASE_URL}/rest/v1/fugle_daily_sync_status`);
  url.searchParams.set("select", "trade_date,source,status,finished_at,symbols_expected,symbols_loaded,missing_symbols_count,error_message,updated_at");
  url.searchParams.set("trade_date", `eq.${to}`);
  url.searchParams.set("source", "eq.fugle");
  url.searchParams.set("order", "updated_at.desc");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchSupabaseRows(table, codeField, dateField, codes, from, to) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !table || !codeField || !dateField || !codes.length) return null;
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
    url.searchParams.set("select", "*");
    url.searchParams.set(codeField, `in.(${codes.join(",")})`);
    url.searchParams.append(dateField, `gte.${from}`);
    url.searchParams.append(dateField, `lte.${to}`);
    url.searchParams.set("order", `${dateField}.asc`);
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) return rows.length ? rows : null;
    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function warmFromSupabase(stocks, from, to) {
  const codes = stocks.map((stock) => stock.code);
  for (const table of SUPABASE_TABLES) {
    for (const codeField of SUPABASE_CODE_FIELDS) {
      for (const dateField of SUPABASE_DATE_FIELDS) {
        let rows = null;
        try {
          rows = await fetchSupabaseRows(table, codeField, dateField, codes, from, to);
        } catch {
          rows = null;
        }
        if (!rows?.length) continue;
        const byCode = new Map();
        rows.forEach((row) => {
          const code = normalizeCode(row[codeField] || row.code || row.symbol || row.stock_id || row.data_id);
          if (!codes.includes(code)) return;
          if (!byCode.has(code)) byCode.set(code, []);
          byCode.get(code).push(row);
        });
        let warmed = 0;
        byCode.forEach((items, code) => {
          if (
            writeHistoryCache(code, from, to, items, `supabase:${table}`)
            || writePrefilterVolumeCache(code, from, to, items, `supabase:${table}`)
          ) warmed += 1;
        });
        if (warmed > 0) {
          return { warmed, table, codeField, dateField };
        }
      }
    }
  }
  return { warmed: 0, table: "", codeField: "", dateField: "" };
}

function callStocksHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `stocks HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, stocks: [] }); },
    };
    Promise.resolve(fetchStocks(req, res)).catch(reject);
  });
}

function callStrategy4Handler(stocks) {
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
        if (this.statusCode >= 400) reject(new Error(payload?.error || `strategy4 HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanStrategy4(req, res)).catch(reject);
  });
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code || row.symbol || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  const industry = String(row.industry || row.officialIndustry || row.primaryIndustry || "").trim();
  const text = `${code} ${name} ${industry}`;
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  if (row.is_active === false || flagTrue(row.is_etf) || flagTrue(row.is_warrant) || flagTrue(row.is_cb) || flagTrue(row.is_blacklisted) || flagTrue(row.is_daytrade_unsuitable)) return null;
  if (/(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) return null;
  if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) return null;
  return {
    code,
    name,
    market: String(row.Market || row.market || row["市場"] || "").trim().toUpperCase(),
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    industry,
  };
}

async function fetchSupabaseUniverse() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;
  for (const table of ["stock_universe", "stock_tickers"]) {
    rows.length = 0;
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      url.searchParams.set("select", table === "stock_universe"
        ? "symbol,name,market,industry,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,is_active"
        : "symbol,name,market,stock_type,industry,is_etf,is_suspended");
      if (table === "stock_universe") {
        url.searchParams.set("is_active", "eq.true");
        url.searchParams.set("is_etf", "eq.false");
        url.searchParams.set("is_warrant", "eq.false");
        url.searchParams.set("is_cb", "eq.false");
        url.searchParams.set("is_blacklisted", "eq.false");
        url.searchParams.set("is_daytrade_unsuitable", "eq.false");
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
      console.log(`strategy4 supabase ${table} prewarm universe: ${rows.length}`);
      return rows.map(normalizeStock).filter(Boolean);
    }
  }
  return [];
}

async function main() {
  const from = isoDateDaysAgo(270);
  const to = new Date().toISOString().slice(0, 10);
  let universe = await fetchSupabaseUniverse();
  if (!universe.length) {
    const payload = await callStocksHandler();
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    universe = rows.map(normalizeStock).filter(Boolean);
  }
  universe = universe.sort((a, b) => a.code.localeCompare(b.code));
  const missing = universe.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
  const batchesToRun = Math.min(Math.ceil(missing.length / BATCH_SIZE), BATCHES_PER_RUN);
  const sourceCounts = {};
  const errors = [];
  let scanned = 0;
  let supabaseWarmed = 0;
  const supabaseSources = {};
  let supabaseVolumeRows = 0;
  let supabaseVolumeUpdated = 0;
  let supabaseSyncStatus = null;

  try {
    const syncStatus = await readSupabaseSyncStatus(to);
    supabaseSyncStatus = syncStatus;
    if (syncStatus) {
      console.log(`strategy4 supabase sync status: ${syncStatus.status} ${syncStatus.symbols_loaded || 0}/${syncStatus.symbols_expected || 0}, missing ${syncStatus.missing_symbols_count || 0}`);
      if (!["complete", "partial"].includes(String(syncStatus.status || "").toLowerCase())) {
        errors.push(`supabase sync status ${syncStatus.status || "unknown"} for ${to}`);
      }
    } else {
      console.log("strategy4 supabase sync status unavailable");
    }
  } catch (error) {
    errors.push(`supabase sync status: ${error.message || error}`);
  }

  try {
    const volumeRows = await fetchSupabaseDailyVolumeRows(isoDateDaysAgo(14), to);
    supabaseVolumeRows = volumeRows.length;
    supabaseVolumeUpdated = updateVolumeAvg5Cache(volumeRows);
    console.log(`strategy4 supabase daily volume cache updated: rows ${supabaseVolumeRows}, writes ${supabaseVolumeUpdated}`);
  } catch (error) {
    errors.push(`supabase daily volume cache: ${error.message || error}`);
  }

  console.log(`strategy4 history prewarm start: universe ${universe.length}, cache missing ${missing.length}, batches ${batchesToRun}`);
  writeStatus({
    ok: true,
    source: "strategy4-history-prewarm",
    phase: "running",
    universe: universe.length,
    missingBefore: missing.length,
    scanned: 0,
    remainingMiss: missing.length,
    errors: [],
  });

  for (let batch = 0; batch < batchesToRun; batch++) {
    const chunk = missing.slice(batch * BATCH_SIZE, batch * BATCH_SIZE + BATCH_SIZE);
    if (!chunk.length) break;
    const label = `prewarm batch ${batch + 1}/${batchesToRun} (${chunk[0].code}-${chunk[chunk.length - 1].code})`;
    console.log(`${label} start`);
    const supabaseResult = await warmFromSupabase(chunk, from, to);
    if (supabaseResult.warmed > 0) {
      supabaseWarmed += supabaseResult.warmed;
      const key = `${supabaseResult.table}.${supabaseResult.codeField}.${supabaseResult.dateField}`;
      supabaseSources[key] = (supabaseSources[key] || 0) + supabaseResult.warmed;
      console.log(`${label} supabase warmed ${supabaseResult.warmed} via ${key}`);
    }
    const stillMissing = chunk.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
    if (!stillMissing.length) {
      scanned += chunk.length;
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
      continue;
    }
    if (SUPABASE_ONLY) {
      scanned += chunk.length;
      console.log(`${label} supabase-only: skip strategy API fallback for ${stillMissing.length} missing history caches`);
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
      continue;
    }
    try {
      const result = await callStrategy4Handler(stillMissing);
      Object.entries(result.sourceCounts || {}).forEach(([source, count]) => {
        sourceCounts[source] = (sourceCounts[source] || 0) + Number(count || 0);
      });
      (result.errors || []).forEach((error) => errors.push(`${label}: ${error}`));
      scanned += chunk.length;
      console.log(`${label} done: noData ${(result.noDataCodes || []).length}, errors ${(result.errors || []).length}`);
    } catch (error) {
      errors.push(`${label}: ${error.message || error}`);
      console.log(`${label} failed: ${error.message || error}`);
    }
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  const remainingMiss = universe.filter((stock) => !hasFreshHistoryCache(stock.code, from, to)).length;
  const status = {
    ok: remainingMiss <= MAX_REMAINING_MISS,
    source: "strategy4-history-prewarm",
    phase: "complete",
    universe: universe.length,
    missingBefore: missing.length,
    scanned,
    remainingMiss,
    maxRemainingMiss: MAX_REMAINING_MISS,
    sourceCounts,
    supabaseWarmed,
    supabaseSources,
    supabaseSyncStatus,
    supabaseVolumeRows,
    supabaseVolumeUpdated,
    errors: errors.slice(-50),
  };
  writeStatus(status);
  console.log(`strategy4 history prewarm complete: scanned ${scanned}, remainingMiss ${remainingMiss}/${universe.length}`);
  if (!status.ok) {
    throw new Error(`Strategy4 history prewarm remaining cache miss too high: ${remainingMiss}/${MAX_REMAINING_MISS}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  writeStatus({
    ok: false,
    source: "strategy4-history-prewarm",
    phase: "failed",
    error: error.message || String(error),
  });
  process.exit(1);
});


