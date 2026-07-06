"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || readSecret("terminal-supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("terminal-supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt")
  || readSecret("terminal-supabase-key.txt");

const MIN_RESULT_ROWS = Number(process.env.WARRANT_BATTLE_MIN_RESULT_ROWS || 1);
const REQUIRED_SCHEMA_VERSION = process.env.WARRANT_BATTLE_REQUIRED_SCHEMA_VERSION || "warrant-flow-run-id-complete-v1";

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
    path.join(process.cwd(), "secrets", name),
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {}
  }
  return "";
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function buildPath(table, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${table}?${query}` : table;
}

async function rest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        ...(options.count ? { Prefer: "count=exact" } : {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) fail(`${pathname} HTTP ${response.status}`, { body: text.slice(0, 500) });
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

async function safeRest(pathname, options = {}) {
  try {
    return { ok: true, ...(await rest(pathname, options)) };
  } catch (error) {
    return { ok: false, rows: [], exactCount: 0, error: error?.message || String(error), details: error?.details || {} };
  }
}

async function captureApi(handlerPath, apiPath, query = {}) {
  const handler = require(handlerPath);
  const queryText = new URLSearchParams(query).toString();
  let body = null;
  const request = {
    method: "GET",
    query,
    url: `${apiPath}${queryText ? `?${queryText}` : ""}`,
    headers: {},
  };
  const response = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = Number(code) || 200; return this; },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value); },
    json(payload) { body = payload; return payload; },
    send(payload) { body = payload; return payload; },
    end(payload) { body = payload; return payload; },
  };
  await Promise.resolve(handler(request, response));
  return { statusCode: response.statusCode, headers: response.headers, body };
}

function deepValue(row, key) {
  const parts = String(key || "").split(".").filter(Boolean);
  const roots = String(key || "").startsWith("payload.") ? [row] : [row, row?.payload];
  for (const root of roots) {
    let cursor = root;
    for (const part of parts) {
      if (cursor == null) break;
      cursor = cursor[part];
    }
    if (cursor !== undefined && cursor !== null && String(cursor).trim() !== "") return cursor;
  }
  return undefined;
}

function keyStats(rows = [], groups = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const stats = {};
  for (const [name, keys] of Object.entries(groups)) {
    stats[name] = list.filter((row) => keys.some((key) => {
      const value = deepValue(row, key);
      return value !== undefined && value !== null && String(value).trim() !== "";
    })).length;
  }
  return stats;
}

function pushIssue(list, condition, id, details = {}) {
  if (!condition) list.push({ id, ...details });
}

function schemaVersionAtLeast(actual, required) {
  const actualText = String(actual || "").trim();
  const requiredText = String(required || "").trim();
  if (!actualText || !requiredText) return false;
  if (actualText === requiredText) return true;
  const actualBase = actualText.replace(/-v\d+$/i, "");
  const requiredBase = requiredText.replace(/-v\d+$/i, "");
  const actualVersion = Number(actualText.match(/-v(\d+)$/i)?.[1] || 0);
  const requiredVersion = Number(requiredText.match(/-v(\d+)$/i)?.[1] || 0);
  return actualBase === requiredBase && actualVersion >= requiredVersion;
}

function summarizeRun(row = {}) {
  return {
    runId: row.run_id || "",
    scanDate: row.scan_date || "",
    status: row.status || "",
    complete: row.complete,
    expectedTotal: row.expected_total,
    scannedCount: row.scanned_count,
    resultCount: row.result_count,
    qualityStatus: row.quality_status || "",
    schemaVersion: row.schema_version || "",
    dataContractSource: row.data_contract_source || "",
    updatedAt: row.updated_at || row.finished_at || row.generated_at || "",
    payload: row.payload || null,
  };
}

function payloadCount(payload = {}, field = "rows") {
  if (field === "matches") return Array.isArray(payload.matches) ? payload.matches.length : cleanNumber(payload.returnedCount || payload.count);
  if (field === "volumeMatches") return Array.isArray(payload.volumeMatches) ? payload.volumeMatches.length : cleanNumber(payload.volumeCount);
  if (field === "singleSignals") return Array.isArray(payload.singleSignals) ? payload.singleSignals.length : cleanNumber(payload.singleSignalCount);
  return Array.isArray(payload.rows) ? payload.rows.length : cleanNumber(payload.returnedCount || payload.count);
}

async function fetchScannerHealth() {
  const result = await rest(buildPath("v_scanner_resource_health", {
    select: "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at",
    limit: 50,
  }));
  return result.rows.find((row) => String(row.strategy || "").toLowerCase() === "warrant") || {};
}

async function fetchLatestRunAndResults() {
  const runResult = await safeRest(buildPath("v_warrant_flow_latest_complete_run", {
    select: "*",
    strategy: "eq.warrant_flow",
    status: "eq.complete",
    complete: "eq.true",
    result_count: "gt.0",
    order: "finished_at.desc",
    limit: 1,
  }), { timeoutMs: 15000 });
  const run = runResult.rows?.[0] || {};
  const rowsResult = run.run_id
    ? await safeRest(buildPath("warrant_flow_scan_results", {
      select: "run_id,scan_date,result_type,code,name,underlying_code,underlying_name,close,change_percent,trade_value,score,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      strategy: "eq.warrant_flow",
      run_id: `eq.${run.run_id}`,
      order: "result_type.asc,rank.asc",
      limit: 3000,
    }), { count: true, timeoutMs: 20000 })
    : { ok: false, rows: [], exactCount: 0, error: "missing run id" };
  return { runResult, run, rowsResult, runInfo: summarizeRun(run) };
}

function resultTypeCounts(rows = []) {
  return rows.reduce((acc, row) => {
    const type = String(row.result_type || "match");
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const issues = [];
  const warnings = [];
  const details = {};

  const [strictApi, compactApi] = await Promise.all([
    captureApi("../api/warrant-flow-latest", "/api/warrant-flow-latest", { verify: "1" }),
    captureApi("../api/warrant-flow-latest", "/api/warrant-flow-latest", {
      canvas: "1",
      shell: "1",
      live: "1",
      limit: "120",
      verify: "1",
    }),
  ]);

  details.api = {
    strict: {
      statusCode: strictApi.statusCode,
      ok: strictApi.body?.ok,
      runId: strictApi.body?.runId || strictApi.body?.transport?.runId || "",
      schemaVersion: strictApi.body?.schemaVersion || "",
      dataContractOk: strictApi.body?.dataContract?.ok,
      dataContractIssues: strictApi.body?.dataContract?.issues || [],
      count: cleanNumber(strictApi.body?.count),
      returnedCount: payloadCount(strictApi.body || {}, "matches"),
      volumeCount: cleanNumber(strictApi.body?.volumeCount),
      volumeReturnedCount: payloadCount(strictApi.body || {}, "volumeMatches"),
      singleSignalCount: cleanNumber(strictApi.body?.singleSignalCount),
      singleSignalReturnedCount: payloadCount(strictApi.body || {}, "singleSignals"),
      sourceDate: strictApi.body?.sourceDate || "",
      usedDate: strictApi.body?.usedDate || "",
      cacheSource: strictApi.body?.cacheSource || strictApi.body?.source || "",
      marketSession: strictApi.body?.marketSession || null,
      transport: strictApi.body?.transport || null,
      error: strictApi.body?.error || strictApi.body?.detail || "",
    },
    compact: {
      statusCode: compactApi.statusCode,
      ok: compactApi.body?.ok,
      runId: compactApi.body?.runId || compactApi.body?.transport?.runId || "",
      count: cleanNumber(compactApi.body?.count),
      returnedCount: payloadCount(compactApi.body || {}, "matches"),
      volumeCount: cleanNumber(compactApi.body?.volumeCount),
      volumeReturnedCount: payloadCount(compactApi.body || {}, "volumeMatches"),
      singleSignalCount: cleanNumber(compactApi.body?.singleSignalCount),
      singleSignalReturnedCount: payloadCount(compactApi.body || {}, "singleSignals"),
      dataContract: compactApi.body?.dataContract || null,
      marketSession: compactApi.body?.marketSession || null,
      error: compactApi.body?.error || compactApi.body?.detail || "",
    },
  };
  pushIssue(issues, strictApi.statusCode >= 200 && strictApi.statusCode < 300 && strictApi.body?.ok === true, "warrant_strict_api_not_ok", details.api.strict);
  pushIssue(issues, compactApi.statusCode >= 200 && compactApi.statusCode < 300 && compactApi.body?.ok === true, "warrant_compact_api_not_ok", details.api.compact);
  pushIssue(issues, Boolean(details.api.strict.runId), "warrant_strict_api_missing_run_id");
  pushIssue(issues, Boolean(details.api.compact.runId), "warrant_compact_api_missing_run_id");
  pushIssue(issues, schemaVersionAtLeast(details.api.strict.schemaVersion, REQUIRED_SCHEMA_VERSION), "warrant_schema_version_below_required", {
    schemaVersion: details.api.strict.schemaVersion,
    required: REQUIRED_SCHEMA_VERSION,
  });
  pushIssue(issues, details.api.strict.dataContractOk === true, "warrant_strict_api_data_contract_not_ok", details.api.strict);
  pushIssue(issues, details.api.strict.count >= MIN_RESULT_ROWS, "warrant_api_match_count_below_min", { count: details.api.strict.count, min: MIN_RESULT_ROWS });
  pushIssue(issues, details.api.strict.volumeCount >= MIN_RESULT_ROWS, "warrant_api_volume_count_below_min", { volumeCount: details.api.strict.volumeCount, min: MIN_RESULT_ROWS });

  const [scannerHealth, completeRunHealth, latestRun] = await Promise.all([
    fetchScannerHealth().catch((error) => ({ __error: error?.message || String(error) })),
    safeRest(buildPath("v_warrant_latest_complete_run_health", { select: "*", limit: 1 }), { timeoutMs: 15000 }),
    fetchLatestRunAndResults(),
  ]);

  const scannerStatus = String(scannerHealth.status || "").toLowerCase();
  details.scannerResourceHealth = scannerHealth;
  pushIssue(issues, !scannerHealth.__error && Boolean(scannerHealth.strategy), "scanner_resource_health_missing", { error: scannerHealth.__error || "" });
  pushIssue(issues, ["ready", "stale", "not_ready", "failed"].includes(scannerStatus), "scanner_resource_health_bad_status", { status: scannerHealth.status || "" });
  pushIssue(issues, scannerStatus === "ready", "scanner_resource_health_not_ready", { status: scannerHealth.status || "", reason: scannerHealth.reason || "" });

  const healthRow = completeRunHealth.rows?.[0] || {};
  const completeHealthStatus = String(healthRow.source_status || healthRow.status || "").toLowerCase();
  details.completeRunHealth = {
    readable: completeRunHealth.ok,
    error: completeRunHealth.error || "",
    row: healthRow,
  };
  pushIssue(issues, completeRunHealth.ok, "warrant_complete_run_health_unreadable", { error: completeRunHealth.error || "" });
  pushIssue(issues, Boolean(healthRow.run_id), "warrant_complete_run_health_missing_run_id", healthRow);
  const staleButReadableCompleteRun = completeHealthStatus === "stale"
    && scannerStatus === "ready"
    && Boolean(healthRow.run_id)
    && cleanNumber(healthRow.row_count) >= MIN_RESULT_ROWS;
  if (staleButReadableCompleteRun) {
    warnings.push({
      id: "warrant_complete_run_health_stale_preserve_latest",
      ...healthRow,
      decision: "preserve latest complete run; do not publish incomplete warrant data",
    });
  } else {
    pushIssue(issues, completeHealthStatus === "ready", "warrant_complete_run_health_not_ready", healthRow);
  }
  pushIssue(issues, cleanNumber(healthRow.row_count) >= MIN_RESULT_ROWS, "warrant_complete_run_health_row_count_below_min", {
    rowCount: healthRow.row_count,
    min: MIN_RESULT_ROWS,
  });

  const run = latestRun.runInfo;
  const resultRows = cleanNumber(latestRun.rowsResult.exactCount);
  const fetchedRows = latestRun.rowsResult.rows?.length || 0;
  const typeCounts = resultTypeCounts(latestRun.rowsResult.rows || []);
  const stats = keyStats(latestRun.rowsResult.rows, {
    resultType: ["result_type"],
    code: ["code", "underlying_code", "payload.code", "payload.underlyingCode", "payload.warrantCode"],
    name: ["name", "underlying_name", "payload.name", "payload.underlyingName", "payload.warrantName"],
    score: ["score", "payload.score", "payload.finalScore", "payload.warrantHeatScore", "payload.volumeMultiple"],
    reason: ["reason", "payload.reason", "payload.tags", "payload.selectedEntryModel", "payload.entryLabel"],
  });
  details.completeRun = {
    run,
    runReadable: latestRun.runResult.ok,
    runReadError: latestRun.runResult.error || "",
    resultReadable: latestRun.rowsResult.ok,
    resultReadError: latestRun.rowsResult.error || "",
    resultRows,
    fetchedRows,
    resultTypeCounts: typeCounts,
    terminalKeyStats: stats,
  };

  pushIssue(issues, latestRun.runResult.ok, "warrant_latest_run_unreadable", { error: latestRun.runResult.error || "" });
  pushIssue(issues, Boolean(run.runId), "warrant_latest_run_missing");
  pushIssue(issues, String(run.status || "").toLowerCase() === "complete", "warrant_latest_run_bad_status", { status: run.status || "" });
  pushIssue(issues, run.complete === true, "warrant_latest_run_not_complete", { complete: run.complete });
  pushIssue(issues, cleanNumber(run.expectedTotal) > 0, "warrant_expected_total_empty", { expectedTotal: run.expectedTotal });
  pushIssue(issues, cleanNumber(run.expectedTotal) === cleanNumber(run.scannedCount), "warrant_scan_count_mismatch", {
    expectedTotal: run.expectedTotal,
    scannedCount: run.scannedCount,
  });
  pushIssue(issues, cleanNumber(run.resultCount) >= MIN_RESULT_ROWS, "warrant_result_count_below_min", {
    resultCount: run.resultCount,
    min: MIN_RESULT_ROWS,
  });
  pushIssue(issues, schemaVersionAtLeast(run.schemaVersion, REQUIRED_SCHEMA_VERSION), "warrant_run_schema_version_below_required", {
    schemaVersion: run.schemaVersion,
    required: REQUIRED_SCHEMA_VERSION,
  });
  pushIssue(issues, latestRun.rowsResult.ok, "warrant_result_rows_unreadable", { error: latestRun.rowsResult.error || "" });
  pushIssue(issues, resultRows === cleanNumber(run.resultCount), "warrant_result_readback_count_mismatch", {
    resultRows,
    runResultCount: run.resultCount,
  });
  pushIssue(issues, cleanNumber(typeCounts.match) >= MIN_RESULT_ROWS, "warrant_match_rows_empty", typeCounts);
  pushIssue(issues, cleanNumber(typeCounts.volume) >= MIN_RESULT_ROWS, "warrant_volume_rows_empty", typeCounts);
  pushIssue(issues, stats.resultType === fetchedRows, "warrant_result_type_key_missing", stats);
  pushIssue(issues, stats.code === fetchedRows, "warrant_code_key_missing", stats);
  pushIssue(issues, stats.name === fetchedRows, "warrant_name_key_missing", stats);
  pushIssue(issues, stats.score === fetchedRows, "warrant_score_key_missing", stats);
  if (details.api.strict.runId && run.runId && details.api.strict.runId !== run.runId) {
    warnings.push({ id: "warrant_api_run_id_differs_from_latest_view", apiRunId: details.api.strict.runId, latestRunId: run.runId });
  }
  if (details.api.strict.runId && details.api.compact.runId && details.api.strict.runId !== details.api.compact.runId) {
    warnings.push({ id: "warrant_strict_compact_api_run_id_differs", strictRunId: details.api.strict.runId, compactRunId: details.api.compact.runId });
  }

  const output = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    strategy: "Warrant / 權證",
    contract: "warrant-flow-api-complete-run-verify-v1",
    issues,
    warnings,
    details,
    gate: {
      dataExists: resultRows >= MIN_RESULT_ROWS && cleanNumber(typeCounts.match) >= MIN_RESULT_ROWS,
      healthViewCorrect: scannerStatus === "ready" && completeHealthStatus === "ready",
      terminalKeysVisible: ["resultType", "code", "name", "score"].every((key) => stats[key] === fetchedRows),
      scannerBehavior: issues.length === 0
        ? "allow warrant publish; API contract and complete-run readback match"
        : "preserve latest complete run; show warrant health reason; do not publish incomplete warrant data",
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    strategy: "Warrant / 權證",
    contract: "warrant-flow-api-complete-run-verify-v1",
    error: error?.message || String(error),
    details: error?.details || {},
  }, null, 2)}\n`);
  process.exit(1);
});
