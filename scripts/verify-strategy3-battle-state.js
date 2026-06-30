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

const MIN_RESULT_ROWS = Math.max(1, cleanNumber(process.env.STRATEGY3_BATTLE_MIN_RESULT_ROWS || 1));

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
    if (!response.ok) fail(`${pathname} HTTP ${response.status}`, { body: text.slice(0, 500) });
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount };
  } finally {
    clearTimeout(timer);
  }
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
    runId: api.body?.runId,
    count: api.body?.count,
    tvPassCount: api.body?.tvPassCount,
    usedDate: api.body?.usedDate,
  };
  if (api.statusCode !== 200 || api.body?.ok !== true) issues.push("api_not_ok");
  if (cleanNumber(api.body?.count) < MIN_RESULT_ROWS) issues.push(`api_count_${api.body?.count}_below_${MIN_RESULT_ROWS}`);
  if (!Object.prototype.hasOwnProperty.call(api.body || {}, "tvPassCount")) issues.push("api_missing_tvPassCount");
  if (!api.body?.runId) issues.push("api_missing_runId");

  const health = await rest("v_scanner_resource_health?select=strategy,status,latest_date,row_count,reason&strategy=eq.Strategy3&limit=1");
  const healthRow = health.rows?.[0] || {};
  details.health = healthRow;
  if (healthRow.status !== "ready") issues.push(`health_not_ready_${healthRow.status || "missing"}`);

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

  const sourceCounts = await Promise.all([
    rest("strategy3_ready_snapshot?select=symbol&limit=1", { count: true }).then((r) => ["strategy3_ready_snapshot", r.exactCount]),
    rest("fugle_quotes_latest?select=symbol&limit=1", { count: true }).then((r) => ["fugle_quotes_latest", r.exactCount]),
    rest("v_strategy3_intraday_1m_status?select=symbol&limit=1", { count: true }).then((r) => ["v_strategy3_intraday_1m_status", r.exactCount]),
    rest("stock_daily_volume?select=trade_date&order=trade_date.desc&limit=1", { count: true }).then((r) => ["stock_daily_volume", r.exactCount, r.rows?.[0]?.trade_date]),
  ]);
  details.sourceCounts = Object.fromEntries(sourceCounts.map(([name, count, latestDate]) => [name, { count, latestDate }]));
  for (const [name, count] of sourceCounts) {
    if (cleanNumber(count) < 1000) issues.push(`${name}_count_${count}_below_1000`);
  }

  const output = { ok: issues.length === 0, checkedAt: new Date().toISOString(), issues, details };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error), details: error?.details || {} }, null, 2)}\n`);
  process.exit(1);
});
