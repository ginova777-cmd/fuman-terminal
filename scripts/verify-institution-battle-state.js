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

const MIN_SOURCE_ROWS = Number(process.env.INSTITUTION_BATTLE_MIN_SOURCE_ROWS || 1500);
const MIN_RESULT_ROWS = Number(process.env.INSTITUTION_BATTLE_MIN_RESULT_ROWS || 1);
const MAX_EFFECTIVE_TRADE_AGE_DAYS = Number(process.env.INSTITUTION_BATTLE_MAX_EFFECTIVE_TRADE_AGE_DAYS || 3);
const API_LIMIT = Number(process.env.INSTITUTION_BATTLE_API_LIMIT || 60);

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

function taipeiDate(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return taipeiDate(text);
}

function dateAgeDays(dateValue, todayValue = new Date()) {
  const date = normalizeDate(dateValue);
  const today = normalizeDate(todayValue);
  if (!date || !today) return null;
  const toUtc = (value) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.floor((toUtc(today) - toUtc(date)) / 86400000);
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

function payloadReturnedCount(payload = {}) {
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (payload.data && typeof payload.data === "object") return Object.keys(payload.data).length;
  return cleanNumber(payload.returnedCount || payload.count);
}

function pushIssue(list, condition, id, details = {}) {
  if (!condition) list.push({ id, ...details });
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
    dataContractSource: row.data_contract_source || "",
    updatedAt: row.updated_at || row.finished_at || row.generated_at || "",
    sourceHealth: row.payload?.sourceHealth || null,
  };
}

async function fetchScannerHealth() {
  const result = await rest(buildPath("v_scanner_resource_health", {
    select: "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at",
    strategy: "eq.Strategy5 / institution",
    limit: 1,
  }));
  return result.rows.find((row) => String(row.strategy || "").toLowerCase() === "strategy5 / institution") || {};
}

async function fetchLatestRunAndResults() {
  const runResult = await safeRest(buildPath("v_institution_latest_complete_run", {
    select: "*",
    strategy: "eq.institution",
    status: "eq.complete",
    complete: "eq.true",
    limit: 1,
  }), { timeoutMs: 15000 });
  const run = runResult.rows?.[0] || {};
  const rowsResult = run.run_id
    ? await safeRest(buildPath("institution_scan_results", {
      select: "run_id,scan_date,code,name,close,change_percent,trade_volume,trade_value,foreign_net,trust_net,dealer_net,total_net,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      strategy: "eq.institution",
      run_id: `eq.${run.run_id}`,
      order: "rank.asc",
      limit: 3000,
    }), { count: true, timeoutMs: 20000 })
    : { ok: false, rows: [], exactCount: 0, error: "missing run id" };
  return { runResult, run, rowsResult, runInfo: summarizeRun(run) };
}

function summarizeSourceHealth(institutionHealth = {}, chipHealthRows = [], chipLatestRows = [], chipLatestExactCount = 0) {
  const latestHealth = chipHealthRows.find((row) => String(row.source_name || "").toLowerCase() === "v_chip_flows_latest") || {};
  const latestTradeDate = normalizeDate(institutionHealth.latest_trade_date || latestHealth.max_trade_date || chipLatestRows[0]?.trade_date || "");
  const latestRows = cleanNumber(chipLatestExactCount) || cleanNumber(latestHealth.rows_on_max_date);
  return {
    latestTradeDate,
    latestAgeDays: dateAgeDays(latestTradeDate),
    coverageStatus: String(institutionHealth.coverage_status || "").toLowerCase(),
    institutionalRows: cleanNumber(institutionHealth.institutional_rows),
    marginRows: cleanNumber(institutionHealth.margin_rows),
    unifiedRows: cleanNumber(institutionHealth.unified_rows),
    validAfterExclusionRows: cleanNumber(institutionHealth.valid_after_exclusion_rows),
    minRequiredRows: cleanNumber(institutionHealth.min_required_rows || MIN_SOURCE_ROWS),
    reason: institutionHealth.reason || "",
    chipFlowsLatestExactCount: latestRows,
    chipHealthRows: chipHealthRows.map((row) => ({
      sourceName: row.source_name || "",
      tradeDate: row.trade_date || row.checked_trade_date || "",
      maxTradeDate: row.max_trade_date || "",
      staleDays: cleanNumber(row.stale_days),
      rowsOnMaxDate: cleanNumber(row.rows_on_max_date),
      sourceStatus: row.source_status || "",
      latestUpdatedAt: row.latest_updated_at || "",
    })),
  };
}

async function main() {
  const issues = [];
  const warnings = [];
  const details = {};

  const api = await captureApi("../api/institution-latest", "/api/institution-latest", {
    canvas: "1",
    compact: "1",
    shell: "1",
    live: "1",
    limit: String(API_LIMIT),
    verify: "1",
  });
  details.api = {
    statusCode: api.statusCode,
    ok: api.body?.ok,
    runId: api.body?.runId || api.body?.transport?.runId || "",
    count: cleanNumber(api.body?.count),
    returnedCount: payloadReturnedCount(api.body || {}),
    usedDate: api.body?.usedDate || "",
    cacheSource: api.body?.cacheSource || api.body?.source || "",
    dataContractSource: api.body?.dataContractSource || "",
    requiredFields: api.body?.requiredFields || null,
    rowsChecked: cleanNumber(api.body?.rowsChecked),
    blankCounts: api.body?.blankCounts || null,
    blankRate: cleanNumber(api.body?.blankRate),
    rawKeepDays: cleanNumber(api.body?.rawKeepDays),
    writeBudget: api.body?.writeBudget || null,
    latestOverwriteAllowed: api.body?.latestOverwriteAllowed,
    degradedBlocksLatest: api.body?.degradedBlocksLatest,
    preservePreviousGood: api.body?.preservePreviousGood,
    blockedReceiptPath: api.body?.blockedReceiptPath || "",
    transport: api.body?.transport || null,
    error: api.body?.error || api.body?.detail || "",
  };
  pushIssue(issues, api.statusCode >= 200 && api.statusCode < 300 && api.body?.ok === true, "institution_api_not_ok", details.api);
  pushIssue(issues, Boolean(details.api.runId), "institution_api_missing_run_id");
  pushIssue(issues, details.api.count >= MIN_RESULT_ROWS, "institution_api_count_below_min", { count: details.api.count, min: MIN_RESULT_ROWS });
  pushIssue(issues, details.api.returnedCount >= MIN_RESULT_ROWS, "institution_api_returned_count_empty", details.api);
  pushIssue(issues, Array.isArray(details.api.requiredFields) && details.api.requiredFields.length >= 6, "institution_api_required_fields_missing", {
    requiredFields: details.api.requiredFields,
  });
  pushIssue(issues, details.api.rowsChecked === details.api.count, "institution_api_rows_checked_mismatch", {
    rowsChecked: details.api.rowsChecked,
    count: details.api.count,
  });
  pushIssue(issues, details.api.blankCounts && Object.values(details.api.blankCounts).every((value) => cleanNumber(value) === 0), "institution_api_blank_counts_nonzero_or_missing", {
    blankCounts: details.api.blankCounts,
  });
  pushIssue(issues, details.api.blankRate === 0, "institution_api_blank_rate_nonzero", {
    blankRate: details.api.blankRate,
  });
  pushIssue(issues, details.api.rawKeepDays > 0, "institution_api_raw_keep_days_missing", {
    rawKeepDays: details.api.rawKeepDays,
  });
  pushIssue(issues, details.api.writeBudget?.finalStatus === "allow", "institution_api_write_budget_final_status_missing", {
    writeBudget: details.api.writeBudget,
  });
  pushIssue(issues, details.api.latestOverwriteAllowed === true, "institution_api_latest_overwrite_not_allowed_for_ready_run", {
    latestOverwriteAllowed: details.api.latestOverwriteAllowed,
  });
  pushIssue(issues, details.api.degradedBlocksLatest === false, "institution_api_degraded_blocks_latest_bad_for_ready_run", {
    degradedBlocksLatest: details.api.degradedBlocksLatest,
  });
  pushIssue(issues, details.api.preservePreviousGood === false, "institution_api_preserve_previous_good_bad_for_ready_run", {
    preservePreviousGood: details.api.preservePreviousGood,
  });

  const [scannerHealth, institutionHealthResult, chipHealthResult, chipLatestResult, latestRun] = await Promise.all([
    fetchScannerHealth().catch((error) => ({ __error: error?.message || String(error) })),
    safeRest(buildPath("v_institution_source_health", { select: "*", limit: 1 }), { timeoutMs: 15000 }),
    safeRest(buildPath("v_chip_flows_health", { select: "*", order: "source_name.asc", limit: 20 }), { timeoutMs: 15000 }),
    safeRest(buildPath("v_chip_flows_latest", { select: "symbol,trade_date", limit: 1 }), { timeoutMs: 15000 }),
    fetchLatestRunAndResults(),
  ]);

  const healthStatus = String(scannerHealth.status || "").toLowerCase();
  details.scannerResourceHealth = scannerHealth;
  if (scannerHealth.__error || !scannerHealth.strategy) {
    warnings.push({ id: "scanner_resource_health_unavailable_warning", error: scannerHealth.__error || "" });
  } else if (!["ready", "stale", "not_ready", "failed"].includes(healthStatus)) {
    warnings.push({ id: "scanner_resource_health_bad_status_warning", status: scannerHealth.status || "" });
  } else if (healthStatus !== "ready") {
    warnings.push({ id: "scanner_resource_health_not_ready_warning", status: scannerHealth.status || "", reason: scannerHealth.reason || "" });
  }

  const institutionHealth = institutionHealthResult.rows?.[0] || {};
  const sourceSummary = summarizeSourceHealth(
    institutionHealth,
    chipHealthResult.rows || [],
    chipLatestResult.rows || [],
    chipLatestResult.exactCount
  );
  details.sourceHealth = {
    institutionSourceHealthOk: institutionHealthResult.ok,
    institutionSourceHealthError: institutionHealthResult.error || "",
    chipFlowsHealthOk: chipHealthResult.ok,
    chipFlowsHealthError: chipHealthResult.error || "",
    chipFlowsLatestOk: chipLatestResult.ok,
    chipFlowsLatestError: chipLatestResult.error || "",
    ...sourceSummary,
  };

  pushIssue(issues, institutionHealthResult.ok, "institution_source_health_unreadable", { error: institutionHealthResult.error || "" });
  pushIssue(issues, chipHealthResult.ok, "chip_flows_health_unreadable", { error: chipHealthResult.error || "" });
  pushIssue(issues, chipLatestResult.ok, "chip_flows_latest_unreadable", { error: chipLatestResult.error || "" });
  pushIssue(issues, sourceSummary.coverageStatus === "ready", "institution_coverage_not_ready", {
    coverageStatus: sourceSummary.coverageStatus,
    reason: sourceSummary.reason,
  });
  pushIssue(issues, sourceSummary.institutionalRows >= MIN_SOURCE_ROWS, "institutional_rows_below_min", {
    rows: sourceSummary.institutionalRows,
    min: MIN_SOURCE_ROWS,
  });
  if (sourceSummary.marginRows < MIN_SOURCE_ROWS) {
    warnings.push({ id: "margin_rows_below_min_warning", rows: sourceSummary.marginRows, min: MIN_SOURCE_ROWS });
  }
  pushIssue(issues, sourceSummary.validAfterExclusionRows >= sourceSummary.minRequiredRows, "valid_after_exclusion_rows_below_min", {
    rows: sourceSummary.validAfterExclusionRows,
    min: sourceSummary.minRequiredRows,
  });
  pushIssue(issues, sourceSummary.chipFlowsLatestExactCount >= MIN_SOURCE_ROWS, "chip_flows_latest_rows_below_min", {
    rows: sourceSummary.chipFlowsLatestExactCount,
    min: MIN_SOURCE_ROWS,
  });
  if (!sourceSummary.latestTradeDate) {
    issues.push({ id: "chip_latest_trade_date_missing" });
  } else if (sourceSummary.latestAgeDays != null && sourceSummary.latestAgeDays > MAX_EFFECTIVE_TRADE_AGE_DAYS) {
    issues.push({
      id: "chip_latest_trade_date_stale",
      latestTradeDate: sourceSummary.latestTradeDate,
      ageDays: sourceSummary.latestAgeDays,
      max: MAX_EFFECTIVE_TRADE_AGE_DAYS,
    });
  }
  const nonReadyChipSources = sourceSummary.chipHealthRows.filter((row) => String(row.sourceStatus || "").toLowerCase() !== "ready");
  if (nonReadyChipSources.length) {
    warnings.push({ id: "chip_flows_health_contains_non_ready_sources", rows: nonReadyChipSources });
  }

  const run = latestRun.runInfo;
  const resultRows = cleanNumber(latestRun.rowsResult.exactCount);
  const fetchedRows = latestRun.rowsResult.rows?.length || 0;
  const stats = keyStats(latestRun.rowsResult.rows, {
    code: ["code", "payload.code"],
    name: ["name", "payload.name"],
    foreign: ["foreign_net", "foreignNet", "payload.foreign", "payload.foreignNet"],
    trust: ["trust_net", "investment_trust_net", "trustNet", "payload.trust", "payload.trustNet"],
    dealer: ["dealer_net", "dealerNet", "payload.dealer", "payload.dealerNet"],
    total: ["total_net", "institution_total_net", "totalNet", "institutionTotalNet", "payload.total", "payload.totalNet"],
  });
  details.completeRun = {
    run,
    runReadable: latestRun.runResult.ok,
    runReadError: latestRun.runResult.error || "",
    resultReadable: latestRun.rowsResult.ok,
    resultReadError: latestRun.rowsResult.error || "",
    resultRows,
    fetchedRows,
    terminalKeyStats: stats,
  };

  pushIssue(issues, latestRun.runResult.ok, "institution_latest_run_unreadable", { error: latestRun.runResult.error || "" });
  pushIssue(issues, Boolean(run.runId), "institution_latest_run_missing");
  pushIssue(issues, String(run.status || "").toLowerCase() === "complete", "institution_latest_run_bad_status", { status: run.status || "" });
  pushIssue(issues, run.complete === true, "institution_latest_run_not_complete", { complete: run.complete });
  pushIssue(issues, cleanNumber(run.expectedTotal) > 0, "institution_expected_total_empty", { expectedTotal: run.expectedTotal });
  pushIssue(issues, cleanNumber(run.expectedTotal) === cleanNumber(run.scannedCount), "institution_scan_count_mismatch", {
    expectedTotal: run.expectedTotal,
    scannedCount: run.scannedCount,
  });
  pushIssue(issues, cleanNumber(run.resultCount) >= MIN_RESULT_ROWS, "institution_result_count_below_min", {
    resultCount: run.resultCount,
    min: MIN_RESULT_ROWS,
  });
  pushIssue(issues, latestRun.rowsResult.ok, "institution_result_rows_unreadable", { error: latestRun.rowsResult.error || "" });
  pushIssue(issues, resultRows === cleanNumber(run.resultCount), "institution_result_readback_count_mismatch", {
    resultRows,
    runResultCount: run.resultCount,
  });
  for (const key of ["code", "name", "foreign", "trust", "dealer", "total"]) {
    pushIssue(issues, stats[key] === fetchedRows, `institution_${key}_key_missing`, stats);
  }
  if (details.api.runId && run.runId && details.api.runId !== run.runId) {
    warnings.push({ id: "institution_api_run_id_differs_from_latest_view", apiRunId: details.api.runId, latestRunId: run.runId });
  }

  const output = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    strategy: "Institution / 買賣超",
    contract: "institution-chip-source-api-complete-run-verify-v1",
    issues,
    warnings,
    details,
    gate: {
      dataExists: sourceSummary.validAfterExclusionRows >= sourceSummary.minRequiredRows && resultRows >= MIN_RESULT_ROWS,
      healthViewCorrect: sourceSummary.coverageStatus === "ready",
      terminalKeysVisible: ["code", "name", "foreign", "trust", "dealer", "total"].every((key) => stats[key] === fetchedRows),
      scannerBehavior: issues.length === 0
        ? "allow institution publish; source coverage ready and complete-run readback matches"
        : "preserve latest complete run; show institution health reason; do not publish stale or insufficient chip data",
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    strategy: "Institution / 買賣超",
    contract: "institution-chip-source-api-complete-run-verify-v1",
    error: error?.message || String(error),
    details: error?.details || {},
  }, null, 2)}\n`);
  process.exit(1);
});
