"use strict";

const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/strategy5-e2e-closure");

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

function strategy5Endpoint(bundle) {
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  return endpoints["/api/strategy5-latest"]
    || endpoints["/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70"]
    || Object.entries(endpoints).find(([key]) => key.startsWith("/api/strategy5-latest"))?.[1]
    || null;
}

function findStrategy5SourceReport(payload) {
  const reports = Array.isArray(payload?.sourceReports)
    ? payload.sourceReports
    : Array.isArray(payload?.reports)
      ? payload.reports
      : Array.isArray(payload)
        ? payload
        : [];
  return reports.find((row) => row?.key === "strategy5" || /策略5|籌碼|買賣超籌碼/.test(String(row?.strategy || row?.label || ""))) || null;
}

function latestBadSourceReceipt() {
  const dir = path.join(RUNTIME_DIR, "data", "scan-receipts");
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((name) => /^strategy5-live-bad-source-drill-.*\.json$/i.test(name) || /^strategy5-.*preserve.*\.json$/i.test(name))
      .map((name) => path.join(dir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {}
  const file = files[0] || "";
  return { file, receipt: file ? readJson(file) : null };
}

function summarizeLatest(payload) {
  const quality = payload?.run_quality_at_publish || {};
  return {
    runId: payload?.runId || payload?.latestRunId || "",
    ok: payload?.ok,
    status: payload?.status,
    qualityStatus: payload?.qualityStatus,
    count: cleanNumber(payload?.count),
    resultCount: cleanNumber(payload?.resultCount),
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
    strategy5Latest: withFresh("/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70&live=1"),
    terminalFastBundle: withFresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1"),
    mobileFragment: withFresh("/api/mobile-fragment?tab=strategy5"),
    scorecard: withFresh("/api/scorecard?live=1"),
    sourceReports: withFresh("/api/source-reports"),
    page88: withFresh("/88.html"),
  };

  const [latest, bundle, mobile, scorecard, sourceReports, page88] = await Promise.all([
    fetchJson(endpoints.strategy5Latest).catch((error) => ({ ok: false, status: 0, url: endpoints.strategy5Latest, payload: { ok: false, error: error.message } })),
    fetchJson(endpoints.terminalFastBundle).catch((error) => ({ ok: false, status: 0, url: endpoints.terminalFastBundle, payload: { ok: false, error: error.message } })),
    fetchText(endpoints.mobileFragment, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.mobileFragment, text: "", error: error.message })),
    fetchJson(endpoints.scorecard).catch((error) => ({ ok: false, status: 0, url: endpoints.scorecard, payload: { ok: false, error: error.message } })),
    fetchJson(endpoints.sourceReports).catch((error) => ({ ok: false, status: 0, url: endpoints.sourceReports, payload: { ok: false, error: error.message } })),
    fetchText(endpoints.page88, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.page88, text: "", error: error.message })),
  ]);

  const payload = latest.payload || {};
  const runId = String(payload.runId || payload.latestRunId || "");
  const latestSummary = summarizeLatest(payload);

  issue(checks, latest.ok && payload.ok === true, "strategy5_latest_http_and_payload_ok", { status: latest.status, url: latest.url, ...latestSummary });
  issue(checks, /^strategy5-\d{8}-\d+/.test(runId), "strategy5_latest_new_run_id_present", latestSummary);
  issue(checks, payload.qualityStatus === "complete" || payload.status === "ready", "strategy5_latest_quality_complete_or_ready", latestSummary);
  issue(checks, payload.publishAllowed === true || payload.run_quality_at_publish?.publishAllowed === true, "strategy5_latest_publish_allowed", latestSummary);
  issue(checks, payload.evidenceStatus === "complete", "strategy5_latest_evidence_complete", latestSummary);
  issue(checks, payload.unattendedStatus === "YES" || payload.unattended?.status === "YES", "strategy5_latest_unattended_yes", latestSummary);
  issue(checks, latestSummary.resultCount > 0 && latestSummary.readbackCount === latestSummary.resultCount, "strategy5_latest_result_readback_match", latestSummary);
  issue(checks, payload.fallbackUsed === false, "strategy5_latest_no_fallback", latestSummary);
  issue(checks, Boolean(payload.source_snapshot_captured_at), "strategy5_latest_source_snapshot_present", latestSummary);
  issue(checks, blankCountTotal(payload.blankCounts) === 0, "strategy5_latest_blank_counts_zero", latestSummary);
  issue(checks, Array.isArray(payload.sampleMissingRows) && payload.sampleMissingRows.length === 0, "strategy5_latest_sample_missing_rows_empty", latestSummary);

  const bundleStrategy5 = strategy5Endpoint(bundle.payload);
  const bundleRunId = String(bundleStrategy5?.runId || bundleStrategy5?.transport?.runId || "");
  issue(checks, bundle.ok && bundle.payload?.ok !== false, "terminal_fast_bundle_http_ok", { status: bundle.status, url: bundle.url });
  issue(checks, Boolean(bundleStrategy5), "terminal_fast_bundle_strategy5_endpoint_present", { keys: Object.keys(bundle.payload?.endpoints || {}).filter((key) => key.includes("strategy5")) });
  issue(checks, bundleRunId === runId, "terminal_fast_bundle_strategy5_run_id_matches_latest", { expected: runId, actual: bundleRunId });
  issue(checks, bundleStrategy5?.fallbackUsed !== true && bundleStrategy5?.publishAllowed !== false, "terminal_fast_bundle_strategy5_not_blocked_or_fallback", {
    publishAllowed: bundleStrategy5?.publishAllowed,
    fallbackUsed: bundleStrategy5?.fallbackUsed,
    evidenceStatus: bundleStrategy5?.evidenceStatus,
  });

  const mobileRunId = (mobile.text || "").match(/data-run-id="([^"]+)"/)?.[1] || "";
  issue(checks, mobile.ok, "mobile_fragment_http_ok", { status: mobile.status, url: mobile.url });
  issue(checks, (mobile.text || "").includes('data-mobile-fragment-key="strategy5"'), "mobile_fragment_strategy5_key_present", { runId: mobileRunId });
  issue(checks, mobileRunId === runId, "mobile_fragment_strategy5_run_id_matches_latest", { expected: runId, actual: mobileRunId });
  issue(checks, !(mobile.text || "").includes("publish blocked") && !(mobile.text || "").includes("evidence=insufficient"), "mobile_fragment_strategy5_not_showing_blocked", { runId: mobileRunId });

  const scorecardRow = findStrategy5SourceReport(scorecard.payload);
  const sourceReportRow = findStrategy5SourceReport(sourceReports.payload);
  issue(checks, scorecard.ok && scorecard.payload?.ok !== false, "scorecard_api_http_ok", { status: scorecard.status, url: scorecard.url, scorecardRunId: scorecard.payload?.runId || "" });
  issue(checks, Boolean(scorecardRow), "scorecard_api_strategy5_source_report_present", { row: scorecardRow });
  issue(checks, String(scorecardRow?.runId || "") === runId, "scorecard_api_strategy5_run_id_matches_latest", { expected: runId, actual: scorecardRow?.runId || "", row: scorecardRow });
  issue(checks, sourceReports.ok && sourceReports.status === 200, "source_reports_http_200", { status: sourceReports.status, url: sourceReports.url });
  issue(checks, Boolean(sourceReportRow), "source_reports_strategy5_row_present", { row: sourceReportRow });
  issue(checks, String(sourceReportRow?.runId || "") === runId, "source_reports_strategy5_run_id_matches_latest", { expected: runId, actual: sourceReportRow?.runId || "", row: sourceReportRow });

  issue(checks, page88.ok && (page88.text || "").includes("/api/scorecard"), "page88_http_ok_and_scorecard_hook_present", { status: page88.status, url: page88.url });

  const receipt = latestBadSourceReceipt();
  const drill = receipt.receipt || {};
  issue(checks, drill?.ok === true && drill?.after?.latestPointerUnchanged === true && drill?.after?.latestPointerUpdated === false && drill?.after?.emptyResultWritten === false, "strategy5_bad_source_preserves_previous_good", {
    file: receipt.file,
    before: drill.before,
    badSource: drill.badSource,
    after: drill.after,
  });

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    strategy: "strategy5",
    verifier: "verify-strategy5-e2e-closure",
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
    protectionReceipt: {
      file: receipt.file,
      before: drill.before || null,
      badSource: drill.badSource || null,
      after: drill.after || null,
    },
    checks,
    issues: checks.filter((check) => !check.ok).map((check) => check.code),
  };

  ensureDir(OUT_DIR);
  const outFile = path.join(OUT_DIR, "strategy5-e2e-closure.json");
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok, runId, outFile, issues: report.issues }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
