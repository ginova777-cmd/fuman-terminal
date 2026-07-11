const fs = require("fs");
const path = require("path");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const { overlayFugleWebSocketQuotes } = require("../lib/fugle-quote-overlay");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");
const institutionLatestHandler = require("../api/institution-latest");
const { buildRunTimeSourceSnapshotFields } = require("../lib/run-time-source-snapshot-contract");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("strategy5-latest.json");
const BACKUP_FILE = dataPath("strategy5-backup.json");
const CB_DETECT_FILE = dataPath("cb-detect-latest.json");
const WARRANT_FLOW_FILE = dataPath("warrant-flow-latest.json");
const WARRANT_SINGLE_SIGNAL_FILE = dataPath("warrant-single-signal-top.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const CAPITAL_URLS = [
  "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
  "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
];
const USE_MIS_QUOTES = process.env.STRATEGY5_USE_MIS === "1";
const HISTORY_CONCURRENCY = Math.max(1, Number(process.env.STRATEGY5_HISTORY_CONCURRENCY || 8));
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const SUPABASE_READ_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const STRATEGY5_RUNS_TABLE = process.env.STRATEGY5_SUPABASE_RUNS_TABLE || "strategy5_scan_runs";
const STRATEGY5_RESULTS_TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";
const STRATEGY4_RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const STRATEGY4_RESULTS_TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const STRATEGY5_API_ONLY = true;
const STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS = Number(process.env.STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS || 3);
const STRATEGY5_MAX_LOCAL_STOCKS_CACHE_AGE_DAYS = Number(process.env.STRATEGY5_MAX_LOCAL_STOCKS_CACHE_AGE_DAYS || 4);
const STRATEGY5_BOLLINGER_NARROW_PCT = Number(process.env.STRATEGY5_BOLLINGER_NARROW_PCT || 5);
const STRATEGY5_BOLLINGER_WIDE_PCT = Number(process.env.STRATEGY5_BOLLINGER_WIDE_PCT || 20);
let universeSourceHealth = {};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function createCaptureResponse() {
  let statusCode = 200;
  let payload = null;
  return {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
    get statusCode() { return statusCode; },
    get payload() { return payload; },
  };
}

async function loadInstitutionLatestPayload() {
  const response = createCaptureResponse();
  await institutionLatestHandler({ method: "GET", fumanInternalVerify: true }, response);
  const payload = response.payload;
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  if (response.statusCode >= 400 || !payload?.ok || !payload?.complete || !Object.keys(data).length) {
    const detail = payload?.detail || payload?.error || `HTTP ${response.statusCode}`;
    throw new Error(`strategy5 institution latest unavailable: ${detail}`);
  }
  return payload;
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function cleanNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(String(value).replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function firstNullableNumber(...values) {
  for (const value of values) {
    const number = cleanNullableNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function roundNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

const STRATEGY5_REQUIRED_FIELD_GROUPS = {
  code: ["code"],
  name: ["name"],
  price: ["close", "price"],
  changePercent: ["percent", "changePercent", "change_percent"],
  volume: ["tradeVolume", "volume", "trade_volume"],
  score: ["score"],
  reason: ["reason", "activeMatch.reason", "matches.0.reason"],
  signals: ["matches", "signals", "sourceSignals", "activeMatch"],
};

function deepValue(object, key) {
  return String(key || "").split(".").filter(Boolean).reduce((cursor, part) => {
    if (Array.isArray(cursor) && /^\d+$/.test(part)) return cursor[Number(part)];
    return cursor && typeof cursor === "object" ? cursor[part] : undefined;
  }, object);
}

function hasFieldValue(row, fields, group = "") {
  return fields.some((field) => {
    const value = deepValue(row, field);
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (["price", "volume", "score"].includes(group)) return Number(value) > 0;
    if (group === "changePercent") return !(typeof value === "string" && !value.trim()) && Number.isFinite(Number(value));
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });
}

function buildStrategy5FieldCompleteness(rows) {
  const checkedRows = Array.isArray(rows) ? rows : [];
  const blankCounts = Object.fromEntries(Object.keys(STRATEGY5_REQUIRED_FIELD_GROUPS).map((key) => [key, 0]));
  const sampleMissingRows = [];
  checkedRows.forEach((row, index) => {
    const missingGroups = [];
    for (const [group, fields] of Object.entries(STRATEGY5_REQUIRED_FIELD_GROUPS)) {
      if (!hasFieldValue(row, fields, group)) {
        blankCounts[group] += 1;
        missingGroups.push(group);
      }
    }
    if (missingGroups.length && sampleMissingRows.length < 5) {
      sampleMissingRows.push({
        index,
        code: String(row?.code || "").trim(),
        name: String(row?.name || "").trim(),
        missingGroups,
      });
    }
  });
  const blankTotal = Object.values(blankCounts).reduce((sum, value) => sum + value, 0);
  const denominator = Math.max(1, checkedRows.length * Object.keys(STRATEGY5_REQUIRED_FIELD_GROUPS).length);
  return {
    requiredFields: STRATEGY5_REQUIRED_FIELD_GROUPS,
    rowsChecked: checkedRows.length,
    blankCounts,
    blankTotal,
    blankRate: Number((blankTotal / denominator).toFixed(6)),
    sampleMissingRows,
  };
}

function buildWriteBudget(output, resultCount, finalStatus = "complete") {
  const limit = Number(process.env.STRATEGY5_WRITE_BUDGET_LIMIT_ROWS || 3000);
  const scannedCount = Array.isArray(output.scannedCodes) ? output.scannedCodes.length : cleanNumber(output.scannedThisRun);
  const used = scannedCount + cleanNumber(resultCount) + 1;
  return {
    ok: used > 0 && used <= limit && finalStatus === "complete",
    budgetName: "strategy5-daily-complete-run",
    limit,
    limitRows: limit,
    used,
    estimatedRowsWritten: used,
    writesCompleted: finalStatus === "complete" ? used : 0,
    scannedCount,
    resultCount: cleanNumber(resultCount),
    runRows: 1,
    remaining: Math.max(0, limit - used),
    remainingRows: Math.max(0, limit - used),
    finalStatus,
    overBudget: used > limit,
    reason: used <= limit ? "within_strategy5_write_budget" : "strategy5_write_budget_exceeded",
  };
}

function buildChipSourceStatusAtRun(sourceHealth = {}, dataFreshness = {}) {
  const coverageStatus = String(sourceHealth.coverageStatus || sourceHealth.coverage_status || dataFreshness.coverageStatus || "").toLowerCase();
  const latestTradeDate = sourceHealth.latestTradeDate || sourceHealth.latest_trade_date || dataFreshness.latestTradeDate || "";
  const minRequiredRows = cleanNumber(sourceHealth.minRequiredRows || sourceHealth.min_required_rows || 1500);
  const institutionalRows = cleanNumber(sourceHealth.institutionalRows || sourceHealth.institutional_rows);
  const marginRows = cleanNumber(sourceHealth.marginRows || sourceHealth.margin_rows);
  const unifiedRows = cleanNumber(sourceHealth.unifiedRows || sourceHealth.unified_rows);
  const validAfterExclusionRows = cleanNumber(sourceHealth.validAfterExclusionRows || sourceHealth.valid_after_exclusion_rows);
  const ok = coverageStatus === "ready" && validAfterExclusionRows >= minRequiredRows;
  return {
    ok,
    status: ok ? "ready" : (coverageStatus || "not_ready"),
    strategyAuthority: "chip",
    source: "v_institution_source_health",
    coverageStatus,
    latestTradeDate,
    latestTradeDateKey: compactDateKey(latestTradeDate),
    institutionalRows,
    marginRows,
    unifiedRows,
    validAfterExclusionRows,
    minRequiredRows,
    staleDays: cleanNumber(sourceHealth.staleDays || sourceHealth.stale_days),
    reason: sourceHealth.healthReason || sourceHealth.reason || dataFreshness.reason || (ok ? "chip source ready at run" : "chip source not ready at run"),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function strategy5RunIdFromOutput(output) {
  const stamp = String(output.runMarketDate || output.sourceDate || output.usedDate || output.generatedDate || output.updatedAt || new Date().toISOString()).replace(/\D/g, "").slice(0, 8);
  const timeSource = output.runTimestamp || output.updatedAt || new Date().toISOString();
  const time = `${stamp}${String(timeSource).replace(/\D/g, "").slice(8, 14).padEnd(6, "0")}`;
  return String(output.runId || process.env.STRATEGY5_RUN_ID || `strategy5-${stamp}-${time}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function strategy5ScanDate(output) {
  const raw = String(output.runMarketDate || output.sourceDate || output.usedDate || output.generatedDate || output.updatedAt || new Date().toISOString()).replace(/\D/g, "").slice(0, 8);
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return new Date().toISOString().slice(0, 10);
}

function strategy5Signals(item) {
  return Array.isArray(item?.matches) ? item.matches.filter((match) => match && typeof match === "object") : [];
}

function buildStrategy5RunRow(output, runId, status = "complete") {
  const complete = status === "complete";
  const scanTime = String(output.updatedAt || new Date().toISOString());
  const chipSourceStatusAtRun = buildChipSourceStatusAtRun(output.sourceHealth || {}, output.dataFreshness || {});
  const publishAllowed = complete && chipSourceStatusAtRun.ok;
  const resultCount = complete ? (Array.isArray(output.matches) ? output.matches.length : cleanNumber(output.count)) : 0;
  const fieldCompleteness = output.fieldCompleteness || buildStrategy5FieldCompleteness(output.matches || []);
  const writeBudget = output.writeBudget || buildWriteBudget(output, resultCount, complete ? "complete" : status);
  const blockedReason = publishAllowed
    ? ""
    : (chipSourceStatusAtRun.reason || chipSourceStatusAtRun.status || "strategy5_publish_blocked");
  const notRequired = (reason) => ({ ok: true, status: "not_required", reason });
  const runtimeSourceFields = buildRunTimeSourceSnapshotFields({
    strategy: "strategy5",
    runId,
    payload: output,
    startedAt: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    finishedAt: scanTime,
    expectedTotal: cleanNumber(output.total),
    scannedCount: Array.isArray(output.scannedCodes) ? output.scannedCodes.length : cleanNumber(output.scannedThisRun),
    resultCount,
    sourceStatus: chipSourceStatusAtRun,
    quoteCoverage: notRequired("strategy5 chip source does not require intraday quote freshness"),
    intraday1mReadiness: notRequired("strategy5 chip source does not require intraday 1m"),
    maReadiness: notRequired("strategy5 chip source does not require MA readiness"),
    preopenFutoptDailyReadiness: notRequired("strategy5 chip source does not require preopen/futopt/daily volume readiness"),
    publishAllowed,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    writeBudget,
    retentionOk: publishAllowed,
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: false,
    fallbackDetails: [],
    fallbackContract: "strategy5-fallback-disallowed-for-publish",
    blockedReason,
    scannerBlockReason: blockedReason,
    qualityStatus: complete ? "complete" : status,
  });
  return {
    run_id: runId,
    strategy: "strategy5",
    scan_date: strategy5ScanDate(output),
    started_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    finished_at: complete ? scanTime : null,
    status,
    expected_total: cleanNumber(output.total),
    scanned_count: Array.isArray(output.scannedCodes) ? output.scannedCodes.length : cleanNumber(output.scannedThisRun),
    result_count: resultCount,
    complete,
    quality_status: complete ? "complete" : status,
    source: String(output.source || "").trim(),
    schema_version: output.schemaVersion || "strategy5-run-id-complete-v1",
    data_contract_source: output.dataContractSource || "strategy5-cache",
    generated_at: String(output.updatedAt || new Date().toISOString()),
    updated_at: scanTime,
    payload: {
      ...runtimeSourceFields,
      source_snapshot_captured_at: runtimeSourceFields.source_snapshot_captured_at,
      source_status_at_run: runtimeSourceFields.source_status_at_run,
      quote_coverage_at_run: runtimeSourceFields.quote_coverage_at_run,
      intraday_1m_readiness_at_run: runtimeSourceFields.intraday_1m_readiness_at_run,
      ma_readiness_at_run: runtimeSourceFields.ma_readiness_at_run,
      preopen_futopt_daily_readiness_at_run: runtimeSourceFields.preopen_futopt_daily_readiness_at_run,
      run_quality_at_publish: {
        ...(runtimeSourceFields.run_quality_at_publish || {}),
        fieldCompletenessContract: "strategy5-field-completeness-20260703",
        requiredFields: fieldCompleteness.requiredFields,
        rowsChecked: Array.isArray(output.matches) ? output.matches.length : 0,
        blankCounts: fieldCompleteness.blankCounts,
        blankTotal: fieldCompleteness.blankTotal,
        blankRate: fieldCompleteness.blankRate,
        sampleMissingRows: fieldCompleteness.sampleMissingRows,
        writeBudget,
        retentionOk: publishAllowed,
        fallbackUsed: false,
        fallbackScope: [],
        fallbackAllowed: false,
        fallbackDetails: [],
        fallbackContract: "strategy5-fallback-disallowed-for-publish",
        blockedReason,
        scanner_block_reason: blockedReason,
        evidenceStatus: publishAllowed ? "complete" : "insufficient",
        unattendedStatus: publishAllowed ? "YES" : "NO",
      },
      chip_source_status_at_run: chipSourceStatusAtRun,
      fallbackUsed: false,
      fallbackScope: [],
      fallbackAllowed: false,
      fallbackDetails: [],
      fallbackContract: "strategy5-fallback-disallowed-for-publish",
      degradedBlocksLatest: true,
      preservePreviousGood: true,
      writeBudget,
      retentionOk: publishAllowed,
      requiredFields: fieldCompleteness.requiredFields,
      blankCounts: fieldCompleteness.blankCounts,
      blankTotal: fieldCompleteness.blankTotal,
      sampleMissingRows: fieldCompleteness.sampleMissingRows,
      blockedReason,
      scanner_block_reason: blockedReason,
      evidenceStatus: publishAllowed ? "complete" : "insufficient",
      unattendedStatus: publishAllowed ? "YES" : "NO",
      count: cleanNumber(output.count),
      total: cleanNumber(output.total),
      usedDate: output.usedDate || "",
      sourceDate: output.sourceDate || "",
      generatedDate: output.generatedDate || "",
      schedule: output.schedule || "",
      sourceHealth: output.sourceHealth || {},
    },
  };
}

function buildStrategy5ResultRows(output, runId) {
  const matches = Array.isArray(output.matches) ? output.matches : [];
  const scanDate = strategy5ScanDate(output);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return matches.map((stock, index) => ({
    run_id: runId,
    strategy: "strategy5",
    scan_date: scanDate,
    code: normalizeCode(stock.code),
    name: String(stock.name || "").trim(),
    price: cleanNumber(stock.close || stock.price),
    close: cleanNumber(stock.close || stock.price),
    change_percent: cleanNullableNumber(stock.percent ?? stock.changePercent),
    volume: cleanNumber(stock.volumeShares || (cleanNumber(stock.volumeLots) * 1000) || stock.volume || stock.tradeVolume),
    trade_volume: cleanNumber(stock.volumeLots || stock.tradeVolume || stock.volume),
    trade_value: cleanNumber(stock.value || stock.tradeValue),
    score: cleanNumber(stock.score),
    rank: index + 1,
    reason: String(stock.reason || stock.activeMatch?.reason || "").trim(),
    signals: strategy5Signals(stock),
    payload: stock,
    complete: true,
    quality_status: "complete",
    schema_version: output.schemaVersion || "strategy5-run-id-complete-v1",
    data_contract_source: output.dataContractSource || "strategy5-cache",
    generated_at: scanTime,
    updated_at: scanTime,
  })).filter((row) => /^\d{4}$/.test(row.code));
}

async function upsertStrategy5Rows(table, rows, conflict) {
  if (!rows.length) return true;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${table} upsert HTTP ${response.status} ${body.slice(0, 180)}`.trim());
  }
  return true;
}

async function fetchStrategy5ResultReadbackCount(runId) {
  const query = [
    "select=code",
    "strategy=eq.strategy5",
    `run_id=eq.${encodeURIComponent(runId)}`,
    "complete=eq.true",
    "limit=1",
  ].join("&");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${STRATEGY5_RESULTS_TABLE}?${query}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      Prefer: "count=exact",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${STRATEGY5_RESULTS_TABLE} readback HTTP ${response.status} ${body.slice(0, 180)}`.trim());
  }
  const contentRange = response.headers.get("content-range") || "";
  const count = Number(contentRange.split("/").pop());
  if (!Number.isFinite(count)) throw new Error("strategy5 result readback count unavailable");
  return count;
}

async function publishStrategy5CompleteRunToSupabase(output) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("strategy5 supabase complete run skipped: missing service role key");
    return false;
  }
  if (output?.fullScan !== true || !Array.isArray(output.matches) || !output.matches.length) {
    console.warn("strategy5 supabase complete run skipped: incomplete or empty output");
    return false;
  }
  const runId = strategy5RunIdFromOutput(output);
  output.fieldCompleteness = buildStrategy5FieldCompleteness(output.matches || []);
  output.writeBudget = buildWriteBudget(output, Array.isArray(output.matches) ? output.matches.length : cleanNumber(output.count), "complete");
  output.retentionOk = false;
  output.fallbackUsed = false;
  output.fallbackScope = [];
  output.fallbackAllowed = false;
  output.fallbackDetails = [];
  output.fallbackContract = "strategy5-fallback-disallowed-for-publish";
  output.degradedBlocksLatest = true;
  output.preservePreviousGood = true;
  output.requiredFields = output.fieldCompleteness.requiredFields;
  output.blankCounts = output.fieldCompleteness.blankCounts;
  output.sampleMissingRows = output.fieldCompleteness.sampleMissingRows;
  output.blockedReason = "";
  output.scanner_block_reason = "";
  const runningRow = buildStrategy5RunRow(output, runId, "running");
  const resultRows = buildStrategy5ResultRows(output, runId);
  const completeRow = buildStrategy5RunRow({ ...output, runId }, runId, "complete");
  completeRow.result_count = resultRows.length;
  completeRow.payload = {
    ...(completeRow.payload || {}),
    count: resultRows.length,
    resultCount: resultRows.length,
  };
  if (completeRow.expected_total <= 0 || completeRow.scanned_count <= 0 || completeRow.expected_total !== completeRow.scanned_count) {
    throw new Error(`strategy5 complete run blocked: expected_total=${completeRow.expected_total} scanned_count=${completeRow.scanned_count}`);
  }
  if (!resultRows.length || resultRows.length !== output.matches.length) {
    throw new Error(`strategy5 complete run blocked: result row count ${resultRows.length} does not match matches ${output.matches.length}`);
  }
  await upsertStrategy5Rows(STRATEGY5_RUNS_TABLE, [runningRow], "run_id");
  await upsertStrategy5Rows(STRATEGY5_RESULTS_TABLE, resultRows, "run_id,strategy,code");
  const readbackCount = await fetchStrategy5ResultReadbackCount(runId);
  if (readbackCount !== resultRows.length) {
    throw new Error(`strategy5 complete run blocked: readback ${readbackCount} does not match results ${resultRows.length}`);
  }
  await upsertStrategy5Rows(STRATEGY5_RUNS_TABLE, [completeRow], "run_id");
  output.runId = runId;
  output.complete = true;
  output.qualityStatus = "complete";
  output.schemaVersion = completeRow.schema_version;
  output.dataContractSource = completeRow.data_contract_source;
  output.resultReadbackCount = readbackCount;
  output.retentionOk = true;
  console.log(`strategy5 supabase complete run readback ok: ${runId}, matches ${resultRows.length}`);
  return true;
}

async function fetchJson(url, timeout = 30000) {
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

async function fetchSupabaseRows(table, query, timeout = 20000) {
  if (!SUPABASE_URL || !SUPABASE_READ_KEY) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_READ_KEY,
        Authorization: `Bearer ${SUPABASE_READ_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSupabaseRowsPaged(table, query, limit = 5000, pageSize = 1000) {
  const rows = [];
  const maxRows = Math.max(1, Number(limit || 5000));
  const size = Math.max(1, Math.min(1000, Number(pageSize || 1000)));
  for (let offset = 0; offset < maxRows; offset += size) {
    const separator = query ? "&" : "";
    const page = await fetchSupabaseRows(
      table,
      `${query}${separator}limit=${size}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows.slice(0, maxRows);
}

async function fetchInstitutionSourceHealth() {
  const rows = await fetchSupabaseRows(
    "v_institution_source_health",
    [
      "select=coverage_status,latest_trade_date,institutional_latest_trade_date,margin_latest_trade_date,unified_latest_trade_date,institutional_rows,margin_rows,unified_rows,valid_after_exclusion_rows,min_required_rows,stale_days,reason,unified_latest_updated_at,margin_latest_updated_at,institutional_latest_updated_at,suggested_scanner_behavior",
      "limit=1",
    ].join("&")
  );
  const row = rows[0] || {};
  return {
    coverageStatus: row.coverage_status || "",
    latestTradeDate: row.latest_trade_date || "",
    institutionalLatestTradeDate: row.institutional_latest_trade_date || "",
    marginLatestTradeDate: row.margin_latest_trade_date || "",
    unifiedLatestTradeDate: row.unified_latest_trade_date || "",
    institutionalRows: cleanNumber(row.institutional_rows),
    marginRows: cleanNumber(row.margin_rows),
    unifiedRows: cleanNumber(row.unified_rows),
    validAfterExclusionRows: cleanNumber(row.valid_after_exclusion_rows),
    minRequiredRows: cleanNumber(row.min_required_rows),
    staleDays: cleanNumber(row.stale_days),
    healthReason: row.reason || "",
    healthUpdatedAt: row.unified_latest_updated_at || row.margin_latest_updated_at || row.institutional_latest_updated_at || "",
    suggestedScannerBehavior: row.suggested_scanner_behavior || "",
  };
}

async function fetchText(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "text/csv,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((item) => item.replace(/\s/g, ""));
  return rows.slice(1).map((items) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = items[index] || ""; });
    return record;
  });
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  if (/ETF|ETN|指數|台灣50|高股息|正2|反1|期貨|債/i.test(name)) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    open: cleanNumber(row.OpeningPrice || row.open),
    high: cleanNumber(row.HighestPrice || row.high),
    low: cleanNumber(row.LowestPrice || row.low),
    prevClose: cleanNumber(row.PreviousClose || row.prevClose),
    limitUp: cleanNumber(row.LimitUp || row.limitUp),
    change: cleanNumber(row.Change || row.change),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
    quoteDate: row.quoteDate || row.TradeDate || row.tradeDate || "",
    market: row.market || row.Market || "",
  };
}

function payloadTradeDate(payload = {}) {
  const direct = compactDateKey(
    payload.sourceTradeDate ||
    payload.resolvedTradeDate ||
    payload.tradeDate ||
    payload.usedDate ||
    payload.generatedDate ||
    payload.today
  );
  if (direct) return direct;
  const sample = Array.isArray(payload.stocks) ? payload.stocks.find(Boolean) : null;
  return compactDateKey(sample?.quoteDate || sample?.TradeDate || sample?.tradeDate || sample?.Date || sample?.date);
}

function describeStocksPayload(payload = {}, source = "") {
  const tradeDate = payloadTradeDate(payload);
  const ageDays = tradeDate ? dateAgeDays(tradeDate) : null;
  return {
    source,
    count: cleanNumber(payload.count) || (Array.isArray(payload.stocks) ? payload.stocks.length : 0),
    sourceTradeDate: compactDateKey(payload.sourceTradeDate),
    resolvedTradeDate: compactDateKey(payload.resolvedTradeDate),
    tradeDate,
    ageDays,
  };
}

function payloadHasUsableStocks(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  return cleanNumber(payload.count) >= 1000 && Array.isArray(payload.stocks) && payload.stocks.length >= 1000;
}

async function fetchUniverse() {
  const localPayload = readJson(dataPath("stocks-slim.json"), null);
  const localHealth = describeStocksPayload(localPayload || {}, "local:stocks-slim.json");
  let remotePayload = null;
  let remoteError = "";
  try {
    remotePayload = await fetchJson(STOCK_URL);
  } catch (error) {
    remoteError = error.message;
  }
  const remoteHealth = describeStocksPayload(remotePayload || {}, STOCK_URL);
  const remoteUsable = payloadHasUsableStocks(remotePayload);
  const localFreshEnough =
    payloadHasUsableStocks(localPayload) &&
    localHealth.tradeDate &&
    localHealth.ageDays != null &&
    localHealth.ageDays >= 0 &&
    localHealth.ageDays <= STRATEGY5_MAX_LOCAL_STOCKS_CACHE_AGE_DAYS;

  let payload = null;
  let localStocksCacheReason = "";
  if (remoteUsable) {
    payload = remotePayload;
    localStocksCacheReason = localHealth.tradeDate && localHealth.tradeDate !== remoteHealth.tradeDate
      ? "stale_cache_ignored"
      : "remote_primary";
  } else if (localFreshEnough) {
    payload = localPayload;
    localStocksCacheReason = "remote_failed_local_cache_fresh";
  } else {
    localStocksCacheReason = localHealth.tradeDate ? "stale_cache_ignored" : "local_cache_missing";
    throw new Error(`strategy5 stock universe unavailable: remote=${remoteError || "unusable"} local=${localStocksCacheReason} localTradeDate=${localHealth.tradeDate || "--"}`);
  }

  universeSourceHealth = {
    stockUniverseSource: remoteUsable ? STOCK_URL : "local:stocks-slim.json",
    stockUniverseRemoteOk: remoteUsable,
    stockUniverseRemoteError: remoteError,
    stockUniverseRemoteTradeDate: remoteHealth.tradeDate,
    stockUniverseRemoteCount: remoteHealth.count,
    localStocksCacheDate: localHealth.tradeDate,
    localStocksCacheAgeDays: localHealth.ageDays,
    localStocksCacheCount: localHealth.count,
    localStocksCacheUsed: !remoteUsable && localFreshEnough,
    localStocksCacheReason,
    localStocksCacheMaxAgeDays: STRATEGY5_MAX_LOCAL_STOCKS_CACHE_AGE_DAYS,
  };
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  const base = rows.map(normalizeStock).filter(Boolean);
  const fugle = overlayFugleWebSocketQuotes(base, { source: "strategy5-universe" });
  const baseWithFugle = fugle.rows;
  if (fugle.used) console.log(`strategy5 fugle websocket overlay used ${fugle.used}/${base.length}`);
  if (!USE_MIS_QUOTES) return baseWithFugle;
  const quotes = await fetchMisQuotes(base.map((stock) => stock.code));
  return baseWithFugle.map((stock) => {
    const quote = quotes.get(stock.code);
    if (stock.quoteSource === "fugle-ws") return stock;
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
}

async function fetchIssuedShares() {
  const map = new Map();
  const warnings = [];
  await Promise.all(CAPITAL_URLS.map(async (url) => {
    try {
      const rows = parseCsv(await fetchText(url));
      rows.forEach((row) => {
        const code = normalizeCode(row["公司代號"]);
        const shares = cleanNumber(row["已發行普通股數或TDR原股發行股數"]);
        if (/^\d{4}$/.test(code) && shares > 0) map.set(code, shares);
      });
    } catch (error) {
      warnings.push(`issued shares fetch failed: ${url} :: ${error.message}`);
    }
  }));
  return { map, warnings };
}

function formatTwseDate(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function taipeiDateKey(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}`;
}

function dateAgeDays(dateKey) {
  const compact = String(dateKey || "").replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(compact)) return null;
  const today = taipeiDateKey();
  const toUtc = (value) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.floor((toUtc(today) - toUtc(compact)) / 86400000);
}

function compactDateKey(value) {
  const compact = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(compact) ? compact : "";
}

function latestDateKey(values = []) {
  return values
    .map(compactDateKey)
    .filter(Boolean)
    .sort()
    .pop() || "";
}

function chipSourcePriority(source = "") {
  const text = String(source || "").toLowerCase();
  if (text.startsWith("twse:") || text.startsWith("tpex:")) return 3;
  if (text.startsWith("finmind:")) return 2;
  return 1;
}

function chipSourceTier(source = "") {
  const priority = chipSourcePriority(source);
  if (priority >= 3) return "official";
  if (priority === 2) return "finmind_fallback";
  return source ? "other" : "missing";
}

function shouldReplaceChipSource(currentDate = "", currentSource = "", nextDate = "", nextSource = "") {
  const currentKey = compactDateKey(currentDate);
  const nextKey = compactDateKey(nextDate);
  if (!nextKey) return false;
  if (!currentKey) return true;
  if (nextKey !== currentKey) return nextKey > currentKey;
  return chipSourcePriority(nextSource) > chipSourcePriority(currentSource);
}

function aggregateBranchFlowRows(rows = []) {
  const latestDateBySymbol = new Map();
  const normalized = rows.map((row) => {
    const symbol = normalizeCode(row.symbol);
    const tradeDate = compactDateKey(row.trade_date);
    if (!/^\d{4}$/.test(symbol) || !tradeDate) return null;
    const buy = cleanNumber(row.buy);
    const sell = cleanNumber(row.sell);
    const net = firstNullableNumber(row.net) ?? (buy - sell);
    latestDateBySymbol.set(symbol, latestDateKey([latestDateBySymbol.get(symbol), tradeDate]));
    return {
      symbol,
      tradeDate,
      buy,
      sell,
      net,
      actor: row.actor || "",
      source: row.source || "finmind:TaiwanStockTradingDailyReport",
    };
  }).filter(Boolean);
  const output = [];
  for (const [symbol, latestDate] of latestDateBySymbol.entries()) {
    const sameDate = normalized.filter((row) => row.symbol === symbol && row.tradeDate === latestDate);
    const totalBuy = sameDate.reduce((sum, row) => sum + row.buy, 0);
    const totalSell = sameDate.reduce((sum, row) => sum + row.sell, 0);
    const totalNet = sameDate.reduce((sum, row) => sum + row.net, 0);
    const topBuy = sameDate.filter((row) => row.net > 0).sort((a, b) => b.net - a.net || b.buy - a.buy).slice(0, 15);
    const topSell = sameDate.filter((row) => row.net < 0).sort((a, b) => a.net - b.net || b.sell - a.sell).slice(0, 15);
    const topBranchNetBuy = topBuy.reduce((sum, row) => sum + row.net, 0);
    const topBranchNetSell = Math.abs(topSell.reduce((sum, row) => sum + row.net, 0));
    const concentration = totalBuy > 0 ? topBranchNetBuy / totalBuy : 0;
    const mainForceBranchNetBuy = topBranchNetBuy - topBranchNetSell;
    output.push({
      symbol,
      trade_date: latestDate.slice(0, 4) + "-" + latestDate.slice(4, 6) + "-" + latestDate.slice(6, 8),
      branch_buy: totalBuy,
      branch_sell: totalSell,
      branch_net_buy: totalNet,
      main_force_branch_net_buy: mainForceBranchNetBuy,
      branch_buy_count: sameDate.filter((row) => row.buy > 0).length,
      branch_sell_count: sameDate.filter((row) => row.sell > 0).length,
      top_branch_net_buy: topBranchNetBuy,
      top_branch_net_sell: topBranchNetSell,
      top_branch_count: topBuy.length,
      branch_concentration_ratio: concentration,
      branch_power_score: clamp(Math.round(concentration * 70 + Math.min(topBuy.length, 15) * 2), 0, 100),
      branch_status: mainForceBranchNetBuy > 0 ? "branch_net_buy" : (mainForceBranchNetBuy < 0 ? "branch_net_sell" : "branch_neutral"),
      source: "finmind:TaiwanStockTradingDailyReport",
    });
  }
  return output;
}

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function shouldIncludeTodayVolume() {
  const parts = taipeiParts();
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 14 * 60 + 30;
}

function recentTradingDates(limit = 8, anchorDateKey = "") {
  const dates = [];
  const anchor = compactDateKey(anchorDateKey);
  const date = anchor
    ? new Date(`${anchor.slice(0, 4)}-${anchor.slice(4, 6)}-${anchor.slice(6, 8)}T12:00:00+08:00`)
    : new Date();
  if (!anchor && !shouldIncludeTodayVolume()) date.setDate(date.getDate() - 1);
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function collectVolume(bucket, code, volume) {
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || volume <= 0) return;
  const list = bucket.get(code) || [];
  list.push(volume);
  bucket.set(code, list);
}

async function fetchHistoricalVolumes(anchorDateKey = "") {
  const bucket = new Map();
  const warnings = [];
  const anchor = compactDateKey(anchorDateKey);
  for (const date of recentTradingDates(8, anchor)) {
    try {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${formatTwseDate(date)}&type=ALLBUT0999&response=json`, 25000);
      const table = (payload.tables || []).find((item) => String(item.title || "").includes("每日收盤行情"));
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("證券代號"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && volumeIndex >= 0) data.forEach((row) => collectVolume(bucket, normalizeCode(row[codeIndex]), cleanNumber(row[volumeIndex])));
    } catch (error) {
      warnings.push(`twse volume fetch failed: ${formatTwseDate(date)} :: ${error.message}`);
    }
    try {
      const payload = await fetchJson(`https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(formatTpexDate(date))}&s=0,asc,0`, 25000);
      const responseDate = compactDateKey(payload.date || payload.reportDate || payload.Date);
      if (responseDate && responseDate !== formatTwseDate(date)) continue;
      const table = (payload.tables || []).find((item) => (item.data || []).length);
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("代號"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && volumeIndex >= 0) data.forEach((row) => collectVolume(bucket, normalizeCode(row[codeIndex]), cleanNumber(row[volumeIndex])));
    } catch (error) {
      warnings.push(`tpex volume fetch failed: ${formatTpexDate(date)} :: ${error.message}`);
    }
  }
  const averages = new Map();
  const previous = new Map();
  bucket.forEach((values, code) => {
    const usable = values.slice(0, 5);
    if (usable.length) averages.set(code, usable.reduce((sum, value) => sum + value, 0) / usable.length);
    const previousValue = (anchor || shouldIncludeTodayVolume()) ? (values[1] || 0) : values[0];
    if (previousValue > 0) previous.set(code, previousValue);
  });
  return { map: averages, previousMap: previous, warnings, anchorDate: anchor };
}

function rankMap(stocks, key) {
  const sorted = [...stocks].sort((a, b) => cleanNumber(b[key]) - cleanNumber(a[key]));
  const total = Math.max(sorted.length - 1, 1);
  const ranks = new Map();
  sorted.forEach((stock, index) => {
    ranks.set(stock.code, Math.round(((total - index) / total) * 100));
  });
  return ranks;
}

function ordinalRankMap(stocks, scoreFn) {
  const sorted = [...stocks].sort((a, b) => cleanNumber(scoreFn(b)) - cleanNumber(scoreFn(a)));
  const ranks = new Map();
  sorted.forEach((stock, index) => {
    if (/^\d{4}$/.test(String(stock.code || ""))) ranks.set(stock.code, index + 1);
  });
  return ranks;
}

function formatInstitution(value) {
  const amount = cleanNumber(value);
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${Math.round(amount).toLocaleString("zh-TW")}`;
}

async function readStrategy4Candidates() {
  const latestRuns = await fetchSupabaseRows(
    STRATEGY4_RUNS_TABLE,
    "select=run_id,status,complete,result_count,updated_at&status=eq.complete&complete=eq.true&order=updated_at.desc&limit=1"
  ).catch(() => []);
  const runId = latestRuns[0]?.run_id || "";
  if (!runId) return [];
  return fetchSupabaseRows(
    STRATEGY4_RESULTS_TABLE,
    `select=code,name,score,rank,reason,signals,payload&run_id=eq.${encodeURIComponent(runId)}&order=rank.asc&limit=500`
  ).then((rows) => rows.map((row) => ({
    ...row,
    ...(row.payload && typeof row.payload === "object" ? row.payload : {}),
    strategy4RunId: runId,
    strategy4Matched: true,
  }))).catch(() => []);
}

function pickRows(payload, keys = []) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

function pickAllRows(payload, keys = []) {
  const rows = [];
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      rows.push(...payload[key].map((row) => ({ ...row, sourceBucket: row.sourceBucket || key })));
    }
  }
  return rows.length ? rows : (Array.isArray(payload) ? payload : []);
}

function readChipKConfluenceSources(institutionData = {}) {
  const cbPayload = readJson(CB_DETECT_FILE, {});
  const warrantPayload = readJson(WARRANT_FLOW_FILE, {});
  const warrantSinglePayload = readJson(WARRANT_SINGLE_SIGNAL_FILE, {});
  const cbRows = pickRows(cbPayload, ["matches", "rows", "data", "items"]);
  const warrantRows = pickRows(warrantSinglePayload, ["matches", "rows", "data", "items"])
    .map((row) => ({ ...row, sourceBucket: row.sourceBucket || "warrant-single-signal-top" }));
  const fallbackWarrantRows = pickAllRows(warrantPayload, ["singleSignals"]);
  const cbByCode = new Map();
  const warrantByCode = new Map();
  const instByCode = new Map();

  Object.entries(institutionData || {}).forEach(([rawCode, inst]) => {
    const code = normalizeCode(rawCode);
    if (!/^\d{4}$/.test(code)) return;
    const foreign = cleanNumber(inst?.foreign);
    const trust = cleanNumber(inst?.trust);
    const dealer = cleanNumber(inst?.dealer);
    const total = cleanNumber(inst?.total || foreign + trust + dealer);
    instByCode.set(code, { foreign, trust, dealer, total });
  });

  cbRows.forEach((row) => {
    const code = normalizeCode(row?.underlyingCode || row?.stockCode || row?.code || row?.targetCode || row?.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const score = cleanNumber(row?.score || row?.cbScore || row?.strength || row?.rankScore);
    const previous = cbByCode.get(code);
    if (!previous || score >= cleanNumber(previous.score)) cbByCode.set(code, { ...row, score });
  });

  (warrantRows.length ? warrantRows : fallbackWarrantRows).forEach((row) => {
    const code = normalizeCode(row?.underlyingCode || row?.stockCode || row?.code || row?.targetCode || row?.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const score = cleanNumber(row?.score || row?.flowScore || row?.strength || row?.rankScore);
    const previous = warrantByCode.get(code);
    if (!previous || score >= cleanNumber(previous.score)) warrantByCode.set(code, { ...row, score });
  });

  return { cbByCode, warrantByCode, instByCode };
}

async function fetchFinMindChipLatestMap(limit = 5000) {
  if (process.env.STRATEGY5_USE_FINMIND_CHIP === "0") return new Map();
  const rows = await fetchSupabaseRowsPaged(
    "v_chip_flows_latest",
    "select=symbol,trade_date,foreign_net,investment_trust_net,dealer_net,institution_total_net,margin_buy,margin_sell,margin_cash_repayment,margin_balance,short_sell,short_buy,short_cash_repayment,short_balance,source&order=trade_date.desc",
    Number(limit || 5000)
  ).catch(() => []);
  const map = new Map();
  rows.forEach((row) => {
    const code = normalizeCode(row.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const tradeDate = row.trade_date || "";
    const ageDays = dateAgeDays(tradeDate);
    if (ageDays == null || ageDays > STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS) return;
    const entry = map.get(code) || {};
    const source = row.source || "finmind-chip";
    const foreign = firstNullableNumber(row.foreign_net);
    const trust = firstNullableNumber(row.investment_trust_net);
    const dealer = firstNullableNumber(row.dealer_net);
    const total = firstNullableNumber(row.institution_total_net);
    const hasInstitution = [foreign, trust, dealer, total].some((value) => value !== null);
    const marginBuy = firstNullableNumber(row.margin_buy);
    const marginSell = firstNullableNumber(row.margin_sell);
    const marginCashRepayment = firstNullableNumber(row.margin_cash_repayment);
    const marginBalance = firstNullableNumber(row.margin_balance);
    const shortSell = firstNullableNumber(row.short_sell);
    const shortBuy = firstNullableNumber(row.short_buy);
    const shortCashRepayment = firstNullableNumber(row.short_cash_repayment);
    const shortBalance = firstNullableNumber(row.short_balance);
    const hasMarginShort = [
      marginBuy,
      marginSell,
      marginCashRepayment,
      marginBalance,
      shortSell,
      shortBuy,
      shortCashRepayment,
      shortBalance,
    ].some((value) => value !== null);
    if (hasInstitution && shouldReplaceChipSource(entry.institutionTradeDate, entry.institutionSource, tradeDate, source)) {
      entry.foreign = foreign ?? 0;
      entry.trust = trust ?? 0;
      entry.dealer = dealer ?? 0;
      entry.total = total ?? ((foreign ?? 0) + (trust ?? 0) + (dealer ?? 0));
      entry.institutionTradeDate = tradeDate;
      entry.institutionSource = source;
    }
    if (hasMarginShort && shouldReplaceChipSource(entry.marginTradeDate, entry.marginShortSource, tradeDate, source)) {
      entry.marginBuy = marginBuy ?? 0;
      entry.marginSell = marginSell ?? 0;
      entry.marginCashRepayment = marginCashRepayment ?? 0;
      entry.marginBalance = marginBalance ?? 0;
      entry.shortSell = shortSell ?? 0;
      entry.shortBuy = shortBuy ?? 0;
      entry.shortCashRepayment = shortCashRepayment ?? 0;
      entry.shortBalance = shortBalance ?? 0;
      entry.marginTradeDate = tradeDate;
      entry.marginShortSource = source;
    }
    if (!hasInstitution && !hasMarginShort) return;
    entry.tradeDate = latestDateKey([entry.tradeDate, entry.institutionTradeDate, entry.marginTradeDate, tradeDate]);
    entry.source = [entry.institutionSource, entry.marginShortSource].filter(Boolean).join("+") || source;
    map.set(code, entry);
  });
  const marginRows = await fetchSupabaseRowsPaged(
    "finmind_margin_short",
    "select=symbol,trade_date,margin_buy,margin_sell,margin_cash_repayment,margin_balance,short_sell,short_buy,short_cash_repayment,short_balance,source&order=trade_date.desc",
    Number(limit || 5000)
  ).catch(() => []);
  marginRows.forEach((row) => {
    const code = normalizeCode(row.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const tradeDate = row.trade_date || "";
    const ageDays = dateAgeDays(tradeDate);
    if (ageDays == null || ageDays > STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS) return;
    const entry = map.get(code) || {};
    const source = row.source || "finmind-margin-short";
    if (!shouldReplaceChipSource(entry.marginTradeDate, entry.marginShortSource, tradeDate, source)) return;
    entry.marginBuy = firstNullableNumber(row.margin_buy) ?? 0;
    entry.marginSell = firstNullableNumber(row.margin_sell) ?? 0;
    entry.marginCashRepayment = firstNullableNumber(row.margin_cash_repayment) ?? 0;
    entry.marginBalance = firstNullableNumber(row.margin_balance) ?? 0;
    entry.shortSell = firstNullableNumber(row.short_sell) ?? 0;
    entry.shortBuy = firstNullableNumber(row.short_buy) ?? 0;
    entry.shortCashRepayment = firstNullableNumber(row.short_cash_repayment) ?? 0;
    entry.shortBalance = firstNullableNumber(row.short_balance) ?? 0;
    entry.marginTradeDate = tradeDate;
    entry.marginShortSource = source;
    entry.tradeDate = latestDateKey([entry.tradeDate, entry.institutionTradeDate, entry.marginTradeDate, tradeDate]);
    entry.source = [entry.institutionSource, entry.marginShortSource].filter(Boolean).join("+") || source;
    map.set(code, entry);
  });
  let branchRows = await fetchSupabaseRowsPaged(
    "v_finmind_branch_flows_latest",
    [
      "select=symbol,trade_date,branch_buy,branch_sell,branch_net_buy,branch_buy_count,branch_sell_count,main_force_branch_net_buy,top_branch_net_buy,top_branch_net_sell,top_branch_count,branch_concentration_ratio,branch_power_score,branch_status,source",
      "order=trade_date.desc",
    ].join("&"),
    Number(limit || 5000)
  ).catch(() => []);
  if (!branchRows.length) {
    const rawLimit = Math.max(1000, Number(process.env.STRATEGY5_BRANCH_RAW_LIMIT || 20000));
    const rawBranchRows = await fetchSupabaseRowsPaged(
      "finmind_chip_raw",
      "select=symbol,trade_date,actor,buy,sell,net,source,payload&dataset=eq.TaiwanStockTradingDailyReport&order=trade_date.desc",
      rawLimit
    ).catch(() => []);
    branchRows = aggregateBranchFlowRows(rawBranchRows);
  }
  branchRows.forEach((row) => {
    const code = normalizeCode(row.symbol);
    if (!/^\d{4}$/.test(code)) return;
    const tradeDate = row.trade_date || "";
    const ageDays = dateAgeDays(tradeDate);
    if (ageDays == null || ageDays > STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS) return;
    const entry = map.get(code) || {};
    entry.branchTradeDate = tradeDate;
    entry.branchSource = row.source || "finmind:TaiwanStockTradingDailyReport";
    entry.branchBuy = firstNullableNumber(row.branch_buy) ?? 0;
    entry.branchSell = firstNullableNumber(row.branch_sell) ?? 0;
    entry.branchNetBuy = firstNullableNumber(row.branch_net_buy) ?? 0;
    entry.branchBuyCount = firstNullableNumber(row.branch_buy_count) ?? 0;
    entry.branchSellCount = firstNullableNumber(row.branch_sell_count) ?? 0;
    entry.mainForceBranchNetBuy = firstNullableNumber(row.main_force_branch_net_buy) ?? 0;
    entry.topBranchNetBuy = firstNullableNumber(row.top_branch_net_buy) ?? 0;
    entry.topBranchNetSell = firstNullableNumber(row.top_branch_net_sell) ?? 0;
    entry.topBranchCount = firstNullableNumber(row.top_branch_count) ?? 0;
    entry.branchConcentrationRatio = firstNullableNumber(row.branch_concentration_ratio) ?? 0;
    entry.branchPowerScore = firstNullableNumber(row.branch_power_score) ?? 0;
    entry.branchStatus = row.branch_status || (entry.branchNetBuy > 0 ? "branch_net_buy" : "branch_neutral");
    entry.tradeDate = latestDateKey([entry.tradeDate, tradeDate]);
    entry.source = [entry.source, entry.branchSource].filter(Boolean).join("+");
    map.set(code, entry);
  });
  return map;
}

function latestFinMindChipTradeDate(finmindMap = new Map()) {
  return latestDateKey(Array.from(finmindMap.values()).flatMap((row) => [
    row.tradeDate,
    row.institutionTradeDate,
    row.marginTradeDate,
    row.branchTradeDate,
  ]));
}

function mergeInstitutionDataWithFinMind(baseData = {}, finmindMap = new Map()) {
  if (!finmindMap.size) return baseData || {};
  const merged = { ...(baseData || {}) };
  finmindMap.forEach((finmind, code) => {
    const current = merged[code] || {};
    const foreign = firstNullableNumber(current.foreign);
    const trust = firstNullableNumber(current.trust);
    const dealer = firstNullableNumber(current.dealer);
    const currentMarginTradeDate = current.marginTradeDate || current.margin_trade_date || "";
    const currentMarginSource = current.marginShortSource || current.margin_short_source || "";
    const useFinmindMargin = shouldReplaceChipSource(
      currentMarginTradeDate,
      currentMarginSource,
      finmind.marginTradeDate,
      finmind.marginShortSource,
    );
    merged[code] = {
      ...current,
      foreign: foreign ?? finmind.foreign,
      trust: trust ?? finmind.trust,
      dealer: dealer ?? finmind.dealer,
      total: firstNullableNumber(current.total) ?? finmind.total,
      marginBuy: useFinmindMargin ? finmind.marginBuy : (firstNullableNumber(current.marginBuy, current.margin_buy) ?? finmind.marginBuy),
      marginSell: useFinmindMargin ? finmind.marginSell : (firstNullableNumber(current.marginSell, current.margin_sell) ?? finmind.marginSell),
      marginCashRepayment: useFinmindMargin ? finmind.marginCashRepayment : (firstNullableNumber(current.marginCashRepayment, current.margin_cash_repayment) ?? finmind.marginCashRepayment),
      marginBalance: useFinmindMargin ? finmind.marginBalance : (firstNullableNumber(current.marginBalance, current.margin_balance) ?? finmind.marginBalance),
      shortSell: useFinmindMargin ? finmind.shortSell : (firstNullableNumber(current.shortSell, current.short_sell) ?? finmind.shortSell),
      shortBuy: useFinmindMargin ? finmind.shortBuy : (firstNullableNumber(current.shortBuy, current.short_buy) ?? finmind.shortBuy),
      shortCashRepayment: useFinmindMargin ? finmind.shortCashRepayment : (firstNullableNumber(current.shortCashRepayment, current.short_cash_repayment) ?? finmind.shortCashRepayment),
      shortBalance: useFinmindMargin ? finmind.shortBalance : (firstNullableNumber(current.shortBalance, current.short_balance) ?? finmind.shortBalance),
      institutionTradeDate: current.institutionTradeDate || current.tradeDate || current.trade_date || finmind.institutionTradeDate || "",
      institutionSource: current.institutionSource || current.source || finmind.institutionSource || "",
      marginTradeDate: useFinmindMargin ? finmind.marginTradeDate : (current.marginTradeDate || current.margin_trade_date || finmind.marginTradeDate || ""),
      marginShortSource: useFinmindMargin ? finmind.marginShortSource : (current.marginShortSource || current.margin_short_source || finmind.marginShortSource || ""),
      branchTradeDate: current.branchTradeDate || current.branch_trade_date || finmind.branchTradeDate || "",
      branchSource: current.branchSource || current.branch_source || finmind.branchSource || "",
      branchBuy: firstNullableNumber(current.branchBuy, current.branch_buy) ?? finmind.branchBuy,
      branchSell: firstNullableNumber(current.branchSell, current.branch_sell) ?? finmind.branchSell,
      branchNetBuy: firstNullableNumber(current.branchNetBuy, current.branch_net_buy) ?? finmind.branchNetBuy,
      branchBuyCount: firstNullableNumber(current.branchBuyCount, current.branch_buy_count) ?? finmind.branchBuyCount,
      branchSellCount: firstNullableNumber(current.branchSellCount, current.branch_sell_count) ?? finmind.branchSellCount,
      mainForceBranchNetBuy: firstNullableNumber(current.mainForceBranchNetBuy, current.main_force_branch_net_buy) ?? finmind.mainForceBranchNetBuy,
      topBranchNetBuy: firstNullableNumber(current.topBranchNetBuy, current.top_branch_net_buy) ?? finmind.topBranchNetBuy,
      topBranchNetSell: firstNullableNumber(current.topBranchNetSell, current.top_branch_net_sell) ?? finmind.topBranchNetSell,
      topBranchCount: firstNullableNumber(current.topBranchCount, current.top_branch_count) ?? finmind.topBranchCount,
      branchConcentrationRatio: firstNullableNumber(current.branchConcentrationRatio, current.branch_concentration_ratio) ?? finmind.branchConcentrationRatio,
      branchPowerScore: firstNullableNumber(current.branchPowerScore, current.branch_power_score) ?? finmind.branchPowerScore,
      branchStatus: current.branchStatus || current.branch_status || finmind.branchStatus || "",
      tradeDate: latestDateKey([current.tradeDate, current.trade_date, finmind.tradeDate, finmind.branchTradeDate]),
      finmindChip: finmind,
      marginShortMergeSource: useFinmindMargin ? "finmind_margin_short_priority" : "base_institution_source",
    };
  });
  return merged;
}

function buildChipKConfluenceMatch({ stock, inst, confluenceSources, valueRank, volumeRank }) {
  const code = stock.code;
  const cb = confluenceSources.cbByCode.get(code);
  const warrant = confluenceSources.warrantByCode.get(code);
  const sourceInst = confluenceSources.instByCode.get(code) || inst;
  const hitSources = [
    cb ? "CB可轉債" : "",
    warrant ? "權證走向" : "",
    sourceInst ? "買賣超" : "",
  ].filter(Boolean);
  if (hitSources.length < 2) return null;

  const pct = cleanNumber(stock.percent);
  const total = cleanNumber(sourceInst?.total);
  const foreign = cleanNumber(sourceInst?.foreign);
  const trust = cleanNumber(sourceInst?.trust);

  const cbScore = cleanNumber(cb?.score);
  const warrantScore = cleanNumber(warrant?.score);
  const score = clamp(Math.round(
    72 +
    hitSources.length * 6 +
    Math.min(Math.max(pct, 0) * 2.2, 10) +
    Math.min(valueRank * 0.06, 6) +
    Math.min(volumeRank * 0.04, 4) +
    Math.min(cbScore * 0.05, 4) +
    Math.min(warrantScore * 0.05, 4)
  ), 80, 100);
  const reason = `命中 ${hitSources.join(" + ")}（三項中 ${hitSources.length} 項）；法人合計 ${formatInstitution(total)}，外資 ${formatInstitution(foreign)}、投信 ${formatInstitution(trust)}。`;
  return {
    id: "chip_k_confluence",
    short: "籌碼老K",
    icon: "老K",
    score,
    reason,
    cbScore,
    warrantScore,
    hitSources,
  };
}

function pctChange(from, to) {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

function averageRows(rows, field, count, endOffset = 0) {
  const end = endOffset ? rows.length - endOffset : rows.length;
  return avg(rows.slice(Math.max(0, end - count), end).map((row) => cleanNumber(row?.[field])));
}

function normalizeTradeVolumeUnits(stock = {}) {
  const explicitShares = cleanNumber(
    stock.volumeShares ??
    stock.volume_shares ??
    stock.tradeVolumeShares ??
    stock.trade_volume_shares
  );
  if (explicitShares > 0) {
    return { shares: explicitShares, lots: explicitShares / 1000, source: "explicit_shares" };
  }

  const explicitLots = cleanNumber(
    stock.volumeLots ??
    stock.volume_lots ??
    stock.tradeVolumeLots ??
    stock.trade_volume_lots ??
    stock.totalVolumeLots ??
    stock.total_volume_lots
  );
  if (explicitLots > 0) {
    return { shares: explicitLots * 1000, lots: explicitLots, source: "explicit_lots" };
  }

  const rawVolume = cleanNumber(
    stock.tradeVolume ??
    stock.trade_volume ??
    stock.totalVolume ??
    stock.total_volume ??
    stock.volume
  );
  if (rawVolume <= 0) return { shares: 0, lots: 0, source: "missing" };

  const price = cleanNumber(stock.close ?? stock.price ?? stock.lastPrice ?? stock.last_price);
  const tradeValue = cleanNumber(stock.value ?? stock.tradeValue ?? stock.trade_value);
  if (price > 0 && tradeValue > 0) {
    const sharesValueDiff = Math.abs((rawVolume * price) - tradeValue) / Math.max(tradeValue, 1);
    const lotsValueDiff = Math.abs((rawVolume * 1000 * price) - tradeValue) / Math.max(tradeValue, 1);
    if (sharesValueDiff <= lotsValueDiff) {
      return { shares: rawVolume, lots: rawVolume / 1000, source: "trade_value_inferred_shares" };
    }
    return { shares: rawVolume * 1000, lots: rawVolume, source: "trade_value_inferred_lots" };
  }

  if (rawVolume >= 1000000) {
    return { shares: rawVolume, lots: rawVolume / 1000, source: "size_inferred_shares" };
  }
  return { shares: rawVolume * 1000, lots: rawVolume, source: "default_lots" };
}

function maxRows(rows, field, count, endOffset = 0) {
  const end = endOffset ? rows.length - endOffset : rows.length;
  const values = rows.slice(Math.max(0, end - count), end).map((row) => cleanNumber(row?.[field])).filter(Boolean);
  return values.length ? Math.max(...values) : 0;
}

function analyzeBreakoutSetup(rows, stock) {
  if (!Array.isArray(rows) || rows.length < 21) return null;
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const close = cleanNumber(stock.close || last?.close);
  const open = cleanNumber(last?.open || stock.open || close);
  const high = cleanNumber(last?.high || stock.high || close);
  const low = cleanNumber(last?.low || stock.low || close);
  const volumeUnits = normalizeTradeVolumeUnits({ ...stock, close, price: close });
  const volume = volumeUnits.shares || cleanNumber(last?.volume);
  const ma5 = averageRows(rows, "close", 5);
  const ma10 = averageRows(rows, "close", 10);
  const avgVolume5 = averageRows(rows, "volume", 5, 1);
  const avgVolume20 = averageRows(rows, "volume", 20, 1);
  const high20 = maxRows(rows, "high", 20, 1);
  const close5Ago = cleanNumber(rows.at(-6)?.close);
  const close3Ago = cleanNumber(rows.at(-4)?.close);
  const fiveDayPct = pctChange(close5Ago, close);
  const threeDayPct = pctChange(close3Ago, close);
  const distanceToHigh20Pct = high20 ? ((high20 - close) / high20) * 100 : 99;
  const volumeRatio5 = avgVolume5 ? volume / avgVolume5 : 0;
  const volumeRatio20 = avgVolume20 ? volume / avgVolume20 : 0;
  const range = high - low;
  const upperShadowRatio = range > 0 ? (high - Math.max(open, close)) / range : 0;
  const closePosition = range > 0 ? (close - low) / range : 1;
  const pct = prev?.close ? pctChange(cleanNumber(prev.close), close) : cleanNumber(stock.percent);

  return {
    close,
    ma5,
    ma10,
    high20,
    distanceToHigh20Pct,
    fiveDayPct,
    threeDayPct,
    volume,
    volumeLots: volumeUnits.lots,
    volumeUnitSource: volumeUnits.source,
    volumeRatio5,
    volumeRatio20,
    upperShadowRatio,
    closePosition,
    pct,
  };
}

function buildStrategy5Match({ stock, inst, valueRank, volumeRank, rows, confluenceSources }) {
  const pct = cleanNumber(stock.percent);
  const foreign = cleanNumber(inst.foreign);
  const trust = cleanNumber(inst.trust);
  const total = cleanNumber(inst.total);
  const setup = analyzeBreakoutSetup(rows, stock);
  const todayPct = setup ? setup.pct : pct;
  const jointBuying = total > 0 && foreign > 0 && trust > 0;
  if (!jointBuying || !setup || todayPct <= -2.5 || todayPct > 10.2) return null;

  const volumeUnits = normalizeTradeVolumeUnits({ ...stock, close: setup.close, price: setup.close });
  const volumeLots = volumeUnits.lots;
  const historyVolume = cleanNumber(setup.volume);
  const volumeShares = volumeUnits.shares || historyVolume;
  const legalBuyRatio = volumeShares ? (total / volumeShares) * 100 : 0;
  const foreignBuyRatio = volumeShares ? (foreign / volumeShares) * 100 : 0;
  const trustBuyRatio = volumeShares ? (trust / volumeShares) * 100 : 0;
  const foreignStreak = cleanNumber(inst.foreignStreak || stock.foreignStreak);
  const trustStreak = cleanNumber(inst.trustStreak || stock.trustStreak);
  const hasCb = Boolean(confluenceSources?.cbByCode?.has(String(stock.code)));
  const hasWarrant = Boolean(confluenceSources?.warrantByCode?.has(String(stock.code)));

  const positionOk =
    (setup.close > setup.ma5 || setup.close > setup.ma10) &&
    setup.distanceToHigh20Pct <= 8 &&
    setup.fiveDayPct <= 25;
  const volumeOk =
    valueRank >= 40 &&
    setup.volumeRatio20 <= 10 &&
    (setup.volumeRatio5 >= 0.75 || setup.volumeRatio20 >= 0.75 || valueRank >= 55);
  const continuityOk =
    trustStreak >= 2 ||
    foreignStreak >= 2 ||
    trustBuyRatio >= 0.2 ||
    foreignBuyRatio >= 0.2;
  const fakeBreakoutOk =
    setup.upperShadowRatio <= 0.65 &&
    setup.closePosition >= 0.3 &&
    setup.threeDayPct <= 18;
  const concentrationOk =
    legalBuyRatio >= 0.2 ||
    trustBuyRatio >= 0.1 ||
    foreignBuyRatio >= 0.1 ||
    (hasCb && hasWarrant);
  if (!positionOk || !volumeOk || !continuityOk || !fakeBreakoutOk || !concentrationOk) return null;

  const score = clamp(Math.round(
    58 +
    Math.min(Math.max(todayPct, 0) * 4, 22) +
    Math.min(valueRank * 0.12, 12) +
    Math.min(volumeRank * 0.08, 8) +
    Math.min(setup.volumeRatio5 * 4, 12) +
    Math.min(Math.max(0, 3 - Math.max(setup.distanceToHigh20Pct, 0)) * 3, 9) +
    Math.min(trustStreak * 2, 10) +
    Math.min(foreignStreak * 1.5, 6) +
    Math.min(Math.max(legalBuyRatio, 0) * 2, 10) +
    (hasCb ? 3 : 0) +
    (hasWarrant ? 3 : 0) -
    Math.min(setup.upperShadowRatio * 12, 8)
  ), 70, 100);
  const reason = `外資 ${formatInstitution(foreign)}、投信 ${formatInstitution(trust)} 同買；收盤站上 5/10MA、距20日高 ${setup.distanceToHigh20Pct.toFixed(2)}%，5日漲幅 ${setup.fiveDayPct.toFixed(2)}%；量比5日 ${setup.volumeRatio5.toFixed(2)}、20日 ${setup.volumeRatio20.toFixed(2)}；法人佔量 ${legalBuyRatio.toFixed(2)}%、投信佔量 ${trustBuyRatio.toFixed(2)}%，外資連買 ${foreignStreak} 日、投信連買 ${trustStreak} 日。`;
  return {
    id: "foreign_trust_breakout",
    short: "準突破",
    icon: "◆",
    score,
    reason,
    ma5: Number(setup.ma5.toFixed(2)),
    ma10: Number(setup.ma10.toFixed(2)),
    distanceToHigh20Pct: Number(setup.distanceToHigh20Pct.toFixed(2)),
    fiveDayPct: Number(setup.fiveDayPct.toFixed(2)),
    threeDayPct: Number(setup.threeDayPct.toFixed(2)),
    volumeRatio5: Number(setup.volumeRatio5.toFixed(2)),
    volumeRatio20: Number(setup.volumeRatio20.toFixed(2)),
    legalBuyRatio: Number(legalBuyRatio.toFixed(2)),
    foreignBuyRatio: Number(foreignBuyRatio.toFixed(2)),
    trustBuyRatio: Number(trustBuyRatio.toFixed(2)),
    upperShadowPct: Number((setup.upperShadowRatio * 100).toFixed(2)),
    closePosition: Number(setup.closePosition.toFixed(2)),
    foreignStreak,
    trustStreak,
    hasCb,
    hasWarrant,
  };
}

function marginShortSameIncrease(inst = {}, expectedTradeDate = "") {
  const expectedDate = compactDateKey(expectedTradeDate);
  const marginTradeDate = compactDateKey(inst.marginTradeDate || inst.margin_trade_date || inst.tradeDate || inst.trade_date);
  const alignmentOk = Boolean(expectedDate && marginTradeDate && expectedDate === marginTradeDate);
  const marginNetIncrease =
    cleanNumber(firstNullableNumber(inst.marginBuy, inst.margin_buy)) -
    cleanNumber(firstNullableNumber(inst.marginSell, inst.margin_sell)) -
    cleanNumber(firstNullableNumber(inst.marginCashRepayment, inst.margin_cash_repayment));
  const shortNetIncrease =
    cleanNumber(firstNullableNumber(inst.shortSell, inst.short_sell)) -
    cleanNumber(firstNullableNumber(inst.shortBuy, inst.short_buy)) -
    cleanNumber(firstNullableNumber(inst.shortCashRepayment, inst.short_cash_repayment));
  return {
    ok: alignmentOk && marginNetIncrease > 0 && shortNetIncrease > 0,
    marginNetIncrease,
    shortNetIncrease,
    marginTradeDate,
    expectedTradeDate: expectedDate,
    alignmentOk,
    source: inst.marginShortSource || inst.margin_short_source || "",
    sourceTier: chipSourceTier(inst.marginShortSource || inst.margin_short_source || ""),
    reason: alignmentOk ? "" : "margin_short_source_date_mismatch",
  };
}

function buildVolumeTurnoverMatch({ stock, inst, issuedSharesMap, volumeAverageMap, previousVolumeMap, pctOrdinalRank, volumeIncreaseOrdinalRank, runMarketDate }) {
  const pct = cleanNumber(stock.percent);
  const volumeUnits = normalizeTradeVolumeUnits(stock);
  const volumeLots = volumeUnits.lots;
  const volumeShares = volumeUnits.shares;
  const issuedShares = issuedSharesMap.get(stock.code) || 0;
  const turnoverRate = issuedShares ? (volumeShares / issuedShares) * 100 : 0;
  const avgVolume = volumeAverageMap.get(stock.code) || 0;
  const volumeRatio = avgVolume ? volumeShares / avgVolume : 0;
  const previousVolumeShares = previousVolumeMap.get(stock.code) || 0;
  const previousVolumeExpansionRatio = previousVolumeShares ? volumeShares / previousVolumeShares : 0;
  const previousVolumeExpanded = previousVolumeExpansionRatio >= 1;
  const marginShort = marginShortSameIncrease(inst, runMarketDate);
  if (!(
    pct >= 3 &&
    turnoverRate > 5 &&
    volumeRatio >= 1 &&
    marginShort.ok &&
    previousVolumeExpanded
  )) return null;
  const volumeIncreaseTop100 = volumeIncreaseOrdinalRank > 0 && volumeIncreaseOrdinalRank <= 100;
  const volumeIncreaseBonus = volumeIncreaseTop100 ? 8 : 0;
  const volumeIncreaseRankText = volumeIncreaseOrdinalRank > 0
    ? `成交量增幅排行第 ${volumeIncreaseOrdinalRank} 名${volumeIncreaseTop100 ? "（前100加分）" : ""}`
    : "成交量增幅排行無資料";
  const score = clamp(Math.round(
    48 +
    Math.min((pct - 3) * 8, 32) +
    Math.min(volumeLots / 120, 18) +
    Math.min(turnoverRate * 4, 28) +
    Math.min(volumeRatio * 10, 22) +
    volumeIncreaseBonus
  ), 0, 100);
  const reason = `符合固定條件：漲幅 ${pct.toFixed(2)}%、周轉率 ${turnoverRate.toFixed(2)}%、量比 ${volumeRatio.toFixed(2)}；資券同增（融資淨增 ${Math.round(marginShort.marginNetIncrease).toLocaleString("zh-TW")}、融券淨增 ${Math.round(marginShort.shortNetIncrease).toLocaleString("zh-TW")}），成交量較前一日放大 ${previousVolumeExpansionRatio.toFixed(2)} 倍；${volumeIncreaseRankText}。`;
  return {
    id: "volume_turnover_breakout",
    short: "量價周轉",
    icon: "量",
    score,
    reason,
    volumeLots: Math.round(volumeLots),
    volumeShares: Math.round(volumeShares),
    volumeUnitSource: volumeUnits.source,
    turnoverRate: Number(turnoverRate.toFixed(2)),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    pctOrdinalRank,
    volumeIncreaseOrdinalRank,
    volumeIncreaseTop100,
    volumeIncreaseBonus,
    marginNetIncrease: Math.round(marginShort.marginNetIncrease),
    shortNetIncrease: Math.round(marginShort.shortNetIncrease),
    marginShortSameIncrease: true,
    marginShortSourceDate: marginShort.marginTradeDate,
    marginShortExpectedDate: marginShort.expectedTradeDate,
    marginShortAlignmentOk: marginShort.alignmentOk,
    marginShortSource: marginShort.source,
    marginShortSourceTier: marginShort.sourceTier,
    previousVolumeShares: Math.round(previousVolumeShares),
    previousVolumeExpansionRatio: Number(previousVolumeExpansionRatio.toFixed(2)),
    previousVolumeExpanded: true,
  };
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function stddev(values) {
  const nums = values.filter((value) => Number.isFinite(value) && value > 0);
  if (nums.length < 2) return 0;
  const mean = avg(nums);
  const variance = nums.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / nums.length;
  return Math.sqrt(variance);
}

function bollingerBandwidth(upper, lower) {
  const up = cleanNumber(upper);
  const low = cleanNumber(lower);
  if (up <= 0 || low <= 0) return { ratio: 0, pct: 0, state: "unknown", label: "未知" };
  const ratio = (up / low) - 1;
  const pct = ratio * 100;
  const state = pct <= STRATEGY5_BOLLINGER_NARROW_PCT
    ? "narrow"
    : pct >= STRATEGY5_BOLLINGER_WIDE_PCT
      ? "wide"
      : "normal";
  const label = state === "narrow" ? "窄" : state === "wide" ? "寬" : "正常";
  return { ratio, pct, state, label };
}

function yahooSuffix(stock) {
  const market = String(stock.market || "").toUpperCase();
  return market === "TPEX" || market === "OTC" || market === "TWO" ? "TWO" : "TW";
}

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: cleanNumber(quote.open?.[index]),
    high: cleanNumber(quote.high?.[index]),
    low: cleanNumber(quote.low?.[index]),
    close: cleanNumber(quote.close?.[index]),
    volume: cleanNumber(quote.volume?.[index]),
  })).filter((row) => row.open && row.high && row.low && row.close);
}

async function fetchYahooHistory(stock, suffix = yahooSuffix(stock)) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 540 * 24 * 60 * 60;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${stock.code}.${suffix}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(now + 24 * 60 * 60));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  const payload = await fetchJson(url.toString(), 18000);
  return normalizeYahooRows(payload).slice(-180);
}

async function fetchDailyHistory(stock) {
  try {
    const rows = await fetchYahooHistory(stock);
    if (rows.length >= 30) return rows;
  } catch {}
  try {
    const fallbackSuffix = yahooSuffix(stock) === "TW" ? "TWO" : "TW";
    const rows = await fetchYahooHistory(stock, fallbackSuffix);
    if (rows.length >= 30) return rows;
  } catch {}
  return [];
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await iteratee(items[index], index);
    }
  }));
  return results;
}

function limitUpDojiPatternFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 12) return null;
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastVolume = cleanNumber(last?.volume);
  const lastPct = prev?.close ? ((cleanNumber(last.close) - cleanNumber(prev.close)) / cleanNumber(prev.close)) * 100 : 0;
  const setupStart = Math.max(0, rows.length - 21);

  for (let limitIndex = rows.length - 10; limitIndex >= setupStart; limitIndex--) {
    const limitDay = rows[limitIndex];
    const limitPrev = rows[limitIndex - 1];
    const limitPct = limitPrev?.close ? ((cleanNumber(limitDay.close) - cleanNumber(limitPrev.close)) / cleanNumber(limitPrev.close)) * 100 : 0;
    const limitVolume = cleanNumber(limitDay.volume);
    if (limitPct < 9.0 || cleanNumber(limitDay.close) < cleanNumber(limitDay.open)) continue;

    const dojiEnd = Math.min(rows.length - 9, limitIndex + 5);
    for (let dojiIndex = limitIndex + 1; dojiIndex <= dojiEnd; dojiIndex++) {
      const doji = rows[dojiIndex];
      const dojiRange = cleanNumber(doji.high) - cleanNumber(doji.low);
      const dojiBodyRatio = dojiRange > 0 ? Math.abs(cleanNumber(doji.close) - cleanNumber(doji.open)) / dojiRange : 1;
      if (dojiBodyRatio > 0.35 || cleanNumber(doji.close) < cleanNumber(limitDay.close) * 0.93) continue;

      const boxRows = rows.slice(dojiIndex + 1, -1);
      if (boxRows.length < 7) continue;
      const boxHigh = Math.max(...boxRows.map((row) => cleanNumber(row.high)).filter(Boolean));
      const boxLow = Math.min(...boxRows.map((row) => cleanNumber(row.low)).filter(Boolean));
      const boxRangePct = boxLow ? ((boxHigh - boxLow) / boxLow) * 100 : 99;
      const boxVolumes = boxRows.map((row) => cleanNumber(row.volume)).filter(Boolean);
      const boxAvgVolume = avg(boxVolumes);
      const recentBoxVolume = avg(boxVolumes.slice(-3));
      const volumeContracting = boxAvgVolume > 0 && recentBoxVolume > 0 &&
        recentBoxVolume <= boxAvgVolume * 1.05 &&
        (!limitVolume || recentBoxVolume <= limitVolume * 0.85);
      const breakout = cleanNumber(last.close) >= boxHigh * 0.995 &&
        cleanNumber(last.close) > cleanNumber(last.open) &&
        lastPct >= 0.5 &&
        boxAvgVolume > 0 &&
        lastVolume >= boxAvgVolume * 1.15;
      if (boxRangePct <= 30 && volumeContracting && breakout) {
        return {
          boxDays: boxRows.length,
          boxRangePct,
          volumeRatio: boxAvgVolume ? lastVolume / boxAvgVolume : 0,
          pct: lastPct,
        };
      }
    }
  }
  return null;
}

function buildLimitUpDojiMatch({ stock, valueRank, volumeRank, rows }) {
  const pattern = limitUpDojiPatternFromRows(rows);
  if (!pattern || cleanNumber(stock.close) < 10 || valueRank < 35) return null;
  const scoreBase = clamp(Math.round(35 + pattern.pct * 7 + valueRank * 0.24 + volumeRank * 0.18), 0, 100);
  const score = clamp(scoreBase + 20 + Math.min(pattern.volumeRatio * 4, 12), 0, 100);
  const reason = `近20日漲停後出十字星，橫盤 ${pattern.boxDays} 天、區間 ${pattern.boxRangePct.toFixed(2)}%，縮量後今日放量 ${pattern.volumeRatio.toFixed(2)} 倍突破。`;
  return { id: "limit_up_doji", short: "漲停十字", icon: "十", score, reason };
}

function bollingerAt(rows, index) {
  if (index < 19) return null;
  const closes = rows.slice(index - 19, index + 1).map((row) => cleanNumber(row.close));
  if (closes.length < 20 || closes.some((value) => value <= 0)) return null;
  const middle = avg(closes);
  const deviation = stddev(closes);
  const upper = middle + deviation * 2;
  const lower = middle - deviation * 2;
  const bandwidth = bollingerBandwidth(upper, lower);
  return {
    upper,
    middle,
    lower,
    bandwidthRatio: bandwidth.ratio,
    bandwidthPct: bandwidth.pct,
    bandwidthState: bandwidth.state,
    bandwidthLabel: bandwidth.label,
  };
}

function calculateKdj(rows, period = 9) {
  let k = 50;
  let d = 50;
  return rows.map((row, index) => {
    if (index < period - 1) return { k, d, j: 3 * k - 2 * d };
    const window = rows.slice(index - period + 1, index + 1);
    const high = Math.max(...window.map((item) => cleanNumber(item.high)).filter(Boolean));
    const low = Math.min(...window.map((item) => cleanNumber(item.low)).filter(Boolean));
    const close = cleanNumber(row.close);
    const rsv = high > low ? ((close - low) / (high - low)) * 100 : 50;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    return { k, d, j: 3 * k - 2 * d };
  });
}

function bollingerSlopeMode(rows) {
  const current = bollingerAt(rows, rows.length - 1);
  const prev3 = bollingerAt(rows, rows.length - 4);
  const prev5 = bollingerAt(rows, rows.length - 6);
  if (!current || !prev3 || !prev5) return null;
  const middleSlopePct = ((current.middle - prev5.middle) / prev5.middle) * 100;
  const upperSlopePct = ((current.upper - prev5.upper) / prev5.upper) * 100;
  const lowerSlopePct = ((current.lower - prev5.lower) / prev5.lower) * 100;
  const widthPct = current.middle ? ((current.upper - current.lower) / current.middle) * 100 : 0;
  const prevWidthPct = prev5.middle ? ((prev5.upper - prev5.lower) / prev5.middle) * 100 : 0;
  const expanding = widthPct >= prevWidthPct * 0.96;
  const rising = middleSlopePct >= 0.35 && upperSlopePct >= 0 && lowerSlopePct >= -0.35;
  const flat = Math.abs(middleSlopePct) <= 1.0 && Math.abs(upperSlopePct) <= 1.4 && Math.abs(lowerSlopePct) <= 1.4;
  return {
    current,
    prev3,
    prev5,
    middleSlopePct,
    upperSlopePct,
    lowerSlopePct,
    widthPct,
    channelBandwidthPct: current.bandwidthPct,
    channelBandwidthRatio: current.bandwidthRatio,
    channelBandwidthState: current.bandwidthState,
    channelBandwidthLabel: current.bandwidthLabel,
    expanding,
    rising,
    flat,
  };
}

function bollingerKdjPatternFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 35) return null;
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const lastClose = cleanNumber(last?.close);
  const lastOpen = cleanNumber(last?.open);
  const prevClose = cleanNumber(prev?.close);
  const lastVolume = cleanNumber(last?.volume);
  if (!lastClose || !prevClose) return null;

  const kdj = calculateKdj(rows);
  const lastKdj = kdj.at(-1);
  const prevKdj = kdj.at(-2);
  const crossed = prevKdj.k <= prevKdj.d && lastKdj.k > lastKdj.d;
  const freshCross = crossed || (lastKdj.k > lastKdj.d && kdj.slice(-4, -1).some((item) => item.k <= item.d));
  const kdjTurningUp = lastKdj.k > prevKdj.k && lastKdj.d >= prevKdj.d * 0.98 && lastKdj.k <= 88;
  if (!freshCross || !kdjTurningUp) return null;

  const slope = bollingerSlopeMode(rows);
  if (!slope) return null;
  const { current } = slope;
  const pct = ((lastClose - prevClose) / prevClose) * 100;
  const redK = lastClose >= lastOpen && pct >= -0.5;
  const recentVolumes = rows.slice(-6, -1).map((row) => cleanNumber(row.volume));
  const volumeRatio = avg(recentVolumes) ? lastVolume / avg(recentVolumes) : 0;

  const midDistancePct = current.middle ? ((lastClose - current.middle) / current.middle) * 100 : 99;
  const lowerDistancePct = current.lower ? ((lastClose - current.lower) / current.lower) * 100 : 99;
  const fromLowerPct = current.lower ? ((lastClose - current.lower) / current.lower) * 100 : 99;
  const upperDistancePct = current.upper ? ((lastClose - current.upper) / current.upper) * 100 : 99;
  const belowUpper = current.upper && lastClose <= current.upper * 1.035;
  const upperRailCurlOk = Boolean(current.upper && slope.upperSlopePct >= 0.35 && lastClose >= current.upper * 0.965 && lastClose <= current.upper * 1.04 && slope.expanding);
  const midBuy = slope.rising && belowUpper && lastClose >= current.middle * 0.985 && lastClose <= current.middle * 1.09;
  const lowerBuy = slope.flat && lastClose >= current.lower * 0.985 && lastClose <= current.middle * 1.04;
  if (!redK || volumeRatio < 0.75 || (!midBuy && !lowerBuy)) return null;

  return {
    mode: midBuy ? "三線向上中軌買點" : "三線走平下軌買點",
    pct,
    k: lastKdj.k,
    d: lastKdj.d,
    j: lastKdj.j,
    middle: current.middle,
    upper: current.upper,
    lower: current.lower,
    bollingerBandwidthRatio: slope.channelBandwidthRatio,
    bollingerBandwidthPct: slope.channelBandwidthPct,
    bollingerBandwidthState: slope.channelBandwidthState,
    bollingerBandwidthLabel: slope.channelBandwidthLabel,
    midDistancePct,
    lowerDistancePct,
    fromLowerPct,
    upperDistancePct,
    middleSlopePct: slope.middleSlopePct,
    upperSlopePct: slope.upperSlopePct,
    lowerSlopePct: slope.lowerSlopePct,
    upperRailCurlOk,
    volumeRatio,
  };
}

function buildBollingerKdjMatch({ stock, valueRank, volumeRank, rows }) {
  const pattern = bollingerKdjPatternFromRows(rows);
  if (!pattern || cleanNumber(stock.close) < 10 || valueRank < 30) return null;
  const score = clamp(Math.round(
    42 +
    valueRank * 0.18 +
    volumeRank * 0.12 +
    Math.min(Math.max(pattern.pct, 0) * 5, 18) +
    Math.min(pattern.volumeRatio * 6, 16) +
    (pattern.mode.includes("中軌") ? 8 : 5)
  ), 0, 100);
  const reason = `${pattern.mode}：20MA ${pattern.middle.toFixed(2)}、上軌 ${pattern.upper.toFixed(2)}、下軌 ${pattern.lower.toFixed(2)}；帶寬 ${pattern.bollingerBandwidthPct.toFixed(2)}%（${pattern.bollingerBandwidthLabel}），KDJ 黃金交叉 K ${pattern.k.toFixed(1)} / D ${pattern.d.toFixed(1)}，量比 ${pattern.volumeRatio.toFixed(2)}。`;
  return {
    id: "bollinger_kdj_buy",
    short: "布林KDJ",
    icon: "K",
    score,
    reason,
    bollingerMode: pattern.mode,
    bollingerMiddle: Number(pattern.middle.toFixed(2)),
    bollingerUpper: Number(pattern.upper.toFixed(2)),
    bollingerLower: Number(pattern.lower.toFixed(2)),
    bollingerBandwidthFormula: "(upper/lower)-1",
    bollingerBandwidthRatio: roundNumber(pattern.bollingerBandwidthRatio, 4),
    bollingerBandwidthPct: roundNumber(pattern.bollingerBandwidthPct, 2),
    bollingerBandwidthState: pattern.bollingerBandwidthState,
    bollingerBandwidthLabel: pattern.bollingerBandwidthLabel,
    upperRailCurlOk: pattern.upperRailCurlOk === true,
    upperSlopePct: roundNumber(pattern.upperSlopePct, 2),
    upperDistancePct: roundNumber(pattern.upperDistancePct, 2),
    middleSlopePct: roundNumber(pattern.middleSlopePct, 2),
    lowerSlopePct: roundNumber(pattern.lowerSlopePct, 2),
    kdjK: Number(pattern.k.toFixed(1)),
    kdjD: Number(pattern.d.toFixed(1)),
    kdjJ: Number(pattern.j.toFixed(1)),
    volumeRatio: Number(pattern.volumeRatio.toFixed(2)),
  };
}

async function buildMatches(stocks, institutionData, issuedSharesMap = new Map(), volumeAverageMap = new Map(), previousVolumeMap = new Map(), runMarketDate = "") {
  const stocksWithVolumeUnits = stocks.map((stock) => {
    const volumeUnits = normalizeTradeVolumeUnits(stock);
    return {
      ...stock,
      volumeShares: Math.round(volumeUnits.shares),
      volumeLots: volumeUnits.lots,
      volumeUnitSource: volumeUnits.source,
      normalizedTradeVolume: volumeUnits.shares,
    };
  });
  const valueRanks = rankMap(stocksWithVolumeUnits, "value");
  const volumeRanks = rankMap(stocksWithVolumeUnits, "normalizedTradeVolume");
  const pctOrdinalRanks = ordinalRankMap(stocksWithVolumeUnits, (stock) => stock.percent);
  const volumeIncreaseOrdinalRanks = ordinalRankMap(stocksWithVolumeUnits, (stock) => {
    const avgVolume = volumeAverageMap.get(stock.code) || 0;
    return avgVolume ? cleanNumber(stock.volumeShares) / avgVolume : 0;
  });
  const confluenceSources = readChipKConfluenceSources(institutionData);
  const baseRows = stocksWithVolumeUnits.map((stock) => {
    const inst = institutionData[stock.code] || {};
    const valueRank = valueRanks.get(stock.code) || 0;
    const volumeRank = volumeRanks.get(stock.code) || 0;
    const close = cleanNumber(stock.close);
    const foreign = cleanNumber(inst.foreign);
    const trust = cleanNumber(inst.trust);
    const dealer = cleanNumber(inst.dealer);
    const total = cleanNumber(inst.total || (foreign + trust + dealer));
    const normalizedInst = {
      foreign,
      trust,
      dealer,
      total,
      foreignStreak: cleanNumber(inst.foreignStreak || inst.foreign_streak),
      trustStreak: cleanNumber(inst.trustStreak || inst.trust_streak),
      jointStreak: cleanNumber(inst.jointStreak || inst.joint_streak),
      tradeVolume: cleanNumber(inst.tradeVolume || inst.trade_volume),
      value: cleanNumber(inst.value || inst.trade_value),
      marginBuy: cleanNumber(firstNullableNumber(inst.marginBuy, inst.margin_buy)),
      marginSell: cleanNumber(firstNullableNumber(inst.marginSell, inst.margin_sell)),
      marginCashRepayment: cleanNumber(firstNullableNumber(inst.marginCashRepayment, inst.margin_cash_repayment)),
      marginBalance: cleanNumber(firstNullableNumber(inst.marginBalance, inst.margin_balance)),
      shortSell: cleanNumber(firstNullableNumber(inst.shortSell, inst.short_sell)),
      shortBuy: cleanNumber(firstNullableNumber(inst.shortBuy, inst.short_buy)),
      shortCashRepayment: cleanNumber(firstNullableNumber(inst.shortCashRepayment, inst.short_cash_repayment)),
      shortBalance: cleanNumber(firstNullableNumber(inst.shortBalance, inst.short_balance)),
      institutionTradeDate: inst.institutionTradeDate || inst.institution_trade_date || inst.tradeDate || inst.trade_date || "",
      institutionSource: inst.institutionSource || inst.institution_source || inst.source || "",
      marginTradeDate: inst.marginTradeDate || inst.margin_trade_date || "",
      marginShortSource: inst.marginShortSource || inst.margin_short_source || "",
      branchTradeDate: inst.branchTradeDate || inst.branch_trade_date || "",
      branchSource: inst.branchSource || inst.branch_source || "",
      branchBuy: cleanNumber(inst.branchBuy || inst.branch_buy),
      branchSell: cleanNumber(inst.branchSell || inst.branch_sell),
      branchNetBuy: cleanNumber(inst.branchNetBuy || inst.branch_net_buy),
      branchBuyCount: cleanNumber(inst.branchBuyCount || inst.branch_buy_count),
      branchSellCount: cleanNumber(inst.branchSellCount || inst.branch_sell_count),
      mainForceBranchNetBuy: cleanNumber(inst.mainForceBranchNetBuy || inst.main_force_branch_net_buy),
      topBranchNetBuy: cleanNumber(inst.topBranchNetBuy || inst.top_branch_net_buy),
      topBranchNetSell: cleanNumber(inst.topBranchNetSell || inst.top_branch_net_sell),
      topBranchCount: cleanNumber(inst.topBranchCount || inst.top_branch_count),
      branchConcentrationRatio: cleanNumber(inst.branchConcentrationRatio || inst.branch_concentration_ratio),
      branchPowerScore: cleanNumber(inst.branchPowerScore || inst.branch_power_score),
      branchStatus: inst.branchStatus || inst.branch_status || "",
    };
    const matches = [
      buildChipKConfluenceMatch({ stock, inst: normalizedInst, confluenceSources, valueRank, volumeRank }),
      buildVolumeTurnoverMatch({
        stock,
        inst: normalizedInst,
        issuedSharesMap,
        volumeAverageMap,
        previousVolumeMap,
        pctOrdinalRank: pctOrdinalRanks.get(stock.code) || 0,
        volumeIncreaseOrdinalRank: volumeIncreaseOrdinalRanks.get(stock.code) || 0,
        runMarketDate,
      }),
    ].filter(Boolean);
    const volumeTurnover = matches.find((match) => match.id === "volume_turnover_breakout");
    return {
      ...stock,
      valueRank,
      volumeRank,
      volumeLots: volumeTurnover?.volumeLots ?? Math.round(stock.volumeLots || 0),
      volumeShares: volumeTurnover?.volumeShares ?? Math.round(stock.volumeShares || 0),
      volumeUnitSource: volumeTurnover?.volumeUnitSource || stock.volumeUnitSource,
      turnoverRate: volumeTurnover?.turnoverRate,
      volumeRatio: volumeTurnover?.volumeRatio,
      inst: normalizedInst,
      branchTradeDate: normalizedInst.branchTradeDate,
      branchSource: normalizedInst.branchSource,
      branchNetBuy: normalizedInst.branchNetBuy,
      topBranchNetBuy: normalizedInst.topBranchNetBuy,
      branchPowerScore: normalizedInst.branchPowerScore,
      branchStatus: normalizedInst.branchStatus,
      matches,
    };
  });

  const strategy4Candidates = await readStrategy4Candidates();
  const strategy4ByCode = new Map(strategy4Candidates.map((stock) => [String(stock.code || ""), stock]));
  const historyCandidates = baseRows
    .filter((stock) => {
      const jointBuying = stock.inst.foreign > 0 && stock.inst.trust > 0 && stock.inst.total > 0;
      return cleanNumber(stock.close) >= 10 && (stock.valueRank >= 35 || jointBuying);
    })
    .sort((a, b) => b.valueRank - a.valueRank || b.volumeRank - a.volumeRank || cleanNumber(b.percent) - cleanNumber(a.percent));
  const historyByCode = new Map();
  await mapLimit(historyCandidates, HISTORY_CONCURRENCY, async (stock) => {
    const rows = await fetchDailyHistory(stock);
    if (rows.length) historyByCode.set(stock.code, rows);
  });

  return baseRows.map((stock) => {
    const strategy4 = strategy4ByCode.get(stock.code) || {};
    const mergedStock = {
      ...stock,
      strategy4Matched: Boolean(strategy4ByCode.has(stock.code)),
      strategy4RunId: strategy4.strategy4RunId || "",
      strategy4Score: cleanNumber(strategy4.swingScore || strategy4.score),
      strategy4Reason: strategy4.reason || "",
      strategy4Signals: strategy4.signals || strategy4.swingSignals || [],
    };
    const limitUpDoji = buildLimitUpDojiMatch({
      stock: mergedStock,
      valueRank: stock.valueRank,
      volumeRank: stock.volumeRank,
      rows: historyByCode.get(stock.code) || [],
    });
    const foreignTrustBreakout = buildStrategy5Match({
      stock: mergedStock,
      inst: stock.inst,
      valueRank: stock.valueRank,
      volumeRank: stock.volumeRank,
      rows: historyByCode.get(stock.code) || [],
      confluenceSources,
    });
    const bollingerKdj = buildBollingerKdjMatch({
      stock: mergedStock,
      valueRank: stock.valueRank,
      volumeRank: stock.volumeRank,
      rows: historyByCode.get(stock.code) || [],
    });
    const matches = [...stock.matches, foreignTrustBreakout, limitUpDoji, bollingerKdj].filter(Boolean);
    const sortedMatches = matches.sort((a, b) => (b.score || 0) - (a.score || 0));
    const score = sortedMatches.length ? Math.max(...sortedMatches.map((match) => match.score || 0)) : 0;
    return { ...mergedStock, score, matches: sortedMatches, activeMatch: sortedMatches[0] || null };
  })
    .filter((stock) => stock.matches.length && stock.activeMatch && stock.score && stock.close >= 10)
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value);
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const institution = await loadInstitutionLatestPayload();
  const chipSourceHealth = await fetchInstitutionSourceHealth().catch((error) => {
    console.warn(`strategy5 chip source health snapshot skipped: ${error.message}`);
    return {};
  });
  const finmindChipMap = await fetchFinMindChipLatestMap().catch((error) => {
    console.warn(`strategy5 FinMind chip supplement skipped: ${error.message}`);
    return new Map();
  });
  const institutionData = mergeInstitutionDataWithFinMind(institution.data || {}, finmindChipMap);
  const stocks = await fetchUniverse();
  if (!stocks.length) throw new Error("No stock universe");
  if (finmindChipMap.size) console.log(`strategy5 FinMind chip supplement rows=${finmindChipMap.size}`);
  const quoteDate = compactDateKey(stocks.find((stock) => stock.quoteDate)?.quoteDate);
  const institutionDate = compactDateKey(institution.usedDate || institution.date);
  const chipLatestTradeDate = latestDateKey([
    chipSourceHealth.latestTradeDate,
    latestFinMindChipTradeDate(finmindChipMap),
    institutionDate,
  ]);
  const sourceDate = chipLatestTradeDate || institutionDate || quoteDate || taipeiDateKey();
  const [issuedSharesResult, volumeAverageResult] = await Promise.all([
    fetchIssuedShares(),
    fetchHistoricalVolumes(sourceDate),
  ]);
  const sourceWarnings = [
    ...issuedSharesResult.warnings,
    ...volumeAverageResult.warnings,
  ];
  sourceWarnings.forEach((warning) => console.warn(`strategy5 source warning: ${warning}`));
  const now = new Date();
  const runMarketDate = sourceDate;
  const marginShortSourceDate = compactDateKey(chipSourceHealth.marginLatestTradeDate || "");
  const marginShortAlignmentOk = Boolean(marginShortSourceDate && marginShortSourceDate === runMarketDate);
  const matches = await buildMatches(stocks, institutionData, issuedSharesResult.map, volumeAverageResult.map, volumeAverageResult.previousMap, runMarketDate);
  const output = {
    ok: true,
    source: USE_MIS_QUOTES ? "github-actions-mis-realtime" : "github-actions-official-daily",
    updatedAt: now.toISOString(),
    generatedAt: now.toISOString(),
    runTimestamp: now.toISOString(),
    generatedDate: runMarketDate,
    runMarketDate,
    usedDate: sourceDate,
    sourceDate,
    schedule: "daily complete scan",
    fullScan: true,
    complete: true,
    total: stocks.length,
    scannedThisRun: stocks.length,
    scannedCodes: stocks.map((stock) => stock.code),
    sourceHealth: {
      ...chipSourceHealth,
      ...universeSourceHealth,
      issuedSharesCount: issuedSharesResult.map.size,
      volumeAverageCount: volumeAverageResult.map.size,
      volumeAverageAnchorDate: volumeAverageResult.anchorDate,
      finmindChipCount: finmindChipMap.size,
      branchFlowCount: [...finmindChipMap.values()].filter((row) => row.branchTradeDate).length,
      chipLatestTradeDate,
      institutionLatestDate: institutionDate,
      marginShortSourceDate,
      marginShortExpectedDate: runMarketDate,
      marginShortAlignmentOk,
      marketQuoteDate: quoteDate,
      warningCount: sourceWarnings.length,
      warnings: sourceWarnings.slice(0, 8),
    },
    count: matches.length,
    matches,
  };

  await publishStrategy5CompleteRunToSupabase(output);
  await publishStrategyCacheStatus("strategy5", "策略5-量價籌碼", output, {
    used_date: output.sourceDate || output.generatedDate || output.usedDate || output.date,
    updated_at: output.updatedAt || output.generatedAt || new Date().toISOString(),
    scan_status: output.ok === false ? "failed" : "complete",
    scanned: output.total,
    total: output.total,
    match_count: output.count,
    source: STRATEGY5_RESULTS_TABLE,
    log: `quality=${output.qualityStatus || ""}`,
  });

  if (STRATEGY5_API_ONLY) {
    console.log(`strategy5 API-only: skipped static strategy5*.json output, matches ${matches.length}`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if ((backup.matches || []).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`strategy5 cache updated: matches ${matches.length}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildStrategy5RunRow,
  buildStrategy5ResultRows,
  buildStrategy5FieldCompleteness,
  buildWriteBudget,
  normalizeTradeVolumeUnits,
};




