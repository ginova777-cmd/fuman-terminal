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

const MIN_INSTITUTION_ROWS = Number(process.env.STRATEGY5_BATTLE_MIN_INSTITUTION_ROWS || 1500);
const MIN_STRATEGY5_ROWS = Number(process.env.STRATEGY5_BATTLE_MIN_STRATEGY5_ROWS || 1);
const MIN_INSTITUTION_RESULT_ROWS = Number(process.env.INSTITUTION_BATTLE_MIN_RESULT_ROWS || 1);
const STRATEGY5_LIMIT = Number(process.env.STRATEGY5_BATTLE_API_LIMIT || 70);
const INSTITUTION_LIMIT = Number(process.env.INSTITUTION_BATTLE_API_LIMIT || 60);

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

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function taipeiDate(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return "";
  const p = taipeiParts(parsed);
  return `${p.year}-${p.month}-${p.day}`;
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

function summarizeRun(row = {}) {
  return {
    runId: row.run_id || "",
    scanDate: row.scan_date || row.date || "",
    status: row.status || "",
    complete: row.complete,
    expectedTotal: row.expected_total,
    scannedCount: row.scanned_count,
    resultCount: row.result_count,
    qualityStatus: row.quality_status || "",
    dataContractSource: row.data_contract_source || "",
    updatedAt: row.updated_at || row.finished_at || "",
    sourceHealth: row.payload?.sourceHealth || null,
  };
}

function payloadCount(payload = {}, primaryField = "rows") {
  if (primaryField === "matches") {
    return Array.isArray(payload.matches) ? payload.matches.length : cleanNumber(payload.returnedCount || payload.count);
  }
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (payload.data && typeof payload.data === "object") return Object.keys(payload.data).length;
  return cleanNumber(payload.returnedCount || payload.count);
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

function chipSourceSummary(institutionHealth = {}, chipHealthRows = [], chipRows = []) {
  const coverageStatus = String(institutionHealth.coverage_status || "").toLowerCase();
  const latestTradeDate = normalizeDate(institutionHealth.latest_trade_date || chipRows[0]?.trade_date || "");
  return {
    latestTradeDate,
    latestAgeDays: dateAgeDays(latestTradeDate),
    coverageStatus,
    institutionalRows: cleanNumber(institutionHealth.institutional_rows),
    marginRows: cleanNumber(institutionHealth.margin_rows),
    unifiedRows: cleanNumber(institutionHealth.unified_rows),
    validAfterExclusionRows: cleanNumber(institutionHealth.valid_after_exclusion_rows),
    minRequiredRows: cleanNumber(institutionHealth.min_required_rows || MIN_INSTITUTION_ROWS),
    reason: institutionHealth.reason || "",
    chipHealthRows: chipHealthRows.map((row) => ({
      sourceName: row.source_name || "",
      tradeDate: row.trade_date || row.checked_trade_date || "",
      maxTradeDate: row.max_trade_date || "",
      staleDays: cleanNumber(row.stale_days),
      rowsOnMaxDate: cleanNumber(row.rows_on_max_date),
      sourceStatus: row.source_status || "",
      latestUpdatedAt: row.latest_updated_at || "",
    })),
    chipLatestRows: chipRows.length,
    chipLatestSample: chipRows.slice(0, 5),
  };
}

async function fetchScannerHealth() {
  const result = await rest(buildPath("v_scanner_resource_health", {
    select: "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at",
    limit: 50,
  }));
  return result.rows.find((row) => String(row.strategy || "").toLowerCase() === "strategy5 / institution") || {};
}

async function fetchLatestRunAndResults(kind) {
  const isStrategy5 = kind === "strategy5";
  const view = isStrategy5 ? "v_strategy5_latest_complete_run" : "v_institution_latest_complete_run";
  const table = isStrategy5 ? "strategy5_scan_results" : "institution_scan_results";
  const strategy = isStrategy5 ? "strategy5" : "institution";
  const runResult = await safeRest(buildPath(view, {
    select: "*",
    strategy: `eq.${strategy}`,
    status: "eq.complete",
    complete: "eq.true",
    limit: 1,
  }), { timeoutMs: 15000 });
  const run = runResult.rows?.[0] || {};
  const select = isStrategy5
    ? "run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at"
    : "run_id,scan_date,code,name,close,change_percent,trade_volume,trade_value,foreign_net,trust_net,dealer_net,total_net,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at";
  const rowsResult = run.run_id
    ? await safeRest(buildPath(table, {
      select,
      strategy: `eq.${strategy}`,
      run_id: `eq.${run.run_id}`,
      order: "rank.asc",
      limit: 3000,
    }), { count: true, timeoutMs: 20000 })
    : { ok: false, rows: [], exactCount: 0, error: "missing run id" };
  return { runResult, run, rowsResult, runInfo: summarizeRun(run) };
}

async function main() {
  const issues = [];
  const warnings = [];
  const details = {};

  const [strategy5Api, institutionApi] = await Promise.all([
    captureApi("../api/strategy5-latest", "/api/strategy5-latest", {
      canvas: "1",
      compact: "1",
      shell: "1",
      live: "1",
      limit: String(STRATEGY5_LIMIT),
      verify: "1",
    }),
    captureApi("../api/institution-latest", "/api/institution-latest", {
      canvas: "1",
      compact: "1",
      shell: "1",
      live: "1",
      limit: String(INSTITUTION_LIMIT),
      verify: "1",
    }),
  ]);

  details.api = {
    strategy5: {
      statusCode: strategy5Api.statusCode,
      ok: strategy5Api.body?.ok,
      runId: strategy5Api.body?.runId || strategy5Api.body?.transport?.runId || "",
      count: cleanNumber(strategy5Api.body?.count),
      returnedCount: payloadCount(strategy5Api.body || {}, "matches"),
      usedDate: strategy5Api.body?.usedDate || "",
      sourceDate: strategy5Api.body?.sourceDate || "",
      sourceStatus: strategy5Api.body?.sourceStatus || "",
      sourceCoverage: strategy5Api.body?.sourceCoverage || null,
      publishGate: strategy5Api.body?.publishGate || null,
      fallbackUsed: strategy5Api.body?.fallbackUsed,
      fallback: strategy5Api.body?.fallback || null,
      writeBudget: strategy5Api.body?.writeBudget || null,
      retentionOk: strategy5Api.body?.retentionOk,
      retention: strategy5Api.body?.retention || null,
      dataFreshness: strategy5Api.body?.dataFreshness || null,
      unattended: strategy5Api.body?.unattended || null,
      cacheSource: strategy5Api.body?.cacheSource || strategy5Api.body?.source || "",
      transport: strategy5Api.body?.transport || null,
      error: strategy5Api.body?.error || strategy5Api.body?.detail || "",
    },
    institution: {
      statusCode: institutionApi.statusCode,
      ok: institutionApi.body?.ok,
      runId: institutionApi.body?.runId || institutionApi.body?.transport?.runId || "",
      count: cleanNumber(institutionApi.body?.count),
      returnedCount: payloadCount(institutionApi.body || {}, "rows"),
      usedDate: institutionApi.body?.usedDate || "",
      cacheSource: institutionApi.body?.cacheSource || institutionApi.body?.source || "",
      transport: institutionApi.body?.transport || null,
      error: institutionApi.body?.error || institutionApi.body?.detail || "",
    },
  };
  pushIssue(issues, strategy5Api.statusCode >= 200 && strategy5Api.statusCode < 300 && strategy5Api.body?.ok === true, "strategy5_api_not_ok", details.api.strategy5);
  pushIssue(issues, institutionApi.statusCode >= 200 && institutionApi.statusCode < 300 && institutionApi.body?.ok === true, "institution_api_not_ok", details.api.institution);
  pushIssue(issues, Boolean(details.api.strategy5.runId), "strategy5_api_missing_run_id");
  pushIssue(issues, Boolean(details.api.institution.runId), "institution_api_missing_run_id");
  pushIssue(issues, details.api.strategy5.unattended?.status === "YES" && details.api.strategy5.unattended?.canRunUnattended === true, "strategy5_unattended_not_yes", {
    unattended: details.api.strategy5.unattended,
  });
  pushIssue(issues, details.api.strategy5.dataFreshness?.status === "fresh" && details.api.strategy5.dataFreshness?.priorityStaleBlocked !== true, "strategy5_data_freshness_not_fresh", {
    dataFreshness: details.api.strategy5.dataFreshness,
  });
  pushIssue(issues, details.api.strategy5.sourceCoverage?.ok === true, "strategy5_source_coverage_not_ok", {
    sourceCoverage: details.api.strategy5.sourceCoverage,
  });
  pushIssue(issues, details.api.strategy5.publishGate?.publishAllowed === true && details.api.strategy5.publishGate?.latestOverwriteAllowed === true, "strategy5_publish_gate_not_allowed", {
    publishGate: details.api.strategy5.publishGate,
  });
  pushIssue(issues, details.api.strategy5.fallbackUsed === false && details.api.strategy5.fallback?.used === false, "strategy5_fallback_not_disclosed_or_used", {
    fallbackUsed: details.api.strategy5.fallbackUsed,
    fallback: details.api.strategy5.fallback,
  });
  pushIssue(issues, details.api.strategy5.writeBudget?.ok === true && cleanNumber(details.api.strategy5.writeBudget?.estimatedRowsWritten) > 0, "strategy5_write_budget_not_ok", {
    writeBudget: details.api.strategy5.writeBudget,
  });
  pushIssue(issues, details.api.strategy5.retentionOk === true && details.api.strategy5.retention?.ok === true, "strategy5_retention_not_ok", {
    retentionOk: details.api.strategy5.retentionOk,
    retention: details.api.strategy5.retention,
  });

  const [scannerHealth, institutionHealthResult, chipHealthResult, chipLatestResult, strategy5Run, institutionRun] = await Promise.all([
    fetchScannerHealth().catch((error) => ({ __error: error?.message || String(error) })),
    safeRest(buildPath("v_institution_source_health", { select: "*", limit: 1 }), { timeoutMs: 15000 }),
    safeRest(buildPath("v_chip_flows_health", { select: "*", order: "source_name.asc", limit: 20 }), { timeoutMs: 15000 }),
    safeRest(buildPath("v_chip_flows_latest", {
      select: "symbol,trade_date,foreign_net,investment_trust_net,dealer_net,institution_total_net,source,updated_at",
      order: "trade_date.desc",
      limit: 2000,
    }), { count: true, timeoutMs: 20000 }),
    fetchLatestRunAndResults("strategy5"),
    fetchLatestRunAndResults("institution"),
  ]);

  const healthStatus = String(scannerHealth.status || "").toLowerCase();
  details.health = scannerHealth;
  pushIssue(issues, !scannerHealth.__error && Boolean(scannerHealth.strategy), "scanner_resource_health_missing", { error: scannerHealth.__error || "" });
  pushIssue(issues, ["ready", "stale", "not_ready", "failed"].includes(healthStatus), "scanner_resource_health_bad_status", { status: scannerHealth.status || "" });
  pushIssue(issues, healthStatus === "ready", "scanner_resource_health_not_ready", { status: scannerHealth.status || "", reason: scannerHealth.reason || "" });

  const institutionHealth = institutionHealthResult.rows?.[0] || {};
  const sourceSummary = chipSourceSummary(institutionHealth, chipHealthResult.rows || [], chipLatestResult.rows || []);
  details.sourceHealth = {
    institutionSourceHealthOk: institutionHealthResult.ok,
    institutionSourceHealthError: institutionHealthResult.error || "",
    chipFlowsHealthOk: chipHealthResult.ok,
    chipFlowsHealthError: chipHealthResult.error || "",
    chipFlowsLatestOk: chipLatestResult.ok,
    chipFlowsLatestError: chipLatestResult.error || "",
    chipFlowsLatestExactCount: chipLatestResult.exactCount,
    ...sourceSummary,
  };

  pushIssue(issues, institutionHealthResult.ok, "institution_source_health_unreadable", { error: institutionHealthResult.error || "" });
  pushIssue(issues, chipHealthResult.ok, "chip_flows_health_unreadable", { error: chipHealthResult.error || "" });
  pushIssue(issues, chipLatestResult.ok, "chip_flows_latest_unreadable", { error: chipLatestResult.error || "" });
  pushIssue(issues, sourceSummary.coverageStatus === "ready", "institution_coverage_not_ready", { coverageStatus: sourceSummary.coverageStatus, reason: sourceSummary.reason });
  pushIssue(issues, sourceSummary.institutionalRows >= MIN_INSTITUTION_ROWS, "institutional_rows_below_min", { rows: sourceSummary.institutionalRows, min: MIN_INSTITUTION_ROWS });
  pushIssue(issues, sourceSummary.marginRows >= MIN_INSTITUTION_ROWS, "margin_rows_below_min", { rows: sourceSummary.marginRows, min: MIN_INSTITUTION_ROWS });
  pushIssue(issues, sourceSummary.validAfterExclusionRows >= sourceSummary.minRequiredRows, "valid_after_exclusion_rows_below_min", {
    rows: sourceSummary.validAfterExclusionRows,
    min: sourceSummary.minRequiredRows,
  });
  pushIssue(issues, cleanNumber(chipLatestResult.exactCount) >= MIN_INSTITUTION_ROWS, "chip_flows_latest_rows_below_min", {
    rows: cleanNumber(chipLatestResult.exactCount),
    min: MIN_INSTITUTION_ROWS,
  });

  const chipLatestDate = sourceSummary.latestTradeDate;
  if (!chipLatestDate) {
    issues.push({ id: "chip_latest_trade_date_missing" });
  } else if (sourceSummary.latestAgeDays != null && sourceSummary.latestAgeDays > 3) {
    issues.push({ id: "chip_latest_trade_date_stale", latestTradeDate: chipLatestDate, ageDays: sourceSummary.latestAgeDays });
  }

  details.runs = {
    strategy5: {
      run: strategy5Run.runInfo,
      runReadable: strategy5Run.runResult.ok,
      resultReadable: strategy5Run.rowsResult.ok,
      resultRows: cleanNumber(strategy5Run.rowsResult.exactCount),
      fetchedRows: strategy5Run.rowsResult.rows?.length || 0,
      keyStats: keyStats(strategy5Run.rowsResult.rows, {
        code: ["code"],
        name: ["name"],
        score: ["score"],
        chip: [
          "institutionTotalNet",
          "institution_total_net",
          "totalNet",
          "total_net",
          "foreignNet",
          "foreign_net",
          "trustNet",
          "investment_trust_net",
          "payload.institutionTotalNet",
          "payload.institution_total_net",
          "payload.totalNet",
          "payload.total_net",
          "payload.foreignNet",
          "payload.foreign_net",
          "payload.trustNet",
          "payload.investment_trust_net",
          "payload.inst.total",
          "payload.inst.foreign",
          "payload.inst.trust",
          "payload.inst.dealer",
        ],
        reason: ["reason", "signals"],
      }),
    },
    institution: {
      run: institutionRun.runInfo,
      runReadable: institutionRun.runResult.ok,
      resultReadable: institutionRun.rowsResult.ok,
      resultRows: cleanNumber(institutionRun.rowsResult.exactCount),
      fetchedRows: institutionRun.rowsResult.rows?.length || 0,
      keyStats: keyStats(institutionRun.rowsResult.rows, {
        code: ["code"],
        name: ["name"],
        foreign: ["foreign_net", "foreignNet"],
        trust: ["trust_net", "investment_trust_net", "trustNet"],
        dealer: ["dealer_net", "dealerNet"],
        total: ["total_net", "institution_total_net", "totalNet", "institutionTotalNet"],
      }),
    },
  };

  for (const [label, item] of [["strategy5", strategy5Run], ["institution", institutionRun]]) {
    const run = item.runInfo;
    const resultRows = cleanNumber(item.rowsResult.exactCount);
    pushIssue(issues, item.runResult.ok, `${label}_latest_run_unreadable`, { error: item.runResult.error || "" });
    pushIssue(issues, Boolean(run.runId), `${label}_latest_run_missing`);
    pushIssue(issues, String(run.status || "").toLowerCase() === "complete", `${label}_latest_run_bad_status`, { status: run.status || "" });
    pushIssue(issues, run.complete === true, `${label}_latest_run_not_complete`, { complete: run.complete });
    pushIssue(issues, cleanNumber(run.expectedTotal) > 0, `${label}_expected_total_empty`, { expectedTotal: run.expectedTotal });
    pushIssue(issues, cleanNumber(run.expectedTotal) === cleanNumber(run.scannedCount), `${label}_scan_count_mismatch`, {
      expectedTotal: run.expectedTotal,
      scannedCount: run.scannedCount,
    });
    const resultMin = label === "strategy5" ? MIN_STRATEGY5_ROWS : MIN_INSTITUTION_RESULT_ROWS;
    pushIssue(issues, cleanNumber(run.resultCount) >= resultMin, `${label}_result_count_below_min`, {
      resultCount: run.resultCount,
      min: resultMin,
    });
    pushIssue(issues, item.rowsResult.ok, `${label}_result_rows_unreadable`, { error: item.rowsResult.error || "" });
    pushIssue(issues, resultRows === cleanNumber(run.resultCount), `${label}_result_readback_count_mismatch`, {
      resultRows,
      runResultCount: run.resultCount,
    });
  }

  const s5Stats = details.runs.strategy5.keyStats;
  const instStats = details.runs.institution.keyStats;
  pushIssue(issues, s5Stats.code === details.runs.strategy5.fetchedRows, "strategy5_code_key_missing", s5Stats);
  pushIssue(issues, s5Stats.name === details.runs.strategy5.fetchedRows, "strategy5_name_key_missing", s5Stats);
  pushIssue(issues, s5Stats.chip === details.runs.strategy5.fetchedRows, "strategy5_chip_key_missing", s5Stats);
  pushIssue(issues, instStats.code === details.runs.institution.fetchedRows, "institution_code_key_missing", instStats);
  pushIssue(issues, instStats.foreign === details.runs.institution.fetchedRows, "institution_foreign_key_missing", instStats);
  pushIssue(issues, instStats.trust === details.runs.institution.fetchedRows, "institution_trust_key_missing", instStats);
  pushIssue(issues, instStats.dealer === details.runs.institution.fetchedRows, "institution_dealer_key_missing", instStats);
  pushIssue(issues, instStats.total === details.runs.institution.fetchedRows, "institution_total_key_missing", instStats);

  if (details.api.strategy5.runId && strategy5Run.runInfo.runId && details.api.strategy5.runId !== strategy5Run.runInfo.runId) {
    warnings.push({ id: "strategy5_api_run_id_differs_from_latest_view", apiRunId: details.api.strategy5.runId, latestRunId: strategy5Run.runInfo.runId });
  }
  if (details.api.institution.runId && institutionRun.runInfo.runId && details.api.institution.runId !== institutionRun.runInfo.runId) {
    warnings.push({ id: "institution_api_run_id_differs_from_latest_view", apiRunId: details.api.institution.runId, latestRunId: institutionRun.runInfo.runId });
  }
  if (details.api.strategy5.returnedCount <= 0) issues.push({ id: "strategy5_api_returned_count_empty", api: details.api.strategy5 });
  if (details.api.institution.returnedCount <= 0) issues.push({ id: "institution_api_returned_count_empty", api: details.api.institution });

  const output = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    strategy: "Strategy5 / institution",
    contract: "strategy5-institution-chip-source-api-complete-run-verify-v1",
    issues,
    warnings,
    details,
    gate: {
      sourceCoverageReady: sourceSummary.coverageStatus === "ready" && sourceSummary.validAfterExclusionRows >= sourceSummary.minRequiredRows,
      apiPublishAllowed: details.api.strategy5.publishGate?.publishAllowed === true,
      fallbackUsed: details.api.strategy5.fallbackUsed === true || details.api.strategy5.fallback?.used === true,
      writeBudgetOk: details.api.strategy5.writeBudget?.ok === true,
      retentionOk: details.api.strategy5.retentionOk === true,
      scannerBehavior: issues.length === 0
        ? "allow Strategy5/institution publish; chip source health ready"
        : "preserve latest complete run; show chip/source health reason; do not publish stale or insufficient chip data",
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    strategy: "Strategy5 / institution",
    contract: "strategy5-institution-chip-source-api-complete-run-verify-v1",
    error: error?.message || String(error),
    details: error?.details || {},
  }, null, 2)}\n`);
  process.exit(1);
});
