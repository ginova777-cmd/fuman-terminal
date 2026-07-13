"use strict";

const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const EXPECTED_RUN_ID = String(process.env.EXPECTED_STRATEGY5_RUN_ID || "").trim();
const RECEIPT_PATH = process.env.STRATEGY5_RECEIPT_PATH || "C:/fuman-runtime/data/scan-receipts/strategy5.json";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/strategy5-88-data-chain");

process.env.FUMAN_RUNTIME_DIR ||= "C:/fuman-runtime";
process.env.FUMAN_DATA_DIR ||= "C:/fuman-runtime/data";
process.env.FUMAN_CACHE_DIR ||= "C:/fuman-runtime/cache";
process.env.FUMAN_STATE_DIR ||= "C:/fuman-runtime/state";

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function blankCountTotal(blankCounts) {
  if (!blankCounts || typeof blankCounts !== "object") return Number.NaN;
  return Object.values(blankCounts).reduce((sum, value) => sum + cleanNumber(value), 0);
}

function responseCapture(resolve) {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode || 200, payload, text: JSON.stringify(payload), headers: this.headers }); return this; },
    send(body) {
      let payload = null;
      try { payload = typeof body === "string" ? JSON.parse(body) : body; } catch { payload = { html: String(body ?? "") }; }
      resolve({ status: this.statusCode || 200, payload, text: String(body ?? ""), headers: this.headers });
      return this;
    },
    end(body = "") { return this.send(body); },
  };
}

function callInternal(modulePath, url, query = {}) {
  return new Promise((resolve, reject) => {
    const handler = require(modulePath);
    Promise.resolve(handler({ method: "GET", url, query, headers: { host: "localhost" }, fumanInternalVerify: true }, responseCapture(resolve))).catch(reject);
  });
}

function strategy5FromBundle(payload) {
  const endpoints = payload?.endpoints && typeof payload.endpoints === "object" ? payload.endpoints : {};
  const key = Object.keys(endpoints).find((endpoint) => endpoint.startsWith("/api/strategy5-latest"));
  return key ? { endpoint: key, payload: endpoints[key] } : { endpoint: "", payload: null };
}

function strategy5SourceRow(payload) {
  const reports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : Array.isArray(payload?.reports) ? payload.reports : [];
  return reports.find((row) => row?.key === "strategy5" || /策略5/.test(String(row?.strategy || ""))) || null;
}

function mobileRunId(text) {
  return String(text || "").match(/strategy5-\d{8}-\d{14}/)?.[0] || "";
}

async function fetchText(pathname, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: controller.signal });
    return { status: response.status, ok: response.ok, text: await response.text(), contentType: response.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function summarizeStrategy5(row = {}) {
  return {
    runId: String(row.runId || row.latestRunId || row.transport?.runId || ""),
    count: cleanNumber(row.count),
    emittedRows: cleanNumber(row.emittedRows),
    resultCount: cleanNumber(row.resultCount),
    readbackCount: cleanNumber(row.readbackCount),
    expectedTotal: cleanNumber(row.expectedTotal),
    scannedCount: cleanNumber(row.scannedCount),
    publishAllowed: row.publishAllowed,
    evidenceStatus: row.evidenceStatus || "",
    fallbackUsed: row.fallbackUsed,
    blankCounts: row.blankCounts || {},
    sampleMissingRows: Array.isArray(row.sampleMissingRows) ? row.sampleMissingRows : [],
    cacheSource: row.cacheSource || "",
  };
}

function receiptRunId() {
  try {
    const receipt = JSON.parse(fs.readFileSync(RECEIPT_PATH, "utf8"));
    return receipt?.status === "complete" ? String(receipt.runId || "") : "";
  } catch { return ""; }
}

function addCheck(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const terminalRoot = process.env.FUMAN_TERMINAL_ROOT || "C:/fuman-terminal";
  const modules = {
    strategy5Latest: path.join(terminalRoot, "api", "strategy5-latest.js"),
    terminalFastBundle: path.join(terminalRoot, "api", "terminal-fast-bundle.js"),
    mobileFragment: path.join(terminalRoot, "api", "mobile-fragment.js"),
    scorecard: path.join(terminalRoot, "api", "scorecard.js"),
    sourceReports: path.join(terminalRoot, "api", "source-reports.js"),
  };

  const [latest, bundle] = await Promise.all([
    callInternal(modules.strategy5Latest, "/api/strategy5-latest?canvas=1&compact=1&shell=1&live=1&limit=70", { canvas: "1", compact: "1", shell: "1", live: "1", limit: "70" }),
    callInternal(modules.terminalFastBundle, "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=80", { canvas: "1", compact: "1", shell: "1", limit: "80" }),
  ]);
  const mobile = await callInternal(modules.mobileFragment, "/api/mobile-fragment?tab=strategy5&live=1", { tab: "strategy5", live: "1" });
  const [scorecard, sourceReports] = await Promise.all([
    callInternal(modules.scorecard, "/api/scorecard?live=1", { live: "1" }),
    callInternal(modules.sourceReports, "/api/source-reports?live=1", { live: "1" }),
  ]);
  const [prodBundle, prodLatest, prodMobile, prodScorecard, prodSourceReports, prod88] = await Promise.all([
    fetchText("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=80"),
    fetchText("/api/strategy5-latest?canvas=1&compact=1&shell=1&live=1&limit=70"),
    fetchText("/api/mobile-fragment?tab=strategy5&live=1"),
    fetchText("/api/scorecard?live=1"),
    fetchText("/api/source-reports?live=1"),
    fetchText("/88"),
  ]);

  const bundleStrategy5 = strategy5FromBundle(bundle.payload);
  const scorecardStrategy5 = strategy5SourceRow(scorecard.payload);
  const sourceReportsStrategy5 = strategy5SourceRow(sourceReports.payload);
  const summaries = {
    strategy5Latest: summarizeStrategy5(latest.payload),
    terminalFastBundle: summarizeStrategy5(bundleStrategy5.payload || {}),
    mobileFragment: { runId: mobileRunId(mobile.text), status: mobile.status },
    scorecard: summarizeStrategy5(scorecardStrategy5 || {}),
    sourceReports: summarizeStrategy5(sourceReportsStrategy5 || {}),
  };
  const runId = EXPECTED_RUN_ID || receiptRunId() || summaries.strategy5Latest.runId || summaries.sourceReports.runId;
  const prodPayloads = {
    terminalFastBundle: parseJson(prodBundle.text),
    strategy5Latest: parseJson(prodLatest.text),
    scorecard: parseJson(prodScorecard.text),
    sourceReports: parseJson(prodSourceReports.text),
  };
  const prodScorecardStrategy5 = strategy5SourceRow(prodPayloads.scorecard || {});
  const prodScorecardStrategy5RunId = String(prodScorecardStrategy5?.runId || "");
  const prodProtected = {
    strategy5Latest: prodLatest.status === 401 && prodPayloads.strategy5Latest?.protected === true && prodPayloads.strategy5Latest?.reason === "missing_bearer_token",
    mobileFragment: prodMobile.status === 401 && /mobile-terminal-locked|membership_required/.test(prodMobile.text || ""),
    scorecard: prodScorecard.status === 401 && prodPayloads.scorecard?.protected === true && prodPayloads.scorecard?.reason === "missing_bearer_token",
    scorecardPublicRunAligned: prodScorecard.status === 200 && prodScorecardStrategy5RunId === runId,
    sourceReports: prodSourceReports.status === 401 && prodPayloads.sourceReports?.protected === true && prodPayloads.sourceReports?.reason === "missing_bearer_token",
  };
  const prodBundleRedacted = prodBundle.status === 200 && prodPayloads.terminalFastBundle?.membershipRequired === true && !/strategy5-\d{8}-\d{14}/.test(prodBundle.text || "");

  const page88Local = fs.readFileSync(path.join(root, "88.html"), "utf8");
  const checks = [];
  addCheck(checks, /^strategy5-\d{8}-\d{14}$/.test(runId), "new_strategy5_run_id_present", { runId });
  addCheck(checks, !summaries.strategy5Latest.runId || summaries.strategy5Latest.runId === runId, "strategy5_latest_internal_run_id_or_blocked", summaries.strategy5Latest);
  addCheck(checks, summaries.strategy5Latest.expectedTotal > 0 || summaries.sourceReports.runId === runId, "strategy5_latest_or_source_report_expected_total", summaries.strategy5Latest);
  addCheck(checks, summaries.strategy5Latest.scannedCount === summaries.strategy5Latest.expectedTotal, "strategy5_latest_scanned_count", summaries.strategy5Latest);
  addCheck(checks, summaries.strategy5Latest.resultCount > 0 || summaries.sourceReports.resultCount > 0, "strategy5_latest_or_source_report_result_count", { latest: summaries.strategy5Latest, sourceReports: summaries.sourceReports });
  addCheck(checks, summaries.strategy5Latest.readbackCount === summaries.strategy5Latest.resultCount, "strategy5_latest_readback_count", summaries.strategy5Latest);
  addCheck(checks, summaries.strategy5Latest.publishAllowed === true || summaries.sourceReports.publishAllowed === true, "strategy5_latest_or_source_report_publish_allowed", { latest: summaries.strategy5Latest, sourceReports: summaries.sourceReports });
  addCheck(checks, summaries.strategy5Latest.evidenceStatus === "complete" || summaries.sourceReports.evidenceStatus === "complete", "strategy5_latest_or_source_report_evidence_complete", { latest: summaries.strategy5Latest, sourceReports: summaries.sourceReports });
  addCheck(checks, summaries.strategy5Latest.fallbackUsed === false, "strategy5_latest_no_fallback", summaries.strategy5Latest);
  addCheck(checks, blankCountTotal(summaries.strategy5Latest.blankCounts) === 0, "strategy5_latest_blank_counts_zero", summaries.strategy5Latest.blankCounts);
  addCheck(checks, summaries.strategy5Latest.sampleMissingRows.length === 0, "strategy5_latest_sample_missing_rows_empty", summaries.strategy5Latest.sampleMissingRows);
  addCheck(checks, summaries.terminalFastBundle.runId === runId, "terminal_fast_bundle_internal_run_id", { endpoint: bundleStrategy5.endpoint, ...summaries.terminalFastBundle });
  addCheck(checks, summaries.terminalFastBundle.resultCount === summaries.strategy5Latest.resultCount && summaries.terminalFastBundle.readbackCount === summaries.strategy5Latest.readbackCount, "terminal_fast_bundle_counts", summaries.terminalFastBundle);
  addCheck(checks, summaries.mobileFragment.runId === runId, "mobile_fragment_internal_run_id", summaries.mobileFragment);
  addCheck(checks, summaries.scorecard.runId === runId, "scorecard_source_row_internal_run_id", summaries.scorecard);
  addCheck(checks, summaries.sourceReports.runId === runId, "source_reports_internal_run_id", summaries.sourceReports);
  addCheck(checks, page88Local.includes("/api/scorecard?live=1") && page88Local.includes("data-source-report-run-id") && page88Local.includes("strategy5"), "page_88_scorecard_strategy5_data_chain_hook", {
    file: path.join(root, "88.html"),
    callsScorecard: page88Local.includes("/api/scorecard?live=1"),
    hasStrategy5SourceReportHook: page88Local.includes("data-source-report-run-id") && page88Local.includes("strategy5"),
  });
  addCheck(checks, prod88.status === 200 && prod88.text.includes("/api/scorecard?live=1"), "production_88_shell_calls_scorecard", {
    status: prod88.status,
    hasScorecardCall: prod88.text.includes("/api/scorecard?live=1"),
    hasRunIdInShell: /strategy5-\d{8}-\d{14}/.test(prod88.text || ""),
  });
  addCheck(checks, prodProtected.strategy5Latest && prodProtected.mobileFragment && (prodProtected.scorecard || prodProtected.scorecardPublicRunAligned) && prodProtected.sourceReports, "production_membership_or_public_scorecard_contract", { ...prodProtected, prodScorecardStrategy5RunId });
  addCheck(checks, prodBundleRedacted, "production_terminal_bundle_guest_redacted", {
    status: prodBundle.status,
    membershipRequired: prodPayloads.terminalFastBundle?.membershipRequired,
    hasRunIdInGuestPayload: /strategy5-\d{8}-\d{14}/.test(prodBundle.text || ""),
  });

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    verifier: "verify-strategy5-88-data-chain",
    generatedAt: new Date().toISOString(),
    runId,
    expectedTotal: summaries.strategy5Latest.expectedTotal,
    scannedCount: summaries.strategy5Latest.scannedCount,
    resultCount: summaries.strategy5Latest.resultCount,
    readbackCount: summaries.strategy5Latest.readbackCount,
    publishAllowed: summaries.strategy5Latest.publishAllowed,
    evidenceStatus: summaries.strategy5Latest.evidenceStatus,
    fallbackUsed: summaries.strategy5Latest.fallbackUsed,
    blankCounts: summaries.strategy5Latest.blankCounts,
    sampleMissingRows: summaries.strategy5Latest.sampleMissingRows,
    internalReadback: summaries,
    productionGuestReadback: {
      terminalFastBundle: { status: prodBundle.status, redacted: prodBundleRedacted },
      strategy5Latest: { status: prodLatest.status, protected: prodProtected.strategy5Latest },
      mobileFragment: { status: prodMobile.status, protected: prodProtected.mobileFragment },
      scorecard: { status: prodScorecard.status, protected: prodProtected.scorecard, publicRunAligned: prodProtected.scorecardPublicRunAligned, runId: prodScorecardStrategy5RunId },
      sourceReports: { status: prodSourceReports.status, protected: prodProtected.sourceReports },
      page88: { status: prod88.status, shellCallsScorecard: prod88.text.includes("/api/scorecard?live=1") },
    },
    checks,
    issues: checks.filter((check) => !check.ok),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, "strategy5-88-data-chain.json");
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[strategy5-88-data-chain] wrote ${outFile}`);
  console.log(`[strategy5-88-data-chain] ok=${ok} runId=${runId || "missing"} issues=${report.issues.map((item) => item.code).join(",") || "none"}`);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[strategy5-88-data-chain] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

