const { serviceRoleKey, terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { runTimeSourceSnapshotResponseFields, wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = process.env.FUMAN_TERMINAL_SUPABASE_SERVICE_ROLE_KEY
  || serviceRoleKey({ runtimeDir: RUNTIME_DIR })
  || terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const CB_DETECT_RUNS_TABLE = process.env.CB_DETECT_SUPABASE_RUNS_TABLE || "cb_detect_scan_runs";
const CB_DETECT_RESULTS_TABLE = process.env.CB_DETECT_SUPABASE_RESULTS_TABLE || "cb_detect_scan_results";

function setDesktopSnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "cb_detect_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    rows: [],
    transport: {
      source: "supabase",
      gate: "run_id",
      runTable: CB_DETECT_RUNS_TABLE,
      resultTable: CB_DETECT_RESULTS_TABLE,
      via: "api/cb-detect-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function emptyPayload(reason = "cb_detect_snapshot_missing", options = {}) {
  return {
    ok: false,
    complete: false,
    qualityStatus: "not_ready",
    cacheSource: "none",
    source: "cb-detect-complete-run",
    count: 0,
    returnedCount: 0,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    shell: Boolean(options.shell),
    rows: [],
    matches: [],
    updatedAt: new Date().toISOString(),
    reason,
    transport: {
      source: "none",
      gate: "complete_run_missing",
      runTable: CB_DETECT_RUNS_TABLE,
      resultTable: CB_DETECT_RESULTS_TABLE,
      via: "api/cb-detect-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function secondsSince(value) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

function ratio(numerator, denominator) {
  const top = cleanNumber(numerator);
  const bottom = cleanNumber(denominator);
  if (bottom <= 0) return top > 0 ? 1 : 0;
  return Number(Math.max(0, Math.min(1, top / bottom)).toFixed(4));
}

function uniqueList(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const query = request.query || {};
    const getParam = (key) => url.searchParams.get(key) ?? query[key];
    const canvas = getParam("canvas") === "1";
    const compact = getParam("compact") === "1";
    const shell = getParam("shell") === "1";
    const compactIntent = canvas || compact || shell || getParam("fastBundle") === "1" || getParam("snapshotBuild") === "1";
    const defaultLimit = compactIntent ? 60 : 3000;
    const maxLimit = compactIntent ? 70 : 3000;
    const limit = Math.max(1, Math.min(maxLimit, cleanNumber(getParam("limit")) || defaultLimit));
    return { canvas, compact, shell, compactIntent, limit };
  } catch {
    return { canvas: false, compact: false, shell: false, compactIntent: false, limit: 3000 };
  }
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: "application/json",
  };
}

async function fetchSupabaseRows(table, query, timeoutMs = 4500) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: supabaseHeaders(),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 180)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

async function readSupabaseSingle(table, query, timeoutMs = 4500) {
  const rows = await fetchSupabaseRows(table, query, timeoutMs);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function rowsFromCompleteRun(resultRows = []) {
  return resultRows
    .map((row, index) => {
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      const volume = cleanNumber(
        payload.volume
        || payload.tradeVolume
        || payload.latestVolume
        || payload.technical?.latestVolume
        || payload.entryPlan?.latestVolume
        || payload.volumeRatio20
        || payload.entryPlan?.volumeRatio20
        || payload.scoreBreakdown?.volume
      );
      return {
        ...payload,
        symbol: payload.symbol || row.symbol || "",
        cbCode: payload.cbCode || row.symbol || "",
        name: payload.name || row.name || payload.code || row.symbol || "",
        cbName: payload.cbName || row.name || "",
        volume,
        tradeVolume: cleanNumber(payload.tradeVolume || payload.latestVolume || payload.technical?.latestVolume || volume),
        volumeRatio20: cleanNumber(payload.volumeRatio20 || payload.entryPlan?.volumeRatio20),
        rank: cleanNumber(payload.rank) || index + 1,
      };
    })
    .sort((a, b) => (cleanNumber(a.rank) || 99999) - (cleanNumber(b.rank) || 99999) || cleanNumber(b.score) - cleanNumber(a.score));
}

function normalizeCbHealthStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["ok", "ready", "complete"].includes(status)) return "ok";
  if (["blocked", "failed", "error"].includes(status)) return "blocked";
  if (["stale", "not_ready", "missing"].includes(status)) return "stale";
  if (!status) return "degraded";
  return "degraded";
}

function buildCbSourceHealth(health, scannerHealth) {
  const completeRunStatus = normalizeCbHealthStatus(health?.source_status || health?.status || "ready");
  const scannerStatus = normalizeCbHealthStatus(scannerHealth?.status || "ready");
  const issues = [];
  const warnings = [];
  if (completeRunStatus !== "ok") issues.push(`complete_run_${completeRunStatus}`);
  if (scannerStatus !== "ok") issues.push(`scanner_${scannerStatus}`);
  return {
    completeRun: health || null,
    scanner: scannerHealth || null,
    status: issues.length ? "degraded" : "ok",
    normalizedFrom: {
      completeRun: health?.source_status || health?.status || "ready",
      scanner: scannerHealth?.status || "ready",
    },
    reason: health?.reason || scannerHealth?.reason || (issues.length ? issues.join(";") : "ready"),
    issues,
    warnings,
    warningCount: warnings.length,
    warningLimit: 3,
  };
}

function buildCbSourceCoverage(payload = {}) {
  const run = payload?.run || {};
  const sourceCounts = run?.payload?.sourceCounts || payload?.sourceCounts || {};
  const expectedTotal = cleanNumber(run.expected_total ?? run.expectedTotal ?? payload.expectedTotal ?? payload.count);
  const scannedCount = cleanNumber(run.scanned_count ?? run.scannedCount ?? payload.scannedCount ?? payload.count);
  const resultCount = cleanNumber(run.result_count ?? run.resultCount ?? payload.resultCount ?? payload.count);
  const scannerRows = cleanNumber(payload?.sourceHealth?.scanner?.row_count ?? resultCount);
  return {
    contract: "cb-source-coverage-v1",
    status: payload?.sourceHealth?.status === "ok" && resultCount > 0 ? "ready" : "degraded",
    completeRunCoverage: ratio(resultCount, expectedTotal || resultCount),
    scanCoverage: ratio(scannedCount, expectedTotal || scannedCount),
    expectedTotal,
    scannedCount,
    resultCount,
    scannerRows,
    sourceCounts,
    latestCompleteRunHealth: payload?.sourceHealth?.completeRun?.source_status || payload?.sourceHealth?.completeRun?.status || "",
    scannerResourceStatus: payload?.sourceHealth?.scanner?.status || "",
  };
}

function buildCbGateContract(payload = {}, baseIssues = [], baseWarnings = [], options = {}) {
  const updatedAt = payload?.updatedAt || payload?.generatedAt || "";
  const staleSeconds = secondsSince(updatedAt);
  const sourceCoverage = buildCbSourceCoverage(payload);
  const fallbackUsed = payload?.cacheSource !== "supabase-api";
  const retentionOk = payload?.complete === true && fallbackUsed === false && cleanNumber(payload?.count) > 0;
  const status = options.status || (payload?.ok === false ? "blocked" : baseIssues.length ? "degraded" : "ready");
  const publishAllowed = status === "ready" && retentionOk && sourceCoverage.status === "ready";
  const reason = options.reason || payload?.detail || payload?.reason || (baseIssues.length ? baseIssues.join(";") : "ready");
  return {
    status,
    sourceCoverage,
    staleSeconds,
    latestRunId: payload?.runId || "",
    fallbackUsed,
    writeBudget: {
      allowLatestWrite: publishAllowed,
      allowCompleteRunWrite: publishAllowed,
      preservePreviousCompleteRun: !publishAllowed,
      reason: publishAllowed ? "CB complete-run source ready" : reason,
    },
    retentionOk,
    publishAllowed,
    mustPreserveLatest: !publishAllowed,
    issues: uniqueList(baseIssues),
    warnings: uniqueList(baseWarnings),
  };
}

function attachCbSelfCheck(payload, options = {}) {
  const cacheSource = String(payload?.cacheSource || "");
  const transportSource = String(payload?.transport?.source || "");
  const gate = String(payload?.transport?.gate || "");
  const sourceOk = cacheSource === "supabase-api" && transportSource === "supabase" && gate === "run_id";
  const updatedAt = payload?.updatedAt || payload?.generatedAt || "";
  const updatedAtOk = Number.isFinite(Date.parse(String(updatedAt || "")));
  const qualityStatus = String(payload?.qualityStatus || "");
  const sourceHealthStatus = String(payload?.sourceHealth?.status || "");
  const issues = [];
  if (!sourceOk) issues.push("official_source_not_confirmed");
  if (!payload?.runId) issues.push("run_id_missing");
  if (!updatedAtOk) issues.push("updated_at_invalid");
  if (!qualityStatus) issues.push("quality_status_missing");
  if (sourceHealthStatus && sourceHealthStatus !== "ok") issues.push(`source_health_${sourceHealthStatus}`);
  const warnings = payload?.sourceHealth?.warnings || [];
  const status = options.status || (payload?.ok === false ? "blocked" : issues.length ? "degraded" : "ready");
  const gateContract = buildCbGateContract(payload, issues, warnings, {
    status,
    reason: options.reason || payload?.detail || payload?.reason || "",
  });
  return {
    ...payload,
    ...gateContract,
    selfCheck: {
      strategy: "cb-detect",
      contract: "api-self-check-v2",
      checkedAt: new Date().toISOString(),
      status: gateContract.status,
      reason: gateContract.writeBudget.reason,
      officialSource: "Supabase complete-run: cb_detect_scan_runs + cb_detect_scan_results",
      sourceOk,
      cacheSource,
      runId: payload?.runId || "",
      latestRunId: gateContract.latestRunId,
      updatedAt,
      qualityStatus,
      freshness: {
        runId: payload?.runId || "",
        updatedAt,
        generatedAt: payload?.generatedAt || "",
        staleSeconds: gateContract.staleSeconds,
      },
      sourceCoverage: gateContract.sourceCoverage,
      fallbackUsed: gateContract.fallbackUsed,
      writeBudget: gateContract.writeBudget,
      retentionOk: gateContract.retentionOk,
      publishAllowed: gateContract.publishAllowed,
      mustPreserveLatest: gateContract.mustPreserveLatest,
      dataContract: {
        source: payload?.dataContractSource || "",
        ok: String(payload?.dataContractSource || "").includes("cb_detect_scan_runs/results"),
      },
      sourceHealth: payload?.sourceHealth || null,
      transport: payload?.transport || null,
      issues: gateContract.issues,
      warnings: gateContract.warnings,
    },
  };
}
async function readLatestCompleteRun(options) {
  const runRows = await fetchSupabaseRows(
    CB_DETECT_RUNS_TABLE,
    [
      "select=run_id,scan_date,finished_at,status,complete,expected_total,scanned_count,result_count,quality_status,source,schema_version,data_contract_source,generated_at,updated_at,payload",
      "strategy=eq.cb_detect",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      "limit=1",
    ].join("&")
  );
  const run = Array.isArray(runRows) ? runRows[0] : null;
  if (!run?.run_id) return null;
  const resultRows = await fetchSupabaseRows(
    CB_DETECT_RESULTS_TABLE,
    [
      "select=run_id,scan_date,symbol,name,payload,updated_at",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "limit=5000",
    ].join("&"),
    6500
  );
  const rows = rowsFromCompleteRun(resultRows || []);
  const count = cleanNumber(run.result_count) || rows.length;
  if (count > 0 && rows.length <= 0) throw new Error(`cb complete run ${run.run_id} has no result rows`);
  if (count !== rows.length) throw new Error(`cb complete run ${run.run_id} count mismatch: run=${count} results=${rows.length}`);
  const health = await readSupabaseSingle("v_cb_latest_complete_run_health", "select=*&limit=1", 4500).catch((error) => ({ source_status: "degraded", reason: error?.message || String(error) }));
  const scannerHealth = await readSupabaseSingle("v_scanner_resource_health", "select=strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at&strategy=eq.CB&limit=1", 4500).catch((error) => ({ status: "degraded", reason: error?.message || String(error) }));
  const completeRunStatus = String(health?.source_status || health?.status || "ready").toLowerCase();
  const scannerStatus = String(scannerHealth?.status || "ready").toLowerCase();
  const qualityStatus = completeRunStatus === "ready" ? (run.quality_status || "complete") : completeRunStatus;
  const outputRows = options.compactIntent ? rows.slice(0, options.limit || 60) : rows;
  return {
    ok: true,
    complete: true,
    qualityStatus,
    cacheSource: "supabase-api",
    source: run.source || "CBAS",
    ...runTimeSourceSnapshotResponseFields(run?.payload || {}),
    count,
    returnedCount: outputRows.length,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    shell: Boolean(options.shell),
    rows: outputRows,
    matches: outputRows,
    runId: run.run_id,
    tradeDate: String(run.scan_date || "").replace(/\D/g, ""),
    usedDate: String(run.scan_date || "").replace(/\D/g, ""),
    sourceDate: String(run.scan_date || "").replace(/\D/g, ""),
    updatedAt: run.updated_at || run.finished_at || run.generated_at || "",
    generatedAt: run.generated_at || "",
    dataContractSource: run.data_contract_source || "cb_detect_scan_runs/results",
    expectedTotal: cleanNumber(run.expected_total) || count,
    scannedCount: cleanNumber(run.scanned_count) || count,
    resultCount: count,
    run,
    sourceHealth: buildCbSourceHealth(health, scannerHealth),
    transport: {
      source: "supabase",
      via: "api/cb-detect-latest",
      gate: "run_id",
      runTable: CB_DETECT_RUNS_TABLE,
      resultTable: CB_DETECT_RESULTS_TABLE,
      fetchedAt: new Date().toISOString(),
    },
  };
}

module.exports = async function handler(request, response) {
  wrapJsonRunTimeSourceEvidence(response, { strategy: "cb-detect", endpoint: "api/cb-detect-latest" });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const options = readRequestOptions(request);
    const completeRunPayload = await readLatestCompleteRun(options);
    if (completeRunPayload) {
      setDesktopSnapshotCache(response);
      response.status(200).json(attachCbSelfCheck(completeRunPayload));
      return;
    }
    response.status(200).json(attachCbSelfCheck(emptyPayload("cb_detect_complete_run_missing", options), { status: "degraded" }));
  } catch (error) {
    response.status(503).json(attachCbSelfCheck(apiOnlyError(error?.message || String(error)), { status: "blocked" }));
  }
};


