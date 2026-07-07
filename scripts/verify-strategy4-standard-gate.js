const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/strategy4-standard-gate");
const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const MIN_SOURCE_ROWS = Number(process.env.STRATEGY4_STANDARD_MIN_SOURCE_ROWS || 1500);
const MIN_HISTORY_ROWS = Number(process.env.STRATEGY4_STANDARD_MIN_HISTORY_ROWS || 60000);
const MIN_MATCH_COUNT = Number(process.env.STRATEGY4_MIN_MATCH_COUNT || 10);
const RUN_TERMINAL = !process.argv.includes("--skip-terminal");
const JSON_OUTPUT = process.argv.includes("--json");
const HISTORY_LOOKBACK_DAYS = Number(process.env.STRATEGY4_HISTORY_LOOKBACK_DAYS || 420);

const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

const REQUIRED_WALLET_FIELDS = [
  "mf",
  "controlLine",
  "obvLine",
  "volumeMa5",
  "volumeMa20",
  "volumeMa60",
  "isGray",
  "isStrongMove",
  "isDangerZone",
  "syncScore",
  "strongBuy",
  "volumeCrossUp",
  "strongSell",
];

const REQUIRED_MUTAKI_FIELDS = [
  "ma5",
  "ma10",
  "ma20",
  "ma60",
  "ma120",
  "ma240",
  "ema21",
  "ema21Up",
  "ma20Heavy",
  "fib382",
  "fib500",
  "fib618",
  "fibRatio",
  "bias20",
  "rsi14",
  "atr14",
  "entryPrice",
  "stopPrice",
  "targetPrice",
  "riskReward",
  "trendConfirmed",
  "isBullTrend",
  "isRealBody",
  "isDeepFall",
  "isGapUp",
  "isRunawayUp",
  "isBreakawayUp",
];

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {}
  }
  return "";
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function hasOwnField(object, field) {
  return object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, field);
}

function missingFields(object, fields) {
  return fields.filter((field) => !hasOwnField(object, field));
}

function issue(list, ok, id, message, detail = {}) {
  const item = { id, ok: Boolean(ok), message, detail };
  list.push(item);
  return item.ok;
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 240)}`.trim());
    return JSON.parse(text || "null");
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRows(table, query) {
  return fetchJson(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
}

async function supabaseExactCount(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "count=exact",
    },
  });
  if (!response.ok) throw new Error(`${table} count HTTP ${response.status}`);
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) || 0 : 0;
}

async function latestDateAndCount(table, dateField) {
  const rows = await supabaseRows(table, `select=${dateField}&order=${dateField}.desc&limit=1`);
  const latestDate = rows?.[0]?.[dateField] || "";
  const rowCount = latestDate
    ? await supabaseExactCount(table, `select=${dateField}&${dateField}=eq.${encodeURIComponent(latestDate)}`)
    : 0;
  return { table, dateField, latestDate, rowCount };
}

async function historyCount(table, dateField, from) {
  const rowCount = await supabaseExactCount(table, `select=${dateField}&${dateField}=gte.${encodeURIComponent(from)}`);
  const latest = await latestDateAndCount(table, dateField);
  return { ...latest, from, historyRows: rowCount };
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, ["--use-system-ca", script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 240000,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? result.error.message : "",
  };
}

function parseJsonOutput(result) {
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function breakdownIssues(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const code = String(row.code || payload.code || "");
  const issues = [];
  const walletMissing = missingFields(payload.wallet, REQUIRED_WALLET_FIELDS);
  const mutakiMissing = missingFields(payload.mutakiV17, REQUIRED_MUTAKI_FIELDS);
  if (!payload.wallet || typeof payload.wallet !== "object") issues.push(`${code}: wallet missing`);
  else if (walletMissing.length) issues.push(`${code}: wallet missing ${walletMissing.join(",")}`);
  if (!payload.mutakiV17 || typeof payload.mutakiV17 !== "object") issues.push(`${code}: mutakiV17 missing`);
  else if (mutakiMissing.length) issues.push(`${code}: mutakiV17 missing ${mutakiMissing.join(",")}`);
  return issues;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const checks = [];
  const warnings = [];
  const details = {};

  const resourceResult = runNodeScript("scripts/check-scanner-resource-health.js", ["--strategy=strategy4"]);
  const resourceHealth = parseJsonOutput(resourceResult);
  details.resourceHealth = resourceHealth;
  issue(checks, resourceResult.ok && resourceHealth?.strategy === "Strategy4", "resource-health-row", "v_scanner_resource_health has Strategy4 row", resourceHealth);
  issue(checks, resourceHealth?.status === "ready", "resource-health-ready", "Strategy4 resource health status is ready", resourceHealth);
  issue(checks, String(resourceHealth?.requiredSource || "") === "stock_daily_volume", "resource-health-source", "Strategy4 required source is stock_daily_volume", resourceHealth);
  issue(checks, Boolean(resourceHealth?.latestDate), "resource-health-latest-date", "Strategy4 resource health latestDate exists", resourceHealth);
  issue(
    checks,
    cleanNumber(resourceHealth?.rowCount) >= MIN_SOURCE_ROWS || cleanNumber(resourceHealth?.dailyFallback?.rowCount) >= MIN_SOURCE_ROWS,
    "resource-health-row-count",
    `Strategy4 resource health rowCount or dailyFallback.rowCount >= ${MIN_SOURCE_ROWS}`,
    resourceHealth
  );
  issue(checks, Boolean(resourceHealth?.reason), "resource-health-reason", "Strategy4 resource health reason is readable", resourceHealth);
  issue(checks, Boolean(resourceHealth?.suggestedScannerBehavior), "resource-health-behavior", "Strategy4 suggested scanner behavior is readable", resourceHealth);
  issue(checks, Boolean(resourceHealth?.updatedAt), "resource-health-updated-at", "Strategy4 resource health updatedAt exists", resourceHealth);

  const historyFrom = isoDateDaysAgo(HISTORY_LOOKBACK_DAYS);
  const stockDaily = await latestDateAndCount("stock_daily_volume", "trade_date");
  const finmindDaily = await latestDateAndCount("finmind_daily_ohlcv", "trade_date");
  const fugleDaily = await latestDateAndCount("fugle_daily_volume", "trade_date");
  const strategy4History = await historyCount("strategy4_daily_ohlcv_view", "trade_date", historyFrom);
  const dailyAfterCloseReady = stockDaily.rowCount >= MIN_SOURCE_ROWS || finmindDaily.rowCount >= MIN_SOURCE_ROWS;
  details.sourceDrift = { stockDaily, finmindDaily, fugleDaily, strategy4History };
  issue(checks, dailyAfterCloseReady, "source-daily-after-close-count", `stock_daily_volume or finmind_daily_ohlcv latest rows >= ${MIN_SOURCE_ROWS}`, { stockDaily, finmindDaily });
  issue(checks, Boolean(stockDaily.latestDate), "source-stock-daily-date", "stock_daily_volume latestDate exists", stockDaily);
  issue(checks, Boolean(finmindDaily.latestDate), "source-finmind-daily-date", "finmind_daily_ohlcv latestDate exists", finmindDaily);
  issue(checks, fugleDaily.rowCount >= MIN_SOURCE_ROWS || finmindDaily.rowCount >= MIN_SOURCE_ROWS, "source-fugle-or-finmind-daily-count", `fugle_daily_volume or finmind_daily_ohlcv latest rows >= ${MIN_SOURCE_ROWS}`, { fugleDaily, finmindDaily });
  issue(checks, Boolean(fugleDaily.latestDate), "source-fugle-daily-date", "fugle_daily_volume latestDate exists", fugleDaily);
  issue(checks, strategy4History.historyRows >= MIN_HISTORY_ROWS, "source-history-count", `strategy4_daily_ohlcv_view ${HISTORY_LOOKBACK_DAYS}d rows >= ${MIN_HISTORY_ROWS}`, strategy4History);
  issue(checks, Boolean(strategy4History.latestDate), "source-history-latest-date", "strategy4_daily_ohlcv_view latestDate exists", strategy4History);

  const prewarmStatus = readJson(path.join(STATE_DIR, "strategy4-history-prewarm-status.json"), {});
  details.readyHistory = prewarmStatus;
  issue(checks, prewarmStatus?.ok === true, "history-prewarm-ok", "Strategy4 history prewarm ok=true", prewarmStatus);
  issue(checks, String(prewarmStatus?.phase || "") === "complete", "history-prewarm-complete", "Strategy4 history prewarm phase=complete", prewarmStatus);
  issue(checks, cleanNumber(prewarmStatus?.universe) >= MIN_SOURCE_ROWS, "history-universe", `Strategy4 universe >= ${MIN_SOURCE_ROWS}`, prewarmStatus);
  issue(checks, cleanNumber(prewarmStatus?.computableUniverse) === cleanNumber(prewarmStatus?.universe), "history-computable-100", "Strategy4 computableUniverse equals universe", prewarmStatus);
  issue(checks, cleanNumber(prewarmStatus?.remainingMiss) === 0, "history-remaining-miss-zero", "Strategy4 history remainingMiss=0", prewarmStatus);
  issue(checks, cleanNumber(prewarmStatus?.insufficientHistoryCount) === 0, "history-insufficient-zero", "Strategy4 insufficientHistoryCount=0", prewarmStatus);
  issue(checks, cleanNumber(prewarmStatus?.supabaseVolumeRows) >= MIN_SOURCE_ROWS, "history-volume-rows", `Strategy4 supabaseVolumeRows >= ${MIN_SOURCE_ROWS}`, prewarmStatus);

  const runRows = await supabaseRows("strategy4_scan_runs", [
    "select=run_id,scan_date,finished_at,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,quality_status,schema_version,volume_unit,data_contract_source,payload",
    "strategy=eq.strategy4",
    "status=eq.complete",
    "complete=eq.true",
    "order=finished_at.desc",
    "limit=1",
  ].join("&"));
  const run = runRows[0] || null;
  details.latestCompleteRun = run;
  issue(checks, Boolean(run?.run_id), "complete-run-exists", "Strategy4 latest complete run exists", run);
  issue(checks, cleanNumber(run?.expected_total) >= MIN_SOURCE_ROWS, "complete-run-expected-total", `Strategy4 complete run expected_total >= ${MIN_SOURCE_ROWS}`, run);
  issue(checks, cleanNumber(run?.scanned_count) === cleanNumber(run?.expected_total), "complete-run-scanned-100", "Strategy4 complete run scanned_count == expected_total", run);
  issue(checks, cleanNumber(run?.result_count) >= MIN_MATCH_COUNT, "complete-run-result-count", `Strategy4 complete run result_count >= ${MIN_MATCH_COUNT}`, run);
  issue(checks, cleanNumber(run?.no_data_count) === 0, "complete-run-no-data-zero", "Strategy4 complete run no_data_count=0", run);
  issue(checks, cleanNumber(run?.error_count) === 0, "complete-run-error-zero", "Strategy4 complete run error_count=0", run);
  issue(checks, String(run?.quality_status || "") === "complete", "complete-run-quality", "Strategy4 complete run quality_status=complete", run);

  const runId = String(run?.run_id || "");
  const resultRows = runId ? await supabaseRows("strategy4_scan_results", [
    "select=run_id,code,name,rank,score,zone,zone_label,complete,quality_status,schema_version,volume_unit,data_contract_source,price_source,payload,updated_at",
    "strategy=eq.strategy4",
    `run_id=eq.${encodeURIComponent(runId)}`,
    "order=rank.asc",
    `limit=${Math.max(cleanNumber(run?.result_count) + 5, 25)}`,
  ].join("&")) : [];
  const resultBreakdownIssues = resultRows.flatMap(breakdownIssues);
  details.publishedResults = {
    runId,
    rows: resultRows.length,
    missingBreakdown: resultBreakdownIssues.length,
    sampleBreakdownIssues: resultBreakdownIssues.slice(0, 10),
  };
  issue(checks, resultRows.length === cleanNumber(run?.result_count), "published-result-count", "strategy4_scan_results rows == run.result_count", details.publishedResults);
  issue(checks, resultBreakdownIssues.length === 0, "published-breakdown-complete", "Every Strategy4 result has wallet and mutakiV17 breakdown", details.publishedResults);
  issue(checks, resultRows.every((row) => row.complete === true), "published-results-complete", "Every Strategy4 result row complete=true", { bad: resultRows.filter((row) => row.complete !== true).slice(0, 5) });
  issue(checks, resultRows.every((row) => String(row.quality_status || "") === "complete"), "published-results-quality", "Every Strategy4 result row quality_status=complete", { bad: resultRows.filter((row) => String(row.quality_status || "") !== "complete").slice(0, 5) });

  const apiPayload = await fetchJson(`${BASE_URL}/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1&fresh=${Date.now()}`, {}, 45000);
  details.api = {
    ok: apiPayload?.ok,
    runId: apiPayload?.runId,
    count: apiPayload?.count,
    total: apiPayload?.total,
    cacheSource: apiPayload?.cacheSource,
    qualityStatus: apiPayload?.qualityStatus,
    scanStamp: apiPayload?.scanStamp,
    sourceHealth: apiPayload?.sourceHealth,
  };
  issue(checks, apiPayload?.ok === true, "api-ok", "/api/strategy4-latest ok=true", details.api);
  issue(checks, String(apiPayload?.runId || "") === runId, "api-run-id", "/api/strategy4-latest runId matches latest complete run", details.api);
  issue(checks, cleanNumber(apiPayload?.count) > 0, "api-count", "/api/strategy4-latest count > 0", details.api);
  issue(checks, Boolean(apiPayload?.scanStamp), "api-scan-stamp", "/api/strategy4-latest scanStamp exists", details.api);
  issue(checks, ["supabase-api", "supabase-snapshot"].includes(String(apiPayload?.cacheSource || "")), "api-cache-source", "/api/strategy4-latest cacheSource is supabase-api or supabase-snapshot", details.api);
  issue(checks, String(apiPayload?.qualityStatus || "") === "complete", "api-quality", "/api/strategy4-latest qualityStatus=complete", details.api);

  if (RUN_TERMINAL) {
    const terminalChecks = [
      ["terminal-resource-chain", runNodeScript("scripts/verify-terminal-resource-chain.js", ["--routes=strategy4"])],
      ["terminal-fields", runNodeScript("scripts/verify-terminal-field-completeness.js", ["--routes=strategy4"])],
      ["terminal-source-contracts", runNodeScript("scripts/verify-terminal-source-contracts.js", ["--routes=strategy4"])],
    ];
    details.terminal = terminalChecks.map(([id, result]) => ({
      id,
      ok: result.ok,
      status: result.status,
      stdoutTail: result.stdout.split(/\r?\n/).filter(Boolean).slice(-8),
      stderrTail: result.stderr.split(/\r?\n/).filter(Boolean).slice(-8),
      error: result.error,
    }));
    terminalChecks.forEach(([id, result]) => {
      issue(checks, result.ok, id, `${id} passes for Strategy4`, details.terminal.find((item) => item.id === id));
    });
  }

  const ok = checks.every((check) => check.ok);
  const payload = {
    ok,
    strategy: "strategy4",
    source: "verify-strategy4-standard-gate",
    checkedAt: new Date().toISOString(),
    minSourceRows: MIN_SOURCE_ROWS,
    minHistoryRows: MIN_HISTORY_ROWS,
    checks,
    warnings,
    details,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "strategy4-standard-gate.json"), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "strategy4-standard-gate.md"), [
    "# Strategy4 Standard Gate",
    "",
    `ok: ${ok}`,
    `checkedAt: ${payload.checkedAt}`,
    "",
    ...checks.map((check) => `- ${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.message}`),
    "",
  ].join("\n"));
  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (!ok) process.exit(1);
    return;
  }
  console.log(`[strategy4-standard-gate] wrote ${path.join(OUT_DIR, "strategy4-standard-gate.md")}`);
  if (!ok) {
    console.error("[strategy4-standard-gate] issues found");
    checks.filter((check) => !check.ok).forEach((check) => console.error(`- ${check.id}: ${check.message}`));
    process.exit(1);
  }
  console.log("[strategy4-standard-gate] ok");
}

main().catch((error) => {
  console.error(`[strategy4-standard-gate] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
