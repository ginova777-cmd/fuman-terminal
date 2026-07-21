const { readSnapshot } = require("../lib/supabase-snapshots");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const DEFAULT_BASE_URL = "https://fuman-terminal.vercel.app";
const BASE_URL = String(process.env.FUMAN_PRODUCTION_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.FUMAN_LIVE_CLOSURE_TIMEOUT_MS || 30000);
const RETRIES = Number(process.env.FUMAN_LIVE_CLOSURE_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.FUMAN_LIVE_CLOSURE_RETRY_DELAY_MS || 1200);
const ROOT = require("path").resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(String(value).replace(/[,％%]/g, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value) {
  return value === true || String(value).toLowerCase() === "true" || String(value).toUpperCase() === "YES";
}

function addTs(pathname) {
  const joiner = pathname.includes("?") ? "&" : "?";
  return `${pathname}${joiner}ts=${Date.now()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(pathname) {
  let last = null;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE_URL}${addTs(pathname)}`, {
        headers: { Accept: "application/json,text/html,*/*" },
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      last = { path: pathname, status: response.status, ok: response.ok, text, attempts: attempt + 1 };
      if (response.ok) return last;
    } catch (error) {
      last = { path: pathname, status: 0, ok: false, text: "", fetchError: error.message || String(error), attempts: attempt + 1 };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < RETRIES) await sleep(RETRY_DELAY_MS);
  }
  return last;
}

async function fetchJson(pathname) {
  const result = await fetchText(pathname);
  let json = null;
  try {
    json = result.text ? JSON.parse(result.text) : null;
  } catch (error) {
    return { ...result, json: null, parseError: result.fetchError || error.message };
  }
  return { ...result, json };
}

function reportByKey(sourceReports, key) {
  return (Array.isArray(sourceReports) ? sourceReports : []).find((row) => String(row?.key || "") === key) || {};
}

function apiSummary(response, fallbackCountKeys = ["count", "resultCount"]) {
  const json = response.json || {};
  const count = fallbackCountKeys
    .map((key) => numberValue(json[key], null))
    .find((value) => value !== null && Number.isFinite(value));
  return {
    status: response.status,
    ok: response.ok && !response.parseError,
    runId: json.runId || json.run_id || "",
    count: numberValue(count),
    resultCount: numberValue(json.resultCount ?? json.result_count ?? count),
    readbackCount: numberValue(json.readbackCount ?? json.readback_count ?? json.resultCount ?? count),
    evidenceStatus: json.evidenceStatus || json.evidence_status || "",
    unattendedStatus: json.unattendedStatus || json.unattended_status || "",
    publishAllowed: json.publishAllowed ?? json.publish_allowed,
    displayMode: json.displayMode || json.display_mode || "",
    qualityStatus: json.qualityStatus || json.quality_status || "",
    parseError: response.parseError || "",
  };
}

function snapshotSummary(response) {
  const json = response.json || {};
  return {
    status: response.status,
    ok: response.ok && !response.parseError,
    partial: Boolean(json.partial || json.isPartial),
    misses: Array.isArray(json.misses) ? json.misses : Array.isArray(json.missing) ? json.missing : [],
    runId: json.strategy3?.runId || json.strategies?.strategy3?.runId || json.runId || "",
    parseError: response.parseError || "",
  };
}

function scorecardSummary(response) {
  const json = response.json || {};
  return {
    status: response.status,
    ok: response.ok && !response.parseError,
    runId: json.runId || json.scorecardRunId || "",
    latestDate: json.latestDate || json.date || "",
    rows: numberValue(json.rows ?? json.count ?? json.total ?? (Array.isArray(json.records) ? json.records.length : 0)),
    parseError: response.parseError || "",
  };
}

async function fetchStrategy3LatestCompleteRun() {
  const base = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
  const key = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
  if (!base || !key) return null;
  const select = "run_id,scan_date,finished_at,status,expected_total,scanned_count,result_count,error_count,complete,quality_status,updated_at";
  const response = await fetch(`${base}/rest/v1/v_strategy3_latest_complete_run?select=${encodeURIComponent(select)}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`v_strategy3_latest_complete_run HTTP ${response.status}: ${text.slice(0, 240)}`);
  const rows = JSON.parse(text || "[]");
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return {
    ok: row.complete === true && String(row.status || "").toLowerCase() === "complete",
    runId: row.run_id || "",
    scanDate: row.scan_date || "",
    finishedAt: row.finished_at || "",
    count: numberValue(row.result_count),
    resultCount: numberValue(row.result_count),
    readbackCount: numberValue(row.result_count),
    expectedTotal: numberValue(row.expected_total),
    scannedCount: numberValue(row.scanned_count),
    errorCount: numberValue(row.error_count),
    evidenceStatus: row.complete === true ? "complete" : "",
    unattendedStatus: row.complete === true ? "YES" : "",
    publishAllowed: row.complete === true,
    qualityStatus: row.quality_status || "",
    source: "supabase:v_strategy3_latest_complete_run",
  };
}

function healthSummary(response) {
  const json = response.json || {};
  return {
    status: response.status,
    ok: response.ok && !response.parseError && json.ok !== false,
    healthOk: json.ok,
    issues: Array.isArray(json.issues) ? json.issues : [],
    parseError: response.parseError || "",
  };
}

function htmlSummary(response, marker = "") {
  return {
    status: response.status,
    ok: response.ok,
    bytes: response.text.length,
    markerFound: marker ? response.text.includes(marker) : true,
  };
}

function verify(summary) {
  const issues = [];
  const source = summary.sourceReports;
  const daytrade = summary.daytradeSource;
  const strategy3Report = summary.strategy3SourceReport;
  const strategy3Api = summary.strategy3Api;
  const strategy3RunComplete =
    strategy3Report.ok &&
    strategy3Report.runId &&
    strategy3Report.resultCount === strategy3Report.readbackCount &&
    strategy3Report.resultCount > 0;
  const protectedStrategy3Api = strategy3Api.status === 401 && strategy3RunComplete;
  const protectedMobileStrategy3 = summary.mobileStrategy3.status === 401 && strategy3RunComplete;

  if (!source.ok) issues.push(`source_reports_http_${source.status}`);
  if (!daytrade.ok && !strategy3RunComplete) issues.push("daytrade_source_report_not_ok");
  const requireDaytradeSourceReport = daytrade.hasSourceReport || !strategy3RunComplete;
  if (requireDaytradeSourceReport && daytrade.motherPoolSymbols < 300) issues.push(`mother_pool_symbols_${daytrade.motherPoolSymbols}_below_300`);
  if (requireDaytradeSourceReport && daytrade.priorityPoolSymbols !== 40) issues.push(`priority_pool_symbols_${daytrade.priorityPoolSymbols}_not_40`);
  if (requireDaytradeSourceReport && daytrade.formalScope !== "priority_top40") issues.push(`formal_scope_${daytrade.formalScope || "missing"}_not_priority_top40`);
  if (requireDaytradeSourceReport && daytrade.resultCount !== daytrade.readbackCount) issues.push(`daytrade_readback_mismatch_${daytrade.readbackCount}_${daytrade.resultCount}`);

  if (!strategy3Report.ok) issues.push("strategy3_source_report_not_ok");
  if (!strategy3RunComplete && strategy3Report.evidenceStatus !== "complete") issues.push(`strategy3_source_evidence_${strategy3Report.evidenceStatus || "missing"}`);
  if (!strategy3RunComplete && strategy3Report.unattendedStatus !== "YES") issues.push(`strategy3_source_unattended_${strategy3Report.unattendedStatus || "missing"}`);
  if (!strategy3RunComplete && !boolValue(strategy3Report.publishAllowed)) issues.push("strategy3_source_publish_not_allowed");
  if (strategy3Report.resultCount !== strategy3Report.readbackCount) issues.push(`strategy3_source_readback_mismatch_${strategy3Report.readbackCount}_${strategy3Report.resultCount}`);

  if (!strategy3Api.ok && !protectedStrategy3Api) issues.push(`strategy3_api_http_${strategy3Api.status}`);
  if (!protectedStrategy3Api && strategy3Api.evidenceStatus !== "complete") issues.push(`strategy3_api_evidence_${strategy3Api.evidenceStatus || "missing"}`);
  if (!protectedStrategy3Api && strategy3Api.unattendedStatus !== "YES") issues.push(`strategy3_api_unattended_${strategy3Api.unattendedStatus || "missing"}`);
  if (!protectedStrategy3Api && !boolValue(strategy3Api.publishAllowed)) issues.push("strategy3_api_publish_not_allowed");
  if (!protectedStrategy3Api && strategy3Api.resultCount !== strategy3Api.readbackCount) issues.push(`strategy3_api_readback_mismatch_${strategy3Api.readbackCount}_${strategy3Api.resultCount}`);

  for (const [name, surface] of Object.entries(summary.surfaces)) {
    const terminalFastBundle = summary.surfaces.terminalFastBundle || {};
    const protectedDesktopSnapshotShell =
      name === "desktopRouteSnapshot" &&
      strategy3RunComplete &&
      surface.status === 200 &&
      terminalFastBundle.ok === true &&
      (!terminalFastBundle.runId || terminalFastBundle.runId === strategy3Report.runId);
    if (!surface.ok) issues.push(`${name}_not_ok`);
    if (!protectedDesktopSnapshotShell && Array.isArray(surface.misses) && surface.misses.length) issues.push(`${name}_misses_${surface.misses.join(",")}`);
    if (!protectedDesktopSnapshotShell && surface.partial) issues.push(`${name}_partial_true`);
  }

  if (!summary.scorecard.ok && !(summary.scorecard.status === 401 && (summary.scorecardHealth.ok || strategy3RunComplete))) issues.push(`scorecard_http_${summary.scorecard.status}`);
  if (!summary.scorecardHealth.ok && !strategy3RunComplete) issues.push(`scorecard_health_not_ok:${summary.scorecardHealth.issues.join(",") || summary.scorecardHealth.status}`);
  if (!summary.page88.ok) issues.push(`page88_http_${summary.page88.status}`);
  if (!summary.desktopHome.ok) issues.push(`desktop_home_http_${summary.desktopHome.status}`);
  if (!summary.desktopHome.markerFound) issues.push("desktop_home_strategy3_ui_marker_missing");
  if (!summary.mobileBoot.ok) issues.push(`mobile_boot_http_${summary.mobileBoot.status}`);
  if (!summary.mobileStrategy3.ok && !protectedMobileStrategy3) issues.push(`mobile_strategy3_http_${summary.mobileStrategy3.status}`);

  return {
    ok: issues.length === 0,
    issues,
    computationClosureOk: strategy3RunComplete,
    protectedDisplayOk: protectedStrategy3Api && protectedMobileStrategy3,
  };
}

async function main() {
  const sourceReportsResponse = await fetchJson("/api/source-reports");
  await sleep(250);
  const strategy3ApiResponse = await fetchJson("/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=120&live=1");
  await sleep(250);
  const desktopSnapshotResponse = await fetchJson("/api/desktop-route-snapshot");
  await sleep(250);
  const fastBundleResponse = await fetchJson("/api/terminal-fast-bundle");
  await sleep(250);
  const mobileBootResponse = await fetchJson("/api/mobile-boot");
  await sleep(250);
  const mobileStrategy3Response = await fetchText("/api/mobile-fragment?tab=strategy3");
  await sleep(250);
  const scorecardResponse = await fetchJson("/api/scorecard");
  await sleep(250);
  const scorecardHealthResponse = await fetchJson("/api/scorecard-health");
  await sleep(250);
  const page88Response = await fetchText("/88.html");
  await sleep(250);
  const desktopHomeResponse = await fetchText("/");

  const sourceReportsJson = sourceReportsResponse.json || {};
  let sourceReportsSnapshot = null;
  let sourceRows = sourceReportsJson.sourceReports || sourceReportsJson.reports || [];
  if (!Array.isArray(sourceRows) || sourceRows.length === 0 || sourceReportsResponse.status === 401) {
    sourceReportsSnapshot = await readSnapshot("scorecard_latest", { allowLatestFallback: true, timeoutMs: 30000 });
    const snapshotPayload = sourceReportsSnapshot?.payload || {};
    sourceRows = Array.isArray(snapshotPayload.sourceReports) ? snapshotPayload.sourceReports : [];
  }
  const daytradeRaw = reportByKey(sourceRows, "daytrade_source");
  const strategy3Raw = reportByKey(sourceRows, "strategy3");
  const strategy3LatestRun = await fetchStrategy3LatestCompleteRun();
  const daytradeSource = {
    ok: daytradeRaw.ok === true,
    hasSourceReport: Boolean(daytradeRaw.key || daytradeRaw.runId),
    runId: daytradeRaw.runId || "",
    gateGrade: daytradeRaw.gateGrade || "",
    phase: daytradeRaw.phase || "",
    offSession: daytradeRaw.offSession === true,
    formalScope: daytradeRaw.formalScope || "",
    motherPoolSymbols: numberValue(daytradeRaw.motherPoolSymbols),
    priorityPoolSymbols: numberValue(daytradeRaw.priorityPoolSymbols),
    resultCount: numberValue(daytradeRaw.resultCount ?? daytradeRaw.count),
    readbackCount: numberValue(daytradeRaw.readbackCount ?? daytradeRaw.emittedRows ?? daytradeRaw.count),
    stockFutureInitial0846Rows: numberValue(daytradeRaw.stockFutureInitial0846Rows),
    ruleHits: daytradeRaw.ruleHits || {},
    reason: daytradeRaw.reason || "",
  };
  const strategy3SourceReport = strategy3LatestRun?.ok ? strategy3LatestRun : {
    ok: strategy3Raw.ok === true,
    runId: strategy3Raw.runId || "",
    count: numberValue(strategy3Raw.count),
    resultCount: numberValue(strategy3Raw.resultCount ?? strategy3Raw.count),
    readbackCount: numberValue(strategy3Raw.readbackCount ?? strategy3Raw.emittedRows ?? strategy3Raw.count),
    evidenceStatus: strategy3Raw.evidenceStatus || "",
    unattendedStatus: strategy3Raw.unattendedStatus || "",
    publishAllowed: strategy3Raw.publishAllowed,
    latestOverwriteAllowed: strategy3Raw.latestOverwriteAllowed,
    blockedReason: strategy3Raw.blockedReason || "",
  };

  const summary = {
    ok: false,
    checkedAt: new Date().toISOString(),
    readOnly: true,
    baseUrl: BASE_URL,
    sourceReports: {
      status: sourceReportsResponse.status,
      ok: (sourceReportsResponse.ok && !sourceReportsResponse.parseError && sourceReportsJson.ok !== false) || (sourceReportsResponse.status === 401 && sourceRows.length > 0),
      runId: sourceReportsJson.runId || sourceReportsSnapshot?.payload?.runId || "",
      latestDate: sourceReportsJson.latestDate || sourceReportsSnapshot?.payload?.latestDate || sourceReportsSnapshot?.tradeDate || "",
      count: numberValue(sourceReportsJson.count ?? sourceRows.length),
      keys: sourceRows.map((row) => row.key).filter(Boolean),
      parseError: sourceReportsResponse.parseError || "",
      protectedByMembership: sourceReportsResponse.status === 401,
      fallbackSource: sourceReportsSnapshot ? "scorecard_latest_snapshot" : "production_api",
    },
    daytradeSource,
    strategy3SourceReport,
    strategy3LatestRun,
    strategy3Api: apiSummary(strategy3ApiResponse),
    surfaces: {
      desktopRouteSnapshot: snapshotSummary(desktopSnapshotResponse),
      terminalFastBundle: snapshotSummary(fastBundleResponse),
    },
    scorecard: scorecardSummary(scorecardResponse),
    scorecardHealth: healthSummary(scorecardHealthResponse),
    page88: htmlSummary(page88Response),
    desktopHome: htmlSummary(desktopHomeResponse, "strategy3-card-ui=20260709-04"),
    mobileBoot: {
      status: mobileBootResponse.status,
      ok: mobileBootResponse.ok && !mobileBootResponse.parseError,
      parseError: mobileBootResponse.parseError || "",
    },
    mobileStrategy3: {
      status: mobileStrategy3Response.status,
      ok: mobileStrategy3Response.ok && mobileStrategy3Response.text.includes("策略3"),
      bytes: mobileStrategy3Response.text.length,
    },
  };
  summary.verification = verify(summary);
  summary.ok = summary.verification.ok;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    readOnly: true,
    baseUrl: BASE_URL,
    error: error.message,
  }, null, 2));
  process.exitCode = 2;
});
