"use strict";

const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/cb-e2e-closure");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function blankCountTotal(blankCounts) {
  if (!blankCounts || typeof blankCounts !== "object") return Number.NaN;
  return Object.values(blankCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function withFresh(pathname) {
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("t", String(Date.now()));
  return url.toString();
}

async function fetchText(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url,
      startedAt,
      finishedAt: new Date().toISOString(),
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 45000) {
  const result = await fetchText(url, timeoutMs);
  let payload = null;
  try {
    payload = JSON.parse(result.text);
  } catch (error) {
    payload = { ok: false, error: "json_parse_failed", reason: error.message };
  }
  return { ...result, payload };
}

function issue(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

function cbEndpoint(bundle) {
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  return endpoints["/api/cb-detect-latest"]
    || endpoints["/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60"]
    || Object.entries(endpoints).find(([key]) => key.startsWith("/api/cb-detect-latest"))?.[1]
    || null;
}

function findCbSourceReport(payload) {
  const reports = Array.isArray(payload?.sourceReports)
    ? payload.sourceReports
    : Array.isArray(payload?.reports)
      ? payload.reports
      : Array.isArray(payload)
        ? payload
        : [];
  return reports.find((row) => row?.key === "cb" || /CB|可轉債|cb-detect/i.test(String(row?.strategy || row?.label || ""))) || null;
}

function summarizeLatest(payload) {
  const quality = payload?.run_quality_at_publish || {};
  const count = cleanNumber(payload?.count ?? payload?.total);
  return {
    runId: payload?.runId || payload?.latestRunId || "",
    ok: payload?.ok,
    status: payload?.status,
    qualityStatus: payload?.qualityStatus,
    count,
    resultCount: cleanNumber(payload?.resultCount ?? quality.resultCount ?? count),
    readbackCount: cleanNumber(payload?.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload?.expectedTotal),
    scannedCount: cleanNumber(payload?.scannedCount),
    publishAllowed: payload?.publishAllowed,
    runQualityPublishAllowed: quality.publishAllowed,
    evidenceStatus: payload?.evidenceStatus,
    unattendedStatus: payload?.unattendedStatus,
    fallbackUsed: payload?.fallbackUsed,
    sourceSnapshotCapturedAt: payload?.source_snapshot_captured_at,
    blankCounts: payload?.blankCounts,
    sampleMissingRows: payload?.sampleMissingRows,
  };
}

async function main() {
  const checks = [];
  const endpoints = {
    cbLatest: withFresh("/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60&live=1"),
    terminalFastBundle: withFresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1"),
    mobileFragment: withFresh("/api/mobile-fragment?tab=cb"),
    scorecard: withFresh("/api/scorecard?live=1"),
    sourceReports: withFresh("/api/source-reports"),
    page88: withFresh("/88.html"),
  };

  const [latest, bundle, mobile, scorecard, sourceReports, page88] = await Promise.all([
    fetchJson(endpoints.cbLatest).catch((error) => ({ ok: false, status: 0, url: endpoints.cbLatest, payload: { ok: false, error: error.message } })),
    fetchJson(endpoints.terminalFastBundle).catch((error) => ({ ok: false, status: 0, url: endpoints.terminalFastBundle, payload: { ok: false, error: error.message } })),
    fetchText(endpoints.mobileFragment, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.mobileFragment, text: "", error: error.message })),
    fetchJson(endpoints.scorecard).catch((error) => ({ ok: false, status: 0, url: endpoints.scorecard, payload: { ok: false, error: error.message } })),
    fetchJson(endpoints.sourceReports).catch((error) => ({ ok: false, status: 0, url: endpoints.sourceReports, payload: { ok: false, error: error.message } })),
    fetchText(endpoints.page88, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.page88, text: "", error: error.message })),
  ]);

  const payload = latest.payload || {};
  const runId = String(payload.runId || payload.latestRunId || "");
  const latestSummary = summarizeLatest(payload);

  issue(checks, latest.ok && payload.ok === true, "cb_latest_http_and_payload_ok", { status: latest.status, url: latest.url, ...latestSummary });
  issue(checks, /^cb-detect-\d{8}-\d+/.test(runId), "cb_latest_new_run_id_present", latestSummary);
  issue(checks, payload.qualityStatus === "complete" || payload.status === "ready", "cb_latest_quality_complete_or_ready", latestSummary);
  issue(checks, payload.publishAllowed === true || payload.run_quality_at_publish?.publishAllowed === true, "cb_latest_publish_allowed", latestSummary);
  issue(checks, payload.evidenceStatus === "complete", "cb_latest_evidence_complete", latestSummary);
  issue(checks, payload.unattendedStatus === "YES" || payload.unattended?.status === "YES", "cb_latest_unattended_yes", latestSummary);
  issue(checks, latestSummary.resultCount > 0 && latestSummary.readbackCount === latestSummary.resultCount, "cb_latest_result_readback_match", latestSummary);
  issue(checks, payload.fallbackUsed === false, "cb_latest_no_fallback", latestSummary);
  issue(checks, Boolean(payload.source_snapshot_captured_at), "cb_latest_source_snapshot_present", latestSummary);
  issue(checks, blankCountTotal(payload.blankCounts) === 0, "cb_latest_blank_counts_zero", latestSummary);
  issue(checks, Array.isArray(payload.sampleMissingRows) && payload.sampleMissingRows.length === 0, "cb_latest_sample_missing_rows_empty", latestSummary);

  const bundleCB = cbEndpoint(bundle.payload);
  const bundleRunId = String(bundleCB?.runId || bundleCB?.transport?.runId || "");
  issue(checks, bundle.ok && bundle.payload?.ok !== false, "terminal_fast_bundle_http_ok", { status: bundle.status, url: bundle.url });
  issue(checks, Boolean(bundleCB), "terminal_fast_bundle_cb_endpoint_present", { keys: Object.keys(bundle.payload?.endpoints || {}).filter((key) => key.includes("cb")) });
  issue(checks, bundleRunId === runId, "terminal_fast_bundle_cb_run_id_matches_latest", { expected: runId, actual: bundleRunId });
  issue(checks, bundleCB?.fallbackUsed !== true && bundleCB?.publishAllowed !== false, "terminal_fast_bundle_cb_not_blocked_or_fallback", {
    publishAllowed: bundleCB?.publishAllowed,
    fallbackUsed: bundleCB?.fallbackUsed,
    evidenceStatus: bundleCB?.evidenceStatus,
  });

  const mobileRunId = (mobile.text || "").match(/data-run-id="([^"]+)"/)?.[1] || "";
  issue(checks, mobile.ok, "mobile_fragment_http_ok", { status: mobile.status, url: mobile.url });
  issue(checks, (mobile.text || "").includes('data-mobile-fragment-key="cb"'), "mobile_fragment_cb_key_present", { runId: mobileRunId });
  issue(checks, mobileRunId === runId, "mobile_fragment_cb_run_id_matches_latest", { expected: runId, actual: mobileRunId });
  issue(checks, !(mobile.text || "").includes("publish blocked") && !(mobile.text || "").includes("evidence=insufficient"), "mobile_fragment_cb_not_showing_blocked", { runId: mobileRunId });

  const scorecardRow = findCbSourceReport(scorecard.payload);
  const sourceReportRow = findCbSourceReport(sourceReports.payload);
  issue(checks, scorecard.ok && scorecard.payload?.ok !== false, "scorecard_api_http_ok", { status: scorecard.status, url: scorecard.url, scorecardRunId: scorecard.payload?.runId || "" });
  issue(checks, Boolean(scorecardRow), "scorecard_api_cb_source_report_present", { row: scorecardRow });
  issue(checks, String(scorecardRow?.runId || "") === runId, "scorecard_api_cb_run_id_matches_latest", { expected: runId, actual: scorecardRow?.runId || "", row: scorecardRow });
  issue(checks, sourceReports.ok && sourceReports.status === 200, "source_reports_http_200", { status: sourceReports.status, url: sourceReports.url });
  issue(checks, Boolean(sourceReportRow), "source_reports_cb_row_present", { row: sourceReportRow });
  issue(checks, String(sourceReportRow?.runId || "") === runId, "source_reports_cb_run_id_matches_latest", { expected: runId, actual: sourceReportRow?.runId || "", row: sourceReportRow });

  issue(checks, page88.ok && (page88.text || "").includes("/api/scorecard"), "page88_http_ok_and_scorecard_hook_present", { status: page88.status, url: page88.url });

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    strategy: "cb",
    verifier: "verify-cb-e2e-closure",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    runId,
    readOnly: true,
    endpoints,
    latestSummary,
    surfaces: {
      latest: { status: latest.status, url: latest.url },
      terminalFastBundle: { status: bundle.status, runId: bundleRunId },
      mobileFragment: { status: mobile.status, runId: mobileRunId },
      scorecard: { status: scorecard.status, runId: scorecardRow?.runId || "" },
      sourceReports: { status: sourceReports.status, runId: sourceReportRow?.runId || "" },
      page88: { status: page88.status },
    },
    protectionEvidence: "covered_by_verify:cb-prewater-strict; live latest-pointer drill not part of this read-only display closure",
    checks,
    issues: checks.filter((check) => !check.ok).map((check) => check.code),
  };

  ensureDir(OUT_DIR);
  const outFile = path.join(OUT_DIR, "cb-e2e-closure.json");
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok, runId, outFile, issues: report.issues }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});



