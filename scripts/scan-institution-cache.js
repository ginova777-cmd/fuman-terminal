const fs = require("fs");
const path = require("path");
const scanInstitution = require("../api/institution");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const { writeSummary } = require("./cache-summary");

const { ROOT, dataPath } = require("./runtime-paths");
const { chipTradeExclusion, loadChipTradeBlacklist } = require("../lib/chip-trade-exclusions");
const OUT_FILE = dataPath("institution-latest.json");
const BACKUP_FILE = dataPath("institution-backup.json");
const SUMMARY_FILE = dataPath("institution-summary.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const SLOW_SCAN = ["1", "true", "yes"].includes(String(process.env.INSTITUTION_SLOW_SCAN || "").toLowerCase());
const REQUEST_DELAY_MS = Number(process.env.INSTITUTION_REQUEST_DELAY_MS || (SLOW_SCAN ? 15000 : 1200));
const FETCH_RETRIES = Number(process.env.INSTITUTION_FETCH_RETRIES || (SLOW_SCAN ? 4 : 1));
const MIN_SOURCE_ROWS = Number(process.env.INSTITUTION_MIN_SOURCE_ROWS || 1000);
const MIN_OUTPUT_ROWS = Number(process.env.INSTITUTION_MIN_OUTPUT_ROWS || 250);
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const INSTITUTION_RUNS_TABLE = process.env.INSTITUTION_SUPABASE_RUNS_TABLE || "institution_scan_runs";
const INSTITUTION_RESULTS_TABLE = process.env.INSTITUTION_SUPABASE_RESULTS_TABLE || "institution_scan_results";
const INSTITUTION_API_ONLY = true;

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableFetchError(error) {
  const message = String(error?.message || "");
  return /HTTP (403|429|500|502|503|504)|aborted|fetch failed/i.test(message);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function ymdToDate(ymd) {
  const text = String(ymd || "");
  if (!/^\d{8}$/.test(text)) return null;
  return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00+08:00`);
}

function taipeiDateOnly() {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${text}T00:00:00+08:00`);
}

function ageInDays(ymd) {
  const date = ymdToDate(ymd);
  if (!date) return Infinity;
  return Math.floor((taipeiDateOnly() - date) / 86400000);
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, data: {} }); },
    };
    Promise.resolve(scanInstitution(req, res)).catch(reject);
  });
}

async function fetchJson(url, timeout = 30000) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
        },
      });
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES || !isRetriableFetchError(error)) break;
      const backoffMs = REQUEST_DELAY_MS + attempt * (SLOW_SCAN ? 30000 : 3000);
      await sleep(backoffMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function runStocksHandler() {
  try {
    return await fetchJson(STOCK_URL, 30000);
  } catch (error) {
    console.log(`stock universe fetch failed: ${error.message}`);
    return { ok: false, stocks: [] };
  }
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function normalizeDateKey(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function dateForSupabase(value) {
  const key = normalizeDateKey(value);
  if (key.length === 8) return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  return new Date().toISOString().slice(0, 10);
}

function institutionRunIdFromOutput(output) {
  const stamp = normalizeDateKey(output.usedDate || output.date || output.updatedAt || new Date().toISOString()) || "unknown";
  const time = String(output.updatedAt || new Date().toISOString()).replace(/\D/g, "").slice(0, 14).padEnd(14, "0");
  return String(output.runId || process.env.INSTITUTION_RUN_ID || `institution-${stamp}-${time}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function upsertSupabaseRows(table, rows, conflict) {
  if (!rows.length) return;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("institution supabase credentials missing");
  const batchSize = Math.max(1, Number(process.env.INSTITUTION_SUPABASE_BATCH_SIZE || 300));
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${table} upsert HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
  }
}

function buildInstitutionRunRow(output, runId, status = "complete") {
  const complete = status === "complete";
  const scanTime = String(output.updatedAt || new Date().toISOString());
  const sourceCount = Object.keys(output.data || {}).length;
  return {
    run_id: runId,
    strategy: "institution",
    scan_date: dateForSupabase(output.usedDate || output.date || output.updatedAt),
    started_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    finished_at: complete ? scanTime : null,
    status,
    expected_total: cleanNumber(output.sourceCount || sourceCount),
    scanned_count: cleanNumber(output.scannedCount || output.sourceCount || sourceCount),
    result_count: complete ? sourceCount : 0,
    complete,
    quality_status: complete ? "complete" : status,
    source: String(output.source || "").trim(),
    schema_version: output.schemaVersion || "institution-run-id-complete-v1",
    data_contract_source: output.dataContractSource || "institution-cache",
    generated_at: scanTime,
    updated_at: scanTime,
    payload: {
      count: cleanNumber(output.count),
      usedDate: output.usedDate || "",
      quoteUpdatedAt: output.quoteUpdatedAt || "",
      sourceHealth: output.sourceHealth || {},
    },
  };
}

function buildInstitutionResultRows(output, runId) {
  const scanDate = dateForSupabase(output.usedDate || output.date || output.updatedAt);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return Object.values(output.data || {})
    .sort((a, b) => Math.abs(cleanNumber(b.total)) - Math.abs(cleanNumber(a.total)) || String(a.code).localeCompare(String(b.code)))
    .map((row, index) => ({
      run_id: runId,
      strategy: "institution",
      scan_date: scanDate,
      code: normalizeCode(row.code),
      name: String(row.name || row.code || "").trim(),
      close: cleanNumber(row.close),
      change_percent: cleanNumber(row.percent),
      trade_volume: cleanNumber(row.tradeVolume),
      trade_value: cleanNumber(row.value),
      foreign_net: cleanNumber(row.foreign),
      trust_net: cleanNumber(row.trust),
      dealer_net: cleanNumber(row.dealer),
      total_net: cleanNumber(row.total),
      rank: index + 1,
      reason: "",
      payload: row,
      complete: true,
      quality_status: "complete",
      schema_version: output.schemaVersion || "institution-run-id-complete-v1",
      data_contract_source: output.dataContractSource || "institution-cache",
      generated_at: scanTime,
      updated_at: scanTime,
    }))
    .filter((row) => row.code);
}

async function publishInstitutionCompleteRunToSupabase(output) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("institution supabase run_id gate skipped: missing service role key");
    return null;
  }
  const runId = institutionRunIdFromOutput(output);
  const running = buildInstitutionRunRow(output, runId, "running");
  const rows = buildInstitutionResultRows(output, runId);
  await upsertSupabaseRows(INSTITUTION_RUNS_TABLE, [running], "run_id");
  await upsertSupabaseRows(INSTITUTION_RESULTS_TABLE, rows, "run_id,strategy,code");
  await upsertSupabaseRows(INSTITUTION_RUNS_TABLE, [buildInstitutionRunRow(output, runId, "complete")], "run_id");
  console.log(`institution supabase run_id gate ok: ${runId}, rows ${rows.length}`);
  return runId;
}

function formatTwseDate(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function recentTradingDates(limit = 8) {
  const dates = [];
  const date = new Date();
  date.setDate(date.getDate() - 1);
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function signedChange(sign, value) {
  const amount = cleanNumber(value);
  const text = String(sign || "");
  if (text.includes("-") || text.includes("color:green")) return -Math.abs(amount);
  if (text.includes("+") || text.includes("color:red")) return Math.abs(amount);
  return amount;
}

function collectTradingMetric(bucket, code, close, change, volume) {
  if (!/^\d{4}$/.test(code) || close <= 0 || volume <= 0) return;
  const prevClose = close - change;
  const pct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const list = bucket.get(code) || [];
  list.push({ pct, volume });
  bucket.set(code, list);
}

async function fetchHistoricalTradingMetrics() {
  const bucket = new Map();
  const warnings = [];
  for (const date of recentTradingDates()) {
    try {
      const tradeDate = formatTwseDate(date);
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${tradeDate}&type=ALLBUT0999&response=json`, 25000);
      const table = (payload.tables || []).find((item) => String(item.title || "").includes("每日收盤行情"));
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("證券代號"));
      const closeIndex = fields.findIndex((field) => String(field).includes("收盤價"));
      const signIndex = fields.findIndex((field) => String(field).includes("漲跌(+/-)"));
      const changeIndex = fields.findIndex((field) => String(field).includes("漲跌價差"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && closeIndex >= 0 && changeIndex >= 0 && volumeIndex >= 0) {
        data.forEach((row) => collectTradingMetric(
          bucket,
          String(row[codeIndex] || "").trim(),
          cleanNumber(row[closeIndex]),
          signedChange(signIndex >= 0 ? row[signIndex] : "", row[changeIndex]),
          cleanNumber(row[volumeIndex])
        ));
      }
    } catch (error) {
      warnings.push(`twse 5-day metrics failed: ${formatTwseDate(date)} :: ${error.message}`);
    }
    try {
      const tradeDate = formatTpexDate(date);
      const payload = await fetchJson(`https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(tradeDate)}&s=0,asc,0`, 25000);
      const table = (payload.tables || []).find((item) => (item.data || []).length);
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("代號"));
      const closeIndex = fields.findIndex((field) => String(field).includes("收盤"));
      const changeIndex = fields.findIndex((field) => String(field).includes("漲跌"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && closeIndex >= 0 && changeIndex >= 0 && volumeIndex >= 0) {
        data.forEach((row) => collectTradingMetric(
          bucket,
          String(row[codeIndex] || "").trim(),
          cleanNumber(row[closeIndex]),
          cleanNumber(row[changeIndex]),
          cleanNumber(row[volumeIndex])
        ));
      }
    } catch (error) {
      warnings.push(`tpex 5-day metrics failed: ${formatTpexDate(date)} :: ${error.message}`);
    }
  }
  const map = new Map();
  bucket.forEach((values, code) => {
    const usable = values.slice(0, 5);
    if (!usable.length) return;
    const fiveDayPctSum = usable.reduce((sum, item) => sum + item.pct, 0);
    const fiveDayAvgVolume = usable.reduce((sum, item) => sum + item.volume, 0) / usable.length;
    map.set(code, {
      fiveDayPctSum: Number(fiveDayPctSum.toFixed(2)),
      fiveDayAvgVolume: Math.round(fiveDayAvgVolume),
    });
  });
  return { map, warnings };
}

function buildQuoteMap(payload) {
  const rows = Array.isArray(payload?.stocks) ? payload.stocks : [];
  const map = new Map();
  for (const row of rows) {
    const code = String(row.Code || row.code || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    const close = cleanNumber(row.ClosingPrice || row.close);
    const change = cleanNumber(row.Change || row.change);
    const tradeVolume = cleanNumber(row.TradeVolume || row.tradeVolume);
    const value = cleanNumber(row.TradeValue || row.value);
    const previous = close - change;
    const percent = previous ? (change / previous) * 100 : cleanNumber(row.Percent || row.percent);
    map.set(code, {
      code,
      name: String(row.Name || row.name || "").trim(),
      close,
      change,
      percent: Number(percent.toFixed ? percent.toFixed(2) : percent) || 0,
      tradeVolume,
      value,
      market: row.Market || row.market || "",
    });
  }
  return map;
}

function buildQuoteMapFromInstitutionData(data) {
  const map = new Map();
  for (const row of Object.values(data || {})) {
    const code = String(row.code || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    const close = cleanNumber(row.close);
    const tradeVolume = cleanNumber(row.tradeVolume);
    if (close <= 0 && tradeVolume <= 0) continue;
    map.set(code, {
      code,
      name: String(row.name || "").trim(),
      close,
      change: Number(row.change) || 0,
      percent: Number(row.percent) || 0,
      tradeVolume,
      value: cleanNumber(row.value),
      market: row.quoteMarket || row.market || "",
    });
  }
  return map;
}

function enrichInstitutionData(data, quoteMap, tradingMetricMap = new Map()) {
  const output = {};
  for (const [code, row] of Object.entries(data || {})) {
    const quote = quoteMap.get(code) || {};
    const metrics = tradingMetricMap.get(code) || {};
    output[code] = {
      ...row,
      code,
      name: row.name || quote.name || code,
      close: cleanNumber(row.close) || quote.close || 0,
      change: Number.isFinite(Number(row.change)) ? Number(row.change) : (quote.change || 0),
      percent: Number.isFinite(Number(row.percent)) ? Number(row.percent) : (quote.percent || 0),
      tradeVolume: cleanNumber(row.tradeVolume) || quote.tradeVolume || 0,
      value: cleanNumber(row.value) || quote.value || 0,
      quoteMarket: row.quoteMarket || quote.market || "",
      fiveDayPctSum: Number.isFinite(Number(row.fiveDayPctSum)) ? Number(row.fiveDayPctSum) : (metrics.fiveDayPctSum || 0),
      fiveDayAvgVolume: cleanNumber(row.fiveDayAvgVolume) || metrics.fiveDayAvgVolume || 0,
    };
  }
  return output;
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, data: {} });
  let payload;
  let stockPayload;
  let tradingMetricResult;
  if (SLOW_SCAN) {
    console.log(`institution slow scan enabled: requestDelay=${REQUEST_DELAY_MS}ms retries=${FETCH_RETRIES}`);
    payload = await runHandler();
    await sleep(5000);
    stockPayload = await runStocksHandler();
    await sleep(5000);
    tradingMetricResult = await fetchHistoricalTradingMetrics();
  } else {
    [payload, stockPayload, tradingMetricResult] = await Promise.all([runHandler(), runStocksHandler(), fetchHistoricalTradingMetrics()]);
  }
  if ((payload.errors || []).length) {
    console.warn(`institution source warnings: ${(payload.errors || []).join(" | ")}`);
  }
  const stockRows = Array.isArray(stockPayload?.stocks) ? stockPayload.stocks.length : 0;
  if (!stockPayload?.ok || stockRows < 100) {
    console.warn(`stock universe quote enrichment weak: ok=${Boolean(stockPayload?.ok)}, rows=${stockRows}`);
  }
  const quoteMap = buildQuoteMap(stockPayload);
  if (quoteMap.size < 100) {
    const backupQuoteMap = buildQuoteMapFromInstitutionData(backup.data || {});
    backupQuoteMap.forEach((quote, code) => quoteMap.set(code, quote));
    console.warn(`stock universe fallback used: backupQuotes=${backupQuoteMap.size}`);
  }
  const misQuotes = await fetchMisQuotes(Object.keys(payload.data || {}));
  if (!misQuotes.size) {
    console.warn("MIS quote enrichment returned 0 rows; institution rows will still be guarded by official source freshness");
  }
  misQuotes.forEach((quote, code) => quoteMap.set(code, {
    code,
    name: quote.name,
    close: quote.close,
    change: quote.change,
    percent: Number(quote.percent.toFixed(2)),
    tradeVolume: quote.tradeVolume,
    value: quote.value,
    market: quote.market,
  }));
  tradingMetricResult.warnings.forEach((warning) => console.warn(`institution metric warning: ${warning}`));
  const enrichedData = enrichInstitutionData(payload.data || {}, quoteMap, tradingMetricResult.map);
  const blacklistCodes = loadChipTradeBlacklist();
  const data = {};
  const excludedCounts = {};
  for (const [code, row] of Object.entries(enrichedData)) {
    const exclusion = chipTradeExclusion(row, blacklistCodes);
    if (exclusion.excluded) {
      for (const reason of exclusion.reasons) excludedCounts[reason] = (excludedCounts[reason] || 0) + 1;
      continue;
    }
    data[code] = row;
  }
  const count = Object.keys(data).length;
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    quoteUpdatedAt: stockPayload?.updatedAt || "",
    sourceHealth: {
      fiveDayMetricCount: tradingMetricResult.map.size,
      excludedBeforePublish: Object.values(excludedCounts).reduce((sum, value) => sum + value, 0),
      excludedCounts,
      warningCount: tradingMetricResult.warnings.length,
      warnings: tradingMetricResult.warnings.slice(0, 8),
    },
    count,
    data,
  };
  output.runId = institutionRunIdFromOutput(output);
  output.complete = true;
  output.schemaVersion = output.schemaVersion || "institution-run-id-complete-v1";
  output.dataContractSource = output.dataContractSource || "institution-cache";

  const dataAge = ageInDays(output.usedDate);
  const sourceCount = Object.keys(payload.data || {}).length;
  if (sourceCount < MIN_SOURCE_ROWS) {
    console.error(`institution source returned too few rows (${sourceCount}); keeping existing cache files unchanged`);
    process.exit(2);
  }
  if (count < MIN_OUTPUT_ROWS) {
    console.error(`institution cache scan returned too few rows after exclusions (${count}); keeping existing cache files unchanged`);
    process.exit(2);
  }
  if (dataAge > 3) {
    console.error(`institution cache is stale: usedDate ${output.usedDate || "--"}, age ${dataAge} days; keeping existing cache files unchanged`);
    process.exit(2);
  }

  await publishInstitutionCompleteRunToSupabase(output);

  if (INSTITUTION_API_ONLY) {
    console.log(`institution API-only: skipped static institution*.json output, rows ${count}, usedDate ${output.usedDate || "--"}`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  writeSummary("institution", output, SUMMARY_FILE);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`institution cache updated: rows ${count}, usedDate ${output.usedDate || "--"}, stockRows ${stockRows}, misQuotes ${misQuotes.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

