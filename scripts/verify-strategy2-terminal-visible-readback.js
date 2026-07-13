"use strict";

const fs = require("fs");
const path = require("path");
const { callInternalApi, summarizeLatestPayload } = require("./e2e-membership-closure-utils");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_DIR = path.join(ROOT, "outputs", "strategy2-terminal-visible-readback");
const OUT_FILE = path.join(OUT_DIR, "strategy2-terminal-visible-readback.json");
const BEARER_TOKEN = process.env.FUMAN_AUDIT_BEARER_TOKEN || "";
const COOKIE = process.env.FUMAN_AUDIT_COOKIE || "";

function fresh(pathname) {
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("t", String(Date.now()));
  return url.toString();
}

function auditHeaders() {
  const headers = { "Cache-Control": "no-cache" };
  if (BEARER_TOKEN) {
    headers.authorization = /^Bearer\s+/i.test(BEARER_TOKEN) ? BEARER_TOKEN : `Bearer ${BEARER_TOKEN}`;
    headers["x-fuman-member-session"] = "1";
  }
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

function mobileRunId(text) {
  return String(text || "").match(/data-run-id="([^"]+)"/)?.[1]
    || String(text || "").match(/strategy2-\d{8}-\d+/)?.[0]
    || "";
}

function check(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

async function main() {
  const checks = [];
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
  const terminalRedacted = bundle.status === 200 && bundle.payload?.membershipRequired === true && !bundleStrategy2;
  const mobileProtected = mobile.status === 401 && /membership_required|missing_bearer_token|mobile-terminal-locked/i.test(mobile.text || "");

  check(checks, internal.ok && /^strategy2-\d{8}-\d+/.test(expectedRunId), "compute_strategy2_run_id_present", { status: internal.status, expectedRunId, latestSummary });
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

  const report = {
    ok: checks.every((item) => item.ok),
    verifier: "verify-strategy2-terminal-visible-readback",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    expectedRunId,
    rule: "scorecard/sourceReports are audit evidence; terminal/mobile visible rows require actual Strategy2 endpoint or data-run-id and membership shell is not counted as visible display",
    authMode: BEARER_TOKEN ? "bearer" : COOKIE ? "cookie" : "none",
    readbacks: {
      terminalFastBundle: {
        status: bundle.status,
        membershipRequired: bundle.payload?.membershipRequired === true,
        endpointKeys: Object.keys(bundle.payload?.endpoints || {}),
        runId: bundleRunId,
      },
      mobileFragment: { status: mobile.status, protectedByMembership: mobileProtected, runId: mobileId },
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
