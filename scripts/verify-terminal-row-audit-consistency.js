"use strict";

const fs = require("fs");
const path = require("path");
const { callInternalApi } = require("./e2e-membership-closure-utils");
const { resolveProtectedReadbackCredential, protectedReadbackHeaders } = require("../lib/protected-readback-credential");

const strategy = String((process.argv.find((arg) => arg.startsWith("--strategy=")) || "").split("=")[1] || "").toLowerCase();
const configs = {
  strategy3: { module: "api/strategy3-latest.js", endpoint: "/api/strategy3-latest", tab: "strategy3", reportKey: "strategy3", limit: "240" },
  strategy4: { module: "api/strategy4-latest.js", endpoint: "/api/strategy4-latest", tab: "strategy4", reportKey: "strategy4", limit: "240" },
  strategy5: { module: "api/strategy5-latest.js", endpoint: "/api/strategy5-latest", tab: "strategy5", reportKey: "strategy5", limit: "240" },
  institution: { module: "api/institution-latest.js", endpoint: "/api/institution-latest", tab: "chip", reportKey: "institution", limit: "1200" },
};
const config = configs[strategy];
const baseUrl = String(process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const runtimeRoot = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";

function displayRows(payload = {}) {
  let empty = [];
  for (const key of ["currentCandidates", "records", "results", "matches", "rows", "data"]) {
    if (!Array.isArray(payload?.[key])) continue;
    if (payload[key].length) return payload[key];
    empty = payload[key];
  }
  return empty;
}

function rowAudit(payload = {}) {
  const rows = displayRows(payload);
  const signatures = [];
  let complete = true;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const symbol = String(row.code || row.symbol || row.stock_id || row.stockId || "").trim();
    const price = Number(row.entryPrice ?? row.price ?? row.close ?? row.observedPrice ?? row.latestSeenPrice ?? row.latestAPrice ?? row.firstAPrice ?? row.supportPrice);
    const score = Number(row.finalScore ?? row.score ?? row.rankScore ?? row.totalScore ?? row.baseScore ?? row.rank ?? row.ranking);
    const rank = Number(row.rank ?? row.ranking ?? row.priorityRank ?? row.sortRank ?? (index + 1));
    if (!symbol || !Number.isFinite(price) || !Number.isFinite(score) || !Number.isFinite(rank)) complete = false;
    signatures.push(`${symbol}:${Number.isFinite(price) ? price.toFixed(4) : "MISSING"}:${Number.isFinite(score) ? score.toFixed(4) : "MISSING"}:${Number.isFinite(rank) ? rank : "MISSING"}`);
  }
  return { signatures: signatures.sort(), count: rows.length, complete };
}

function decodeHtml(value = "") {
  return String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function mobileAudit(html = "") {
  const signatures = [];
  for (const match of String(html).matchAll(/<article class="mobile-terminal-row"([^>]*)>/g)) {
    const attrs = match[1] || "";
    const attr = (name) => decodeHtml(attrs.match(new RegExp(`data-${name}="([^"]*)"`))?.[1] || "");
    const symbol = attr("row-symbol");
    const price = Number(attr("row-price"));
    const score = Number(attr("row-score"));
    const rank = Number(attr("row-rank"));
    signatures.push(`${symbol}:${Number.isFinite(price) ? price.toFixed(4) : "MISSING"}:${Number.isFinite(score) ? score.toFixed(4) : "MISSING"}:${Number.isFinite(rank) ? rank : "MISSING"}`);
  }
  return signatures.sort();
}

function sourceReport(payload, key) {
  const rows = Array.isArray(payload?.sourceReports) ? payload.sourceReports : Array.isArray(payload?.reports) ? payload.reports : [];
  return rows.find((row) => String(row?.key || row?.strategy || "").toLowerCase() === key) || null;
}

function endpoint(bundle, startsWith) {
  return Object.entries(bundle?.endpoints || {}).find(([key]) => key.startsWith(startsWith))?.[1] || null;
}

function check(checks, ok, code, evidence = {}) { checks.push({ ok: Boolean(ok), code, evidence }); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

async function fetchText(url, headers, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", headers, signal: controller.signal });
    return { ok: response.ok, status: response.status, text: await response.text(), url };
  } finally { clearTimeout(timer); }
}

async function fetchJson(url, headers, timeoutMs = 60000) {
  const result = await fetchText(url, headers, timeoutMs);
  try { return { ...result, payload: JSON.parse(result.text) }; }
  catch { return { ...result, payload: { ok: false, error: "json_parse_failed" } }; }
}

async function main() {
  if (!config) throw new Error(`unsupported_strategy:${strategy || "missing"}`);
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
  const headers = { "Cache-Control": "no-cache", ...protectedReadbackHeaders({ token: credential?.token || "" }) };
  const query = { compact: "1", live: "1", today: "1", verify: "1", limit: config.limit };
  const internal = await callInternalApi(config.module, query);
  const expectedPayload = internal.payload || {};
  const expectedRunId = String(expectedPayload.runId || expectedPayload.latestRunId || "");
  const expectedDate = String(expectedPayload.tradeDate || expectedPayload.dataDate || expectedPayload.date || "");
  const expectedCount = Number(expectedPayload.resultCount ?? expectedPayload.count ?? 0);
  const expectedAudit = rowAudit(expectedPayload);
  const fresh = (pathname) => `${baseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const [bundle, mobile, scorecard, reports, page88] = await Promise.all([
    fetchJson(fresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70"), headers),
    fetchText(fresh(`/api/mobile-fragment?tab=${config.tab}`), headers),
    fetchJson(fresh("/api/scorecard?live=1"), headers, 90000),
    fetchJson(fresh("/api/source-reports"), headers, 90000),
    fetchText(fresh("/88.html"), headers),
  ]);
  const desktopPayload = endpoint(bundle.payload, config.endpoint);
  const desktopAudit = rowAudit(desktopPayload || {});
  const mobileSignatures = mobileAudit(mobile.text);
  const mobileRunId = String(mobile.text || "").match(/data-run-id="([^"]*)"/)?.[1] || "";
  const mobileCount = Number(String(mobile.text || "").match(/data-result-count="([^"]*)"/)?.[1] || 0);
  const scorecardRow = sourceReport(scorecard.payload, config.reportKey);
  const reportRow = sourceReport(reports.payload, config.reportKey);
  const scorecardSignatures = Array.isArray(scorecardRow?.rowAuditSignatures) ? [...scorecardRow.rowAuditSignatures].sort() : [];
  const reportSignatures = Array.isArray(reportRow?.rowAuditSignatures) ? [...reportRow.rowAuditSignatures].sort() : [];
  const checks = [];
  check(checks, internal.ok && Boolean(expectedRunId) && Boolean(expectedDate), "canonical_api_run_and_date_present", { status: internal.status, expectedRunId, expectedDate });
  check(checks, expectedAudit.count === expectedCount, "canonical_api_row_count_matches_result_count", { expectedCount, rowCount: expectedAudit.count });
  check(checks, expectedCount === 0 || expectedAudit.complete, "canonical_api_row_audit_fields_complete", { expectedAudit });
  check(checks, bundle.ok && desktopPayload && String(desktopPayload.runId || desktopPayload.latestRunId || "") === expectedRunId, "desktop_run_id_matches", { expectedRunId, actual: desktopPayload?.runId || "", status: bundle.status });
  check(checks, desktopAudit.count === expectedCount && same(desktopAudit.signatures, expectedAudit.signatures), "desktop_rows_match_canonical", { expected: expectedAudit, actual: desktopAudit });
  check(checks, mobile.ok && mobileRunId === expectedRunId && mobileCount === expectedCount, "mobile_run_id_and_count_match", { status: mobile.status, expectedRunId, mobileRunId, expectedCount, mobileCount });
  check(checks, same(mobileSignatures, expectedAudit.signatures), "mobile_rows_match_canonical", { expected: expectedAudit.signatures, actual: mobileSignatures });
  check(checks, scorecard.ok && scorecardRow?.runId === expectedRunId && Number(scorecardRow?.resultCount ?? scorecardRow?.count ?? 0) === expectedCount, "scorecard88_run_id_and_count_match", { status: scorecard.status, row: scorecardRow });
  check(checks, same(scorecardSignatures, expectedAudit.signatures), "scorecard88_rows_match_canonical", { expected: expectedAudit.signatures, actual: scorecardSignatures });
  check(checks, reports.ok && reportRow?.runId === expectedRunId && same(reportSignatures, expectedAudit.signatures), "source_reports_rows_match_canonical", { status: reports.status, row: reportRow });
  check(checks, page88.ok && /api\/scorecard|sourceReports|scorecard/i.test(page88.text || ""), "page88_canonical_scorecard_hook_present", { status: page88.status });
  const failed = checks.filter((item) => !item.ok);
  const report = {
    ok: failed.length === 0,
    status: failed.length ? "FAIL_CLOSED" : "PASS",
    contract: "terminal-four-surface-row-audit-v1",
    strategy,
    tradeDate: expectedDate,
    runId: expectedRunId,
    resultCount: expectedCount,
    rowAuditSignatures: expectedAudit.signatures,
    checks,
    failed_checks: failed.map((item) => item.code),
    first_blocker: failed[0]?.code || null,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    strategyRunStarted: false,
  };
  const outDir = path.join(runtimeRoot, "data", "scan-receipts");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `terminal-four-surface-row-audit-${strategy}-latest.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "FAIL_CLOSED", contract: "terminal-four-surface-row-audit-v1", strategy, failed_checks: ["verifier_exception"], first_blocker: error.message || String(error) }));
  process.exit(1);
});
