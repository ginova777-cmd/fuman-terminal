"use strict";

const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { spawnSync } = require("child_process");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const BASE = (process.env.FUMAN_STRATEGY4_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const EXPECTED_TASK = "Fuman Strategy4 Cache 1600";
const EXPECTED_RUNNER = "run-strategy4.ps1";
const MIN_SOURCE_ROWS = Number(process.env.STRATEGY4_AUTONOMY_MIN_SOURCE_ROWS || 1500);
const MIN_MATCH_COUNT = Number(process.env.STRATEGY4_AUTONOMY_MIN_MATCH_COUNT || 10);

const issues = [];
const warnings = [];
const add = (ok, id, detail = {}) => { if (!ok) issues.push({ id, ...detail }); };
const warn = (id, detail = {}) => warnings.push({ id, ...detail });
const n = (value) => {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchDetail(error, context = {}) {
  const cause = error?.cause || {};
  return {
    phase: context.phase || "",
    url: context.url || "",
    method: context.method || "GET",
    message: error?.message || String(error),
    name: error?.name || "",
    causeMessage: cause?.message || "",
    causeCode: cause?.code || "",
    causeErrno: cause?.errno || "",
    causeSyscall: cause?.syscall || "",
    causeHostname: cause?.hostname || "",
  };
}

async function fetchWithRetry(url, options = {}, context = {}) {
  const attempts = Math.max(1, Number(context.attempts || process.env.STRATEGY4_AUTONOMY_FETCH_ATTEMPTS || 3) || 3);
  const timeoutMs = Math.max(1000, Number(context.timeoutMs || 45000) || 45000);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(Math.min(5000, 500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  const detail = fetchDetail(lastError, { ...context, url, method: options.method || "GET" });
  const wrapped = new Error(`${detail.phase || "fetch"} failed ${detail.url}: ${detail.message}${detail.causeCode ? ` cause=${detail.causeCode}` : ""}`);
  wrapped.fetchDetail = detail;
  throw wrapped;
}

async function fetchJson(url, context = {}) {
  const response = await fetchWithRetry(url, {
    headers: { Accept: "application/json", ...(context.headers || {}) },
  }, context);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text || "null"); } catch { body = { raw: text.slice(0, 240) }; }
  return { status: response.status, ok: response.ok, body, headers: Object.fromEntries(response.headers.entries()) };
}

async function supabase(pathname, context = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
  const response = await fetchWithRetry(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      Prefer: "count=exact",
    },
  }, { phase: context.phase || `supabase:${String(pathname).split("?")[0]}`, attempts: context.attempts, timeoutMs: context.timeoutMs });
  const text = await response.text();
  const range = response.headers.get("content-range") || "";
  return {
    ok: response.ok,
    status: response.status,
    rows: response.ok && text ? JSON.parse(text) : [],
    exactCount: range.includes("/") ? n(range.split("/").pop()) : null,
    error: response.ok ? "" : text.slice(0, 300),
  };
}

function q(table, params) {
  return `${table}?${new URLSearchParams(params)}`;
}

function psq(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(command) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `PowerShell exit ${result.status}`).trim());
  return result.stdout;
}

function queryTask(name) {
  const command = `$n=${psq(name)};` +
    "$t=Get-ScheduledTask -TaskName $n -ErrorAction Stop;" +
    "$i=Get-ScheduledTaskInfo -TaskName $n -ErrorAction Stop;" +
    "[pscustomobject]@{" +
    "TaskName=[string]$t.TaskName;" +
    "State=[string]$t.State;" +
    "Actions=($t.Actions|%{[string]$_.Execute+' '+[string]$_.Arguments}) -join ' | ';" +
    "Triggers=($t.Triggers|%{[string]$_.StartBoundary}) -join ' | ';" +
    "LastResult=[int]$i.LastTaskResult;" +
    "LastRunTime=[string]$i.LastRunTime;" +
    "NextRunTime=[string]$i.NextRunTime" +
    "}|ConvertTo-Json -Compress";
  return JSON.parse(runPowerShell(command));
}

function queryStrategy4Tasks() {
  const command = [
    "Get-ScheduledTask | ? { $_.TaskName -like '*Strategy4*' } | % {",
    "$i=Get-ScheduledTaskInfo -TaskName $_.TaskName -ErrorAction SilentlyContinue;",
    "[pscustomobject]@{TaskName=$_.TaskName;State=[string]$_.State;Actions=($_.Actions|%{[string]$_.Execute+' '+[string]$_.Arguments}) -join ' | ';Triggers=($_.Triggers|%{[string]$_.StartBoundary}) -join ' | ';LastResult=[int]$i.LastTaskResult;NextRunTime=[string]$i.NextRunTime}",
    "} | ConvertTo-Json -Compress",
  ].join("");
  const text = runPowerShell(command).trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function captureLocalApi(query) {
  try {
    const handler = require("../api/strategy4-latest");
    let body = null;
    const req = { method: "GET", query, url: `/api/strategy4-latest?${new URLSearchParams(query)}`, headers: { host: "localhost" } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      setHeader() {},
      json(payload) { body = payload; return payload; },
      send(payload) { body = payload; return payload; },
      end(payload) { body = payload; return payload; },
    };
    await Promise.resolve(handler(req, res));
    return { status: res.statusCode, body: body || {} };
  } catch (error) {
    return {
      status: 0,
      body: {
        ok: false,
        error: error.message || String(error),
        fetchDetail: error.fetchDetail || fetchDetail(error, { phase: "local-handler:/api/strategy4-latest", url: "/api/strategy4-latest" }),
      },
    };
  }
}

function apiSummary(result) {
  const body = result.body || {};
  return {
    status: result.status,
    ok: body.ok === true,
    complete: body.complete,
    runId: body.runId || body.transport?.runId || "",
    count: n(body.count),
    total: n(body.total),
    updatedAt: body.updatedAt || body.generatedAt || "",
    scanStamp: body.scanStamp || "",
    source: body.source || "",
    cacheSource: body.cacheSource || "",
    qualityStatus: body.qualityStatus || "",
    schemaVersion: body.schemaVersion || "",
    volumeUnit: body.volumeUnit || "",
    dataContractSource: body.dataContractSource || "",
    error: body.error || body.detail || body.reason || "",
    fetchDetail: body.fetchDetail || null,
    transport: body.transport || {},
  };
}

function localFiles(dir, prefix) {
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.toLowerCase().startsWith(prefix) && name.toLowerCase().endsWith(".json"))
      .map((name) => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return { file, bytes: stat.size, mtime: stat.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");

  const schedule = { expectedTask: EXPECTED_TASK, expectedTime: "16:00", expectedRunner: EXPECTED_RUNNER };
  try {
    schedule.primary = queryTask(EXPECTED_TASK);
    schedule.strategy4Tasks = queryStrategy4Tasks();
  } catch (error) {
    schedule.error = error.message || String(error);
  }
  const primary = schedule.primary || {};
  add(primary.State === "Ready" || primary.State === "Running", "schedule_primary_not_ready", primary);
  add(n(primary.LastResult) === 0, "schedule_last_result_not_zero", primary);
  add(String(primary.Actions || "").includes(EXPECTED_RUNNER), "schedule_runner_mismatch", primary);
  add(String(primary.Actions || "").includes("C:\\fuman-terminal\\run-strategy4.ps1"), "schedule_runner_not_production_path", primary);
  add(String(primary.Triggers || primary.NextRunTime || "").includes("16:00") || String(primary.NextRunTime || "").includes("下午 04:00"), "schedule_time_mismatch", primary);
  const activeDuplicates = (schedule.strategy4Tasks || []).filter((task) => task.TaskName !== EXPECTED_TASK && ["Ready", "Running"].includes(String(task.State || "")));
  add(activeDuplicates.length === 0, "active_duplicate_strategy4_task", { activeDuplicates });

  const runs = await supabase(q("strategy4_scan_runs", {
    select: "run_id,scan_date,finished_at,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,quality_status,schema_version,volume_unit,data_contract_source,source,generated_at,updated_at,payload",
    strategy: "eq.strategy4",
    status: "eq.complete",
    complete: "eq.true",
    order: "finished_at.desc",
    limit: "1",
  }), { phase: "supabase:latest-complete-run" });
  const run = runs.rows[0] || {};
  const runId = String(run.run_id || "");
  add(runs.ok && Boolean(runId), "formal_complete_run_missing", { status: runs.status, error: runs.error });
  add(run.status === "complete" && run.complete === true, "formal_run_not_complete", run);
  add(n(run.expected_total) >= MIN_SOURCE_ROWS, "formal_expected_total_low", run);
  add(n(run.scanned_count) === n(run.expected_total), "formal_scan_not_100_percent", run);
  add(n(run.result_count) >= MIN_MATCH_COUNT, "formal_result_count_low", run);
  add(n(run.no_data_count) === 0, "formal_no_data_nonzero", run);
  add(n(run.error_count) === 0, "formal_error_count_nonzero", run);
  add(String(run.quality_status || "") === "complete", "formal_quality_not_complete", run);
  add(String(run.schema_version || "") === "strategy4-cache-v3-unit-contract", "formal_schema_mismatch", run);
  add(String(run.volume_unit || "") === "lots", "formal_volume_unit_mismatch", run);

  const results = runId ? await supabase(q("strategy4_scan_results", {
    select: "run_id,scan_date,code,name,rank,score,complete,quality_status,schema_version,volume_unit,data_contract_source,price_source,payload,updated_at",
    strategy: "eq.strategy4",
    run_id: `eq.${runId}`,
    limit: String(Math.max(n(run.result_count) + 5, 25)),
  }), { phase: "supabase:latest-run-results" }) : { ok: false, rows: [], exactCount: 0, error: "missing_run_id" };
  const resultCount = results.exactCount ?? results.rows.length;
  add(results.ok, "formal_results_unreadable", { status: results.status, error: results.error });
  add(resultCount === n(run.result_count), "formal_result_count_mismatch", { resultCount, runResultCount: run.result_count });
  add(results.rows.every((row) => row.complete === true), "formal_result_not_complete", { bad: results.rows.filter((row) => row.complete !== true).slice(0, 5) });
  add(results.rows.every((row) => String(row.quality_status || "") === "complete"), "formal_result_quality_not_complete", { bad: results.rows.filter((row) => String(row.quality_status || "") !== "complete").slice(0, 5) });

  const stockDaily = await supabase(q("stock_daily_volume", { select: "trade_date", order: "trade_date.desc", limit: "1" }), { phase: "supabase:stock-daily-latest-date" });
  const sourceLatestDate = stockDaily.rows[0]?.trade_date || "";
  add(stockDaily.ok && Boolean(sourceLatestDate), "source_latest_date_missing", { status: stockDaily.status, error: stockDaily.error });
  add(!sourceLatestDate || String(run.scan_date || "") >= String(sourceLatestDate), "formal_run_older_than_source", { scanDate: run.scan_date, sourceLatestDate });

  const health = await supabase(q("v_scanner_resource_health", {
    select: "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at",
    strategy: "eq.Strategy4",
    limit: "1",
  }), { phase: "supabase:scanner-resource-health" });
  const healthRow = health.rows[0] || {};
  add(health.ok && Boolean(healthRow.strategy), "resource_health_missing", { status: health.status, error: health.error });
  add(String(healthRow.status || "").toLowerCase() === "ready", "resource_health_not_ready", healthRow);
  add(String(healthRow.required_source || "") === "stock_daily_volume", "resource_health_source_mismatch", healthRow);
  add(n(healthRow.row_count) >= MIN_SOURCE_ROWS, "resource_health_row_count_low", healthRow);

  const query = { canvas: "1", compact: "1", shell: "1", limit: "70", live: "1" };
  const liveUrl = `${BASE}/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1&fresh=${Date.now()}`;
  const snapshotUrl = `${BASE}/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&fresh=${Date.now()}`;
  const [localLive, prodLiveRaw, prodSnapshotRaw] = await Promise.all([
    captureLocalApi(query),
    fetchJson(liveUrl, { phase: "production-live:/api/strategy4-latest" }).catch((error) => ({ status: 0, body: { error: error.message, fetchDetail: error.fetchDetail || fetchDetail(error, { phase: "production-live:/api/strategy4-latest", url: liveUrl }) } })),
    fetchJson(snapshotUrl, { phase: "production-snapshot:/api/strategy4-latest" }).catch((error) => ({ status: 0, body: { error: error.message, fetchDetail: error.fetchDetail || fetchDetail(error, { phase: "production-snapshot:/api/strategy4-latest", url: snapshotUrl }) } })),
  ]);
  const api = {
    localLive: apiSummary(localLive),
    productionLive: apiSummary({ status: prodLiveRaw.status, body: prodLiveRaw.body }),
    productionSnapshot: apiSummary({ status: prodSnapshotRaw.status, body: prodSnapshotRaw.body }),
  };
  for (const [label, item] of Object.entries({ local_live: api.localLive, production_live: api.productionLive })) {
    add(item.status >= 200 && item.status < 300 && item.ok, `${label}_api_not_ok`, item);
    add(item.runId === runId, `${label}_api_run_id_mismatch`, { apiRunId: item.runId, runId });
    add(item.count > 0, `${label}_api_empty`, item);
    add(item.qualityStatus === "complete", `${label}_api_quality_not_complete`, item);
    add(item.cacheSource === "supabase-api", `${label}_api_not_direct_supabase`, item);
    add(item.transport?.gate === "run_id", `${label}_api_not_run_id_gate`, item.transport);
  }
  if (api.productionSnapshot.ok) {
    add(api.productionSnapshot.runId === runId, "snapshot_run_id_mismatch", { snapshotRunId: api.productionSnapshot.runId, runId });
    add(api.productionSnapshot.count === api.productionLive.count, "snapshot_count_mismatch", { snapshotCount: api.productionSnapshot.count, liveCount: api.productionLive.count });
    add(["supabase-api", "supabase:desktop_route_snapshot"].includes(api.productionSnapshot.cacheSource), "snapshot_unexpected_source", api.productionSnapshot);
  } else {
    warn("production_snapshot_unavailable", api.productionSnapshot);
  }

  const runner = read("run-strategy4.ps1");
  const sw = read("fuman-sw.js");
  const app = read("terminal-app.js");
  const live = read("terminal-live-check.js");
  const runtime = read("terminal-runtime-config.js");
  const fast = read("terminal-desktop-fast-shell.js");
  const apiSource = read("api/strategy4-latest.js");
  const scan = read("scripts/scan-strategy4-cache.js");
  const cleanup = read("scripts/cleanup-api-only-retired-artifacts.js");
  const risks = {
    apiHasStaticFallback: /staticFallback|static-fallback|\/data\/strategy4-|strategy4_static|strategy4_scan_results_latest_empty/.test(apiSource),
    scannerSkipsStaticOutput: scan.includes("strategy4 API-only: skipped static data/strategy4*.json output"),
    runnerCallsSnapshotRefresh: runner.includes("refresh-desktop-route-snapshot.ps1") && runner.includes('-Source "strategy4"'),
    runnerAllowsPartialPublishEnv: runner.includes("STRATEGY4_ALLOW_PARTIAL_PUBLISH"),
    serviceWorkerBlocksStaticStrategy4: sw.includes("isStrategy4StaticDataRequest") && sw.includes("strategy4_static_disabled"),
    frontendDesktopEndpoint: runtime.includes('strategy4Cache: "/api/strategy4-latest"') || live.includes('strategy4Cache: "/api/strategy4-latest"'),
    frontendMobileEndpoint: read("api/mobile-fragment.js").includes('endpoint: "/api/strategy4-latest"') && read("api/mobile-boot.js").includes('strategy4: "/api/strategy4-latest"'),
    frontendAutoPollsRunId: app.includes("installStrategy4ApiRunPolling") && app.includes("loadStrategy4Cache?.(!0)"),
    frontendShowsStaleDegraded: fast.includes("資料異常") && fast.includes("降級運行") && fast.includes("qualityStatus"),
    cleanupMarksStaticRetired: cleanup.includes("data/strategy4-latest.json") && cleanup.includes("data/strategy4-slim.json"),
    repoStaticJson: localFiles(path.join(ROOT, "data"), "strategy4"),
    runtimeStaticJson: localFiles(path.join(RUNTIME_DIR, "data"), "strategy4"),
  };
  add(!risks.apiHasStaticFallback, "api_static_fallback_still_present");
  add(risks.scannerSkipsStaticOutput, "scanner_may_write_static_strategy4_json");
  add(risks.runnerCallsSnapshotRefresh, "runner_does_not_refresh_desktop_snapshot");
  add(!risks.runnerAllowsPartialPublishEnv, "runner_sets_STRATEGY4_ALLOW_PARTIAL_PUBLISH");
  add(risks.serviceWorkerBlocksStaticStrategy4, "service_worker_does_not_block_strategy4_static_json");
  add(risks.frontendDesktopEndpoint, "frontend_desktop_not_formal_api");
  add(risks.frontendMobileEndpoint, "frontend_mobile_not_formal_api");
  add(risks.frontendAutoPollsRunId, "frontend_missing_auto_run_poll");
  add(risks.frontendShowsStaleDegraded, "frontend_missing_stale_degraded_surface");
  add(risks.cleanupMarksStaticRetired, "cleanup_missing_strategy4_static_retirement");
  if (risks.runtimeStaticJson.length) warn("runtime_strategy4_static_json_present", { action: "retire/remove", files: risks.runtimeStaticJson.slice(0, 20) });
  if (risks.repoStaticJson.length) warn("repo_strategy4_static_json_present", { action: "retire/remove", files: risks.repoStaticJson.slice(0, 20) });

  const output = {
    strategy: "策略4 波段",
    unattendedStatus: issues.length ? "NO" : warnings.length ? "PARTIAL" : "YES",
    checkedAt: new Date().toISOString(),
    formalSource: "Supabase strategy4_scan_runs + strategy4_scan_results via /api/strategy4-latest live run_id gate",
    soleWriter: "run-strategy4.ps1 -> scripts/scan-strategy4-cache.js -> Supabase; desktop_route_snapshot is read snapshot only",
    schedule,
    formalApi: api,
    frontendEntry: {
      desktop: "/api/strategy4-latest",
      mobile: "/api/mobile-fragment?tab=strategy4 -> /api/strategy4-latest",
      autoRefresh: risks.frontendAutoPollsRunId,
    },
    freshness: {
      runId,
      marketDate: run.scan_date || "",
      sourceLatestDate,
      updatedAt: run.updated_at || run.finished_at || run.generated_at || "",
      source: run.source || "supabase:strategy4_scan_runs/results",
      contract: run.data_contract_source || "",
      qualityStatus: run.quality_status || "",
      schemaVersion: run.schema_version || "",
      volumeUnit: run.volume_unit || "",
    },
    staleDegradedDisplay: {
      apiFailureMode: "API returns non-ok error detail; no static JSON fallback",
      frontendSurface: risks.frontendShowsStaleDegraded ? "desktop fast shell has stale/degraded banner driven by qualityStatus/error/sourceHealth" : "missing",
    },
    legacyRisk: {
      oldTasks: activeDuplicates.length ? activeDuplicates : "no active duplicate Strategy4 task found",
      oldCache: risks.runtimeStaticJson.length ? "runtime strategy4*.json present" : "no runtime strategy4*.json found",
      oldStaticJson: risks.repoStaticJson.length ? "repo data/strategy4*.json present" : "no repo data/strategy4*.json found",
      oldFallback: risks.apiHasStaticFallback ? "API static fallback still present" : "API static fallback not detected",
      oldContract: risks,
    },
    readOnlyVerifyCommand: "npm run verify:strategy4-autonomy",
    blockers: issues,
    warnings,
    evidence: {
      latestCompleteRun: run,
      resultRows: resultCount,
      resourceHealth: healthRow,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    strategy: "策略4 波段",
    unattendedStatus: "NO",
    error: error.stack || error.message || String(error),
    fetchDetail: error.fetchDetail || null,
  }, null, 2)}\n`);
  process.exit(1);
});
