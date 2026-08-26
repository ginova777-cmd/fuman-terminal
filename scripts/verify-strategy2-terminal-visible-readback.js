"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { callInternalApi, summarizeLatestPayload } = require("./e2e-membership-closure-utils");
const { resolveProtectedReadbackCredential, protectedReadbackHeaders } = require("../lib/protected-readback-credential");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const OUT_DIR = path.join(RUNTIME_ROOT, "data", "scan-receipts");
const OUT_FILE = path.join(OUT_DIR, "strategy2-tri-surface-canonical-latest.json");
let bearerToken = process.env.FUMAN_AUDIT_BEARER_TOKEN || "";
const COOKIE = process.env.FUMAN_AUDIT_COOKIE || "";

function fresh(pathname) {
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("t", String(Date.now()));
  return url.toString();
}

function auditHeaders() {
  const headers = { "Cache-Control": "no-cache" };
  if (bearerToken) Object.assign(headers, protectedReadbackHeaders({ token: bearerToken }));
  if (COOKIE) headers.cookie = COOKIE;
  return headers;
}

async function fetchText(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: auditHeaders(),
      signal: controller.signal,
    });
    return { status: response.status, ok: response.ok, url, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 45000) {
  const result = await fetchText(url, timeoutMs);
  try {
    return { ...result, payload: JSON.parse(result.text) };
  } catch (error) {
    return { ...result, payload: { ok: false, error: "json_parse_failed", reason: error.message } };
  }
}

function sourceReport(payload) {
  const rows = Array.isArray(payload?.sourceReports)
    ? payload.sourceReports
    : Array.isArray(payload?.reports)
      ? payload.reports
      : [];
  return rows.find((row) => row?.key === "strategy2" || /strategy2|策略2|當沖/i.test(String(row?.strategy || row?.name || row?.label || ""))) || null;
}

function endpointForStrategy2(bundlePayload) {
  const endpoints = bundlePayload?.endpoints && typeof bundlePayload.endpoints === "object" ? bundlePayload.endpoints : {};
  const entries = Object.entries(endpoints);
  return entries.find(([key]) => key.startsWith("/api/latest-strategy?key=strategy2"))?.[1]
    || entries.find(([key]) => key.startsWith("/api/strategy2-latest"))?.[1]
    || null;
}

function mobileAttribute(text, name) {
  return String(text || "").match(new RegExp(`data-${name}="([^"]*)"`))?.[1] || "";
}

function mobileRunId(text) {
  return mobileAttribute(text, "run-id")
    || String(text || "").match(/strategy2-v3-live-\d{8}-(?:canonical|\d+)/)?.[0]
    || "";
}

function check(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

async function main() {
  const checks = [];
  if (!bearerToken && !COOKIE) {
    const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
    bearerToken = credential?.token || "";
  }

  if (process.platform === "win32") {
    const unified = spawnSync("schtasks", ["/Query", "/TN", "Fuman Strategy2 Unified 0845-1230", "/FO", "LIST"], { encoding: "utf8", windowsHide: true });
    const retired = ["Fuman Strategy2 V3 Water Gate 0845", "Fuman Strategy2 V2 Unattended", "Fuman Strategy2 V2 Recovery"]
      .map((name) => ({ name, status: spawnSync("schtasks", ["/Query", "/TN", name], { encoding: "utf8", windowsHide: true }).status }));
    check(checks, unified.status === 0, "unique_strategy2_schedule_present", { status: unified.status });
    check(checks, retired.every((item) => item.status !== 0), "retired_strategy2_schedules_absent", { retired });
  }
  const internal = await callInternalApi("api/strategy2-latest.js", { compact: "1", live: "1", today: "1", verify: "1" });
  const latestSummary = summarizeLatestPayload(internal.payload || {});
  const expectedRunId = String(latestSummary.runId || "");

  const [bundle, mobile, scorecard, reports, page88] = await Promise.all([
    fetchJson(fresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70")),
    fetchText(fresh("/api/mobile-fragment?tab=strategy2")),
    fetchJson(fresh("/api/scorecard?live=1"), 90000),
    fetchJson(fresh("/api/source-reports"), 90000),
    fetchText(fresh("/88.html")),
  ]);

  const bundleStrategy2 = endpointForStrategy2(bundle.payload);
  const bundleRunId = String(bundleStrategy2?.runId || bundleStrategy2?.payload?.runId || bundleStrategy2?.transport?.runId || "");
  const scorecardRow = sourceReport(scorecard.payload);
  const reportRow = sourceReport(reports.payload);
  const mobileId = mobileRunId(mobile.text);
  const mobileResultCount = Number(mobileAttribute(mobile.text, "result-count"));
  const expectedDate = String(internal.payload?.dataDate || internal.payload?.tradeDate || internal.payload?.date || "");
  const expectedResultCount = Number(internal.payload?.resultCount ?? latestSummary.resultCount ?? 0);
  const visibleFormal = internal.payload?.status === "complete"
    && internal.payload?.complete === true
    && internal.payload?.formalDisplayAllowed === true
    && internal.payload?.publishAllowed === true;
  const visibleBlocked = internal.payload?.status === "blocked"
    && internal.payload?.complete === false
    && internal.payload?.formalDisplayAllowed === false
    && internal.payload?.publishAllowed === false
    && internal.payload?.displayOnlyBlockedEvidence === true
    && Number(internal.payload?.expectedCount || 0) > 0
    && Number(internal.payload?.scannedCount || 0) > 0;
  const terminalRedacted = bundle.status === 200 && bundle.payload?.membershipRequired === true && !bundleStrategy2;
  const mobileProtected = mobile.status === 401 && /membership_required|missing_bearer_token|mobile-terminal-locked/i.test(mobile.text || "");

  check(checks, internal.ok && /^strategy2-v3-live-\d{8}-(?:canonical|\d+)$/.test(expectedRunId) && (visibleFormal || visibleBlocked), "compute_strategy2_visible_authority_valid", { status: internal.status, expectedRunId, latestSummary, visibleFormal, visibleBlocked });
  check(checks, scorecard.status === 200 && scorecardRow?.runId === expectedRunId, "scorecard_strategy2_row_run_id_matches", { status: scorecard.status, expectedRunId, row: scorecardRow });
  check(checks, reports.status === 200 && reportRow?.runId === expectedRunId, "source_reports_strategy2_row_run_id_matches", { status: reports.status, expectedRunId, row: reportRow });
  check(checks, page88.status === 200 && /api\/scorecard|sourceReports|scorecard/i.test(page88.text || ""), "page88_scorecard_hook_present", { status: page88.status, url: page88.url });
  check(checks, Boolean(bundleStrategy2), "terminal_fast_bundle_contains_strategy2_endpoint", {
    status: bundle.status,
    membershipRequired: bundle.payload?.membershipRequired === true,
    endpointKeys: Object.keys(bundle.payload?.endpoints || {}),
    issue: terminalRedacted ? "terminal_fast_bundle_redacted_no_strategy2_visible_rows" : "",
  });
  check(checks, Boolean(bundleStrategy2) && bundleRunId === expectedRunId, "terminal_fast_bundle_strategy2_run_id_matches", { expectedRunId, actual: bundleRunId, endpoint: bundleStrategy2 || null });
  check(checks, mobile.status === 200 && mobileId === expectedRunId, "mobile_fragment_strategy2_visible_run_id_matches", {
    status: mobile.status,
    protectedByMembership: mobileProtected,
    expectedRunId,
    actual: mobileId,
    issue: mobileProtected ? "mobile_fragment_membership_protected_no_visible_row" : "",
  });
  check(checks, expectedDate && bundleStrategy2?.dataDate === expectedDate && scorecardRow?.date === expectedDate && reportRow?.date === expectedDate, "tri_surface_trade_date_matches", { expectedDate, desktop: bundleStrategy2?.dataDate || "", scorecard: scorecardRow?.date || "", sourceReports: reportRow?.date || "" });
  check(checks, Number(bundleStrategy2?.resultCount) === expectedResultCount && Number(bundleStrategy2?.count) === expectedResultCount && Number(scorecardRow?.resultCount) === expectedResultCount && Number(scorecardRow?.count) === expectedResultCount && Number(reportRow?.resultCount) === expectedResultCount && Number(reportRow?.count) === expectedResultCount && mobileResultCount === expectedResultCount, "tri_surface_result_count_matches", { expectedResultCount, desktopCount: bundleStrategy2?.count, desktopResultCount: bundleStrategy2?.resultCount, mobileResultCount, scorecardCount: scorecardRow?.count, sourceReportCount: reportRow?.count });
  check(checks, visibleFormal || (visibleBlocked && scorecardRow?.publishAllowed === false && reportRow?.publishAllowed === false && String(scorecardRow?.blockedReason || "") !== ""), "blocked_evidence_fail_closed_or_formal_complete", { visibleFormal, visibleBlocked, scorecardPublishAllowed: scorecardRow?.publishAllowed, sourceReportPublishAllowed: reportRow?.publishAllowed, blockedReason: scorecardRow?.blockedReason || "" });

  const report = {
    ok: checks.every((item) => item.ok),
    verifier: "verify-strategy2-terminal-visible-readback",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    expectedRunId,
    contract: "strategy2-tri-surface-canonical-verifier-v1",
    authoritative: true,
    rule: "desktop, mobile and /88 must share tradeDate, runId and resultCount; blocked evidence is visible only when complete/formalDisplayAllowed/publishAllowed are false and scan coverage plus blocker are present",
    authMode: bearerToken ? "bearer" : COOKIE ? "cookie" : "none",
    readbacks: {
      terminalFastBundle: {
        status: bundle.status,
        membershipRequired: bundle.payload?.membershipRequired === true,
        endpointKeys: Object.keys(bundle.payload?.endpoints || {}),
        runId: bundleRunId,
      },
      mobileFragment: { status: mobile.status, protectedByMembership: mobileProtected, runId: mobileId, resultCount: mobileResultCount },
      scorecard: { status: scorecard.status, runId: scorecardRow?.runId || "", row: scorecardRow },
      sourceReports: { status: reports.status, runId: reportRow?.runId || "", row: reportRow },
      page88: { status: page88.status },
    },
    checks,
    issues: checks.filter((item) => !item.ok).map((item) => item.code),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: report.ok, runId: expectedRunId, outFile: OUT_FILE, issues: report.issues }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error("[strategy2-terminal-visible-readback] failed: " + (error.stack || error.message || error));
  process.exit(1);
});
