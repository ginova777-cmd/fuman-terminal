const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || (() => {
    try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"), "utf8").trim(); } catch { return ""; }
  })();

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const MIN_RESULT_ROWS = Math.max(1, cleanNumber(process.env.STRATEGY3_BATTLE_MIN_RESULT_ROWS || 1));
const REST_ATTEMPTS = Math.max(1, cleanNumber(process.env.STRATEGY3_BATTLE_REST_ATTEMPTS || 3));

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function captureHandler(handler, query = {}) {
  let body = null;
  const req = { method: "GET", query, headers: {} };
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; },
    json(payload) { body = payload; return payload; },
    send(payload) { body = payload; return payload; },
    end(payload) { body = payload; return payload; },
  };
  await Promise.resolve(handler(req, res));
  return { statusCode: res.statusCode, body };
}

async function rest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) fail("missing Supabase service credentials");
  const attempts = Math.max(1, cleanNumber(options.attempts || REST_ATTEMPTS));
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
    try {
      const headers = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      };
      if (options.count) headers.Prefer = "count=exact";
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { headers, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        last = { message: `${pathname} HTTP ${response.status}`, details: { body: text.slice(0, 500), attempts: attempt } };
      } else {
        const range = response.headers.get("content-range") || "";
        const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
        return { rows: text ? JSON.parse(text) : [], exactCount, attempts: attempt };
      }
    } catch (error) {
      last = { message: `${pathname} fetch failed`, details: { error: error?.message || String(error), attempts: attempt } };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await sleep(300 * attempt);
  }
  fail(last?.message || `${pathname} unreadable`, last?.details || {});
}

async function restSafe(pathname, options = {}) {
  try {
    return { ok: true, ...(await rest(pathname, options)) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), details: error?.details || {} };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sourceCount(name, pathname, options = {}) {
  const result = await restSafe(pathname, { count: true, attempts: Math.max(REST_ATTEMPTS, 5), timeoutMs: 25000 });
  if (!result.ok) {
    return [name, {
      count: 0,
      readError: result.error,
      details: result.details,
      minRequired: options.minRequired || 1000,
    }];
  }
  return [name, {
    count: result.exactCount,
    latestDate: options.latestDate ? options.latestDate(result.rows || []) : undefined,
    minRequired: options.minRequired || 1000,
  }];
}

function runLiveSourceChainCheck() {
  const timeout = Math.max(15000, cleanNumber(process.env.STRATEGY3_BATTLE_LIVE_SOURCE_CHAIN_TIMEOUT_MS || 70000));
  const result = spawnSync(process.execPath, [
    "--use-system-ca",
    path.join(ROOT, "scripts", "check-strategy3-source-chain.js"),
  ], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      return {
        ok: false,
        status: result.status,
        error: `live source-chain JSON parse failed: ${error.message}`,
        stderr: stderr.slice(0, 500),
        stdout: stdout.slice(0, 500),
      };
    }
  }
  if (result.error) {
    return {
      ok: false,
      status: result.status,
      error: result.error.message || String(result.error),
      stderr: stderr.slice(0, 500),
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      error: stderr || stdout || `check-strategy3-source-chain exited ${result.status}`,
    };
  }
  return {
    ok: true,
    status: result.status,
    payload: parsed || {},
  };
}

async function main() {
  const issues = [];
  const details = {};
  const strategy3Latest = require("../api/strategy3-latest");

  const api = await captureHandler(strategy3Latest, {
    limit: "20",
    canvas: "1",
    compact: "1",
    shell: "1",
    verify: "1",
  });
  details.api = {
    statusCode: api.statusCode,
    ok: api.body?.ok,
    status: api.body?.status,
    sourceStatus: api.body?.sourceStatus,
    dataContractSource: api.body?.dataContractSource,
    runId: api.body?.runId,
    latestRunId: api.body?.latestRunId,
    count: api.body?.count,
    tvPassCount: api.body?.tvPassCount,
    usedDate: api.body?.usedDate,
    staleSeconds: api.body?.staleSeconds,
    fallbackUsed: api.body?.fallbackUsed,
    fallbackScope: api.body?.fallbackScope,
    fallbackDetails: api.body?.fallbackDetails,
    diagnosticFallbackUsed: api.body?.diagnosticFallbackUsed,
    diagnosticFallbackScope: api.body?.diagnosticFallbackScope,
    diagnosticFallbackDetails: api.body?.diagnosticFallbackDetails,
    fallbackContract: api.body?.fallbackContract,
    writeBudget: api.body?.writeBudget,
    retentionOk: api.body?.retentionOk,
    sourceCoverage: api.body?.sourceCoverage,
    issues: api.body?.issues,
    warnings: api.body?.warnings,
  };
  if (api.statusCode !== 200 || api.body?.ok !== true) issues.push("api_not_ok");
  if (cleanNumber(api.body?.count) < MIN_RESULT_ROWS) issues.push(`api_count_${api.body?.count}_below_${MIN_RESULT_ROWS}`);
  if (!Object.prototype.hasOwnProperty.call(api.body || {}, "tvPassCount")) issues.push("api_missing_tvPassCount");
  if (!api.body?.runId) issues.push("api_missing_runId");
  for (const field of ["status", "sourceStatus", "dataContractSource", "sourceCoverage", "staleSeconds", "latestRunId", "fallbackUsed", "fallbackScope", "fallbackDetails", "diagnosticFallbackUsed", "diagnosticFallbackScope", "diagnosticFallbackDetails", "writeBudget", "retentionOk", "issues", "warnings"]) {
    if (!Object.prototype.hasOwnProperty.call(api.body || {}, field)) issues.push(`api_missing_${field}`);
  }
  if (api.body?.latestRunId && api.body?.runId && String(api.body.latestRunId) !== String(api.body.runId)) {
    issues.push(`api_latestRunId_${api.body.latestRunId}_does_not_match_runId_${api.body.runId}`);
  }
  if (!["ready", "degraded", "critical", "stale"].includes(String(api.body?.status || ""))) {
    issues.push(`api_bad_status_${api.body?.status || "missing"}`);
  }
  if (!api.body?.sourceCoverage || typeof api.body.sourceCoverage !== "object") {
    issues.push("api_sourceCoverage_not_object");
  } else {
    for (const field of ["fresh_quote_coverage_120s", "today_1m_symbols", "ready_ge_35", "latest_candle_time", "intraday_1m_stale_seconds", "preopenCoverage", "preopenRows", "preopenExpected", "dailyVolumeFreshness"]) {
      if (!Object.prototype.hasOwnProperty.call(api.body.sourceCoverage, field)) issues.push(`api_sourceCoverage_missing_${field}`);
    }
    if (api.body.sourceCoverage.preopenCoverage === null || api.body.sourceCoverage.preopenCoverage === undefined) issues.push("api_sourceCoverage_preopenCoverage_null");
    if (cleanNumber(api.body.sourceCoverage.preopenRows) < 1000) issues.push(`api_sourceCoverage_preopenRows_${api.body.sourceCoverage.preopenRows}_below_1000`);
  }
  if (!api.body?.writeBudget || typeof api.body.writeBudget !== "object") issues.push("api_writeBudget_not_object");
  if (api.body?.retentionOk !== true) issues.push("api_retentionOk_not_true");
  if (!Array.isArray(api.body?.issues)) issues.push("api_issues_not_array");
  if (!Array.isArray(api.body?.warnings)) issues.push("api_warnings_not_array");
  if (api.body?.fallbackUsed === true && Array.isArray(api.body?.fallbackScope) && api.body.fallbackScope.includes("source")) {
    issues.push("api_source_fallback_used");
  }
  if (api.body?.fallbackUsed === true && !Array.isArray(api.body?.fallbackDetails)) issues.push("api_fallbackDetails_not_array");
  if (api.body?.fallbackUsed === true && !api.body?.fallbackScope?.length) issues.push("api_fallbackUsed_without_scope");
  if (api.body?.diagnosticFallbackUsed === true && !Array.isArray(api.body?.diagnosticFallbackDetails)) issues.push("api_diagnosticFallbackDetails_not_array");
  if (api.body?.diagnosticFallbackUsed === true && !asArray(api.body?.diagnosticFallbackScope).includes("tv_candle_diagnostic")) {
    issues.push("api_diagnosticFallbackUsed_without_tv_candle_diagnostic_scope");
  }
  const apiRows = asArray(api.body?.matches).length ? asArray(api.body.matches)
    : asArray(api.body?.rows).length ? asArray(api.body.rows)
      : asArray(api.body?.items).length ? asArray(api.body.items)
        : asArray(api.body?.data);
  const rowMissingRunId = apiRows.filter((row) => String(row?.runId || row?.run_id || "") !== String(api.body?.runId || ""));
  const rowMissingJudgment = apiRows.filter((row) => {
    const hasReason = String(row?.reason || "").trim();
    const hasScore = row?.score !== null && row?.score !== undefined && row?.score !== "";
    const hasTvEntry = row?.tvOvernightEntry && typeof row.tvOvernightEntry === "object";
    return !hasReason && !hasScore && !hasTvEntry;
  });
  details.apiRows = {
    rowsChecked: apiRows.length,
    rowMissingRunId: rowMissingRunId.length,
    rowMissingJudgment: rowMissingJudgment.length,
    sampleMissingRunId: rowMissingRunId.slice(0, 5).map((row) => ({ code: row?.code || row?.symbol || "", name: row?.name || "" })),
  };
  if (apiRows.length > 0 && rowMissingRunId.length > 0) issues.push(`api_rows_missing_runId_${rowMissingRunId.length}_${apiRows.length}`);
  if (apiRows.length > 0 && rowMissingJudgment.length > 0) issues.push(`api_rows_missing_judgment_${rowMissingJudgment.length}_${apiRows.length}`);

  const health = await restSafe("v_scanner_resource_health?select=strategy,status,latest_date,row_count,reason&strategy=eq.Strategy3&limit=1", { attempts: REST_ATTEMPTS, timeoutMs: 20000 });
  const healthRow = health.rows?.[0] || {};
  details.health = health.ok ? healthRow : {
    status: "read_failed",
    source: "v_scanner_resource_health",
    error: health.error,
    details: health.details,
    fallback: "latest_complete_run_and_live_source_chain",
  };
  if (health.ok && healthRow.status !== "ready") issues.push(`health_not_ready_${healthRow.status || "missing"}`);

  const runs = await rest("strategy3_scan_runs?select=run_id,expected_total,scanned_count,result_count,payload,updated_at&strategy=eq.strategy3&status=eq.complete&order=updated_at.desc&limit=1");
  const run = runs.rows?.[0] || {};
  const payload = run.payload || {};
  const scanCoverage = payload.scanCoverage || {};
  details.run = {
    runId: run.run_id,
    expectedTotal: run.expected_total,
    scannedCount: run.scanned_count,
    resultCount: run.result_count,
    scanCoverage: payload.scanCoverage,
    selfTest: payload.selfTest,
    sourceDriftHealth: payload.sourceDriftHealth,
    publishedSelfTest: payload.publishedSelfTest,
  };
  if (!run.run_id) issues.push("latest_run_missing");
  const runResultCount = cleanNumber(run.result_count);
  if (runResultCount < MIN_RESULT_ROWS) issues.push(`run_result_count_${run.result_count}_below_${MIN_RESULT_ROWS}`);
  if (api.body?.runId && run.run_id && String(api.body.runId) !== String(run.run_id)) {
    issues.push(`api_runId_${api.body.runId}_does_not_match_latest_run_${run.run_id}`);
  }
  if (runResultCount > 0 && cleanNumber(api.body?.count) !== runResultCount) {
    issues.push(`api_count_${api.body?.count}_does_not_match_run_result_count_${run.result_count}`);
  }
  if (!payload.scanCoverage) {
    issues.push("run_missing_scanCoverage_complete_scan_contract");
  } else {
    if (scanCoverage.completeScan !== true) issues.push("scanCoverage_completeScan_not_true");
    if (scanCoverage.candidateLimitApplied) issues.push(`scanCoverage_candidate_limit_applied_${scanCoverage.candidateLimit}`);
    if (cleanNumber(scanCoverage.scannedCount) !== cleanNumber(run.scanned_count || run.expected_total)) {
      issues.push(`scanCoverage_scannedCount_${scanCoverage.scannedCount}_does_not_match_run_scanned_count_${run.scanned_count}`);
    }
    if (cleanNumber(scanCoverage.resultCount) !== runResultCount) {
      issues.push(`scanCoverage_resultCount_${scanCoverage.resultCount}_does_not_match_run_result_count_${run.result_count}`);
    }
    if (cleanNumber(scanCoverage.fieldGateCandidates) !== runResultCount) {
      issues.push(`scanCoverage_fieldGateCandidates_${scanCoverage.fieldGateCandidates}_does_not_match_run_result_count_${run.result_count}`);
    }
  }
  if (payload.selfTest?.ok !== true) issues.push("run_selfTest_not_ok");
  if (payload.selfTest?.completeScan !== true) issues.push("run_selfTest_completeScan_not_true");
  if (cleanNumber(payload.selfTest?.fieldGateReadyCount) > 0 && cleanNumber(payload.selfTest?.fieldGateReadyCount) !== runResultCount) {
    issues.push(`fieldGateReadyCount_${payload.selfTest?.fieldGateReadyCount}_does_not_match_run_result_count_${run.result_count}`);
  }
  if (payload.sourceDriftHealth?.status !== "ready") issues.push("sourceDrift_not_ready");
  if (payload.publishedSelfTest?.ok !== true) issues.push("publishedSelfTest_not_ok");

  const resultReadLimit = Math.max(80, Math.min(2000, runResultCount + 5));
  const rows = await rest(`strategy3_scan_results?select=code,name,payload&run_id=eq.${encodeURIComponent(run.run_id || "")}&strategy=eq.strategy3&order=rank.asc&limit=${resultReadLimit}`, { count: true });
  const resultRows = rows.rows || [];
  const tvBreakdownRows = resultRows.filter((row) => row?.payload?.tvBreakdown).length;
  const tvPassRows = resultRows.filter((row) => row?.payload?.tvOk === true || row?.payload?.tvFlame === true || row?.payload?.tvOvernightEntry?.ok === true).length;
  details.results = {
    exactCount: rows.exactCount,
    visibleRows: resultRows.length,
    tvBreakdownRows,
    tvPassRows,
    names: resultRows.slice(0, 12).map((row) => row.name),
  };
  if (cleanNumber(rows.exactCount) !== runResultCount) issues.push(`result_exact_count_${rows.exactCount}_does_not_match_run_result_count_${run.result_count}`);
  if (resultRows.length !== Math.min(runResultCount, resultReadLimit)) issues.push(`result_rows_${resultRows.length}_does_not_match_expected_readback_${Math.min(runResultCount, resultReadLimit)}`);
  if (tvBreakdownRows !== resultRows.length) issues.push(`tvBreakdownRows_${tvBreakdownRows}_does_not_match_result_rows_${resultRows.length}`);
  if (!resultRows.every((row) => row?.payload?.tvBreakdown && typeof row.payload.tvBreakdown.controlOk === "boolean" && typeof row.payload.tvBreakdown.obvOk === "boolean")) {
    issues.push("tv_breakdown_boolean_fields_missing");
  }

  const liveSourceChain = runLiveSourceChainCheck();
  const livePayload = liveSourceChain.payload || {};
  details.liveSourceChain = liveSourceChain.ok ? {
    ok: livePayload.ok,
    ready: livePayload.ready,
    source: livePayload.source,
    latestQuoteRows: livePayload.latestQuoteRows,
    sessionReadyCount: livePayload.sessionReadyCount,
    fieldGateReadyCount: livePayload.fieldGateReadyCount,
    tvChecked: livePayload.tvChecked,
    tvOk: livePayload.tvOk,
    fallbackUsed: livePayload.fallbackUsed,
    fallbackScope: livePayload.fallbackScope,
    fallbackDetails: livePayload.fallbackDetails,
    issues: livePayload.issues,
    warnings: livePayload.warnings,
    reason: livePayload.reason,
  } : {
    ok: false,
    status: liveSourceChain.status,
    error: liveSourceChain.error,
    stderr: liveSourceChain.stderr,
    stdout: liveSourceChain.stdout,
  };
  if (!liveSourceChain.ok || livePayload.ok !== true) issues.push("live_source_chain_check_failed");
  if (liveSourceChain.ok && livePayload.ready !== true) issues.push("live_source_chain_not_ready");
  const liveTvOk = cleanNumber(livePayload.tvOk);
  const apiTvPassCount = cleanNumber(api.body?.tvPassCount);
  if (liveTvOk > apiTvPassCount) {
    issues.push(`live_source_chain_tv_drift_api_${apiTvPassCount}_live_${liveTvOk}`);
  }
  if (livePayload.fallbackUsed === true) {
    const liveScopes = asArray(livePayload.fallbackScope);
    const liveSourceFallback = liveScopes.includes("source");
    const liveDiagnosticFallback = liveScopes.includes("tv_candle_diagnostic");
    if (liveSourceFallback && api.body?.fallbackUsed !== true) issues.push("api_hidden_live_source_chain_fallback");
    if (liveDiagnosticFallback) {
      if (api.body?.diagnosticFallbackUsed !== true) issues.push("api_hidden_live_tv_candle_diagnostic_fallback");
      if (!asArray(api.body?.diagnosticFallbackScope).includes("tv_candle_diagnostic")) issues.push("api_missing_tv_candle_diagnostic_fallback_scope");
      if (!asArray(api.body?.diagnosticFallbackDetails).length) issues.push("api_missing_tv_candle_diagnostic_fallback_details");
    } else if (!liveSourceFallback && api.body?.fallbackUsed !== true) {
      issues.push("api_hidden_live_source_chain_fallback");
    }
  }

  const sourceCounts = await Promise.all([
    sourceCount("strategy3_ready_snapshot", "strategy3_ready_snapshot?select=symbol&limit=1"),
    sourceCount("fugle_quotes_latest", "fugle_quotes_latest?select=symbol&limit=1"),
    sourceCount("v_strategy3_intraday_1m_status", "v_strategy3_intraday_1m_status?select=symbol&limit=1"),
    sourceCount("stock_daily_volume", "stock_daily_volume?select=trade_date&order=trade_date.desc&limit=1", { latestDate: (rows) => rows?.[0]?.trade_date }),
  ]);
  details.sourceCounts = Object.fromEntries(sourceCounts);
  for (const [name, item] of sourceCounts) {
    if (item.readError) continue;
    if (cleanNumber(item.count) < cleanNumber(item.minRequired || 1000)) issues.push(`${name}_count_${item.count}_below_${item.minRequired || 1000}`);
  }

  const retention = await restSafe(
    "v_fuman_cost_governance_audit_status?select=table_name,ran_at,keep_policy,keep_from_date,deleted_rows,before_rows,after_rows,before_total_bytes,after_total_bytes,has_before_after_audit&table_name=in.(fugle_intraday_1m,fugle_preopen_snapshot_history)&limit=10",
    { attempts: REST_ATTEMPTS, timeoutMs: 20000 }
  );
  const retentionRows = asArray(retention.rows);
  details.retention = retention.ok ? {
    rows: retentionRows,
    requiredTables: ["fugle_intraday_1m", "fugle_preopen_snapshot_history"],
  } : {
    status: "read_failed",
    error: retention.error,
    details: retention.details,
  };
  if (!retention.ok) {
    issues.push(`retention_audit_read_failed_${retention.error || "unknown"}`);
  } else {
    for (const tableName of ["fugle_intraday_1m", "fugle_preopen_snapshot_history"]) {
      const row = retentionRows.find((item) => item?.table_name === tableName);
      if (!row) issues.push(`retention_audit_missing_${tableName}`);
      else if (row.has_before_after_audit !== true) issues.push(`retention_audit_missing_before_after_${tableName}`);
      else if (!row.ran_at) issues.push(`retention_audit_missing_ran_at_${tableName}`);
    }
  }

  const output = { ok: issues.length === 0, checkedAt: new Date().toISOString(), issues, details };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error), details: error?.details || {} }, null, 2)}\n`);
  process.exit(1);
});
