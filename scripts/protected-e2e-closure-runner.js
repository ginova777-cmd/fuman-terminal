"use strict";

const fs = require("fs");
const path = require("path");
const {
  callInternalApi,
  endpointAccessibleOrProtected,
  isMembershipProtected,
  summarizeProtection,
  summarizeLatestPayload,
} = require("./e2e-membership-closure-utils");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function check(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

function blankCountTotal(blankCounts) {
  if (!blankCounts || typeof blankCounts !== "object") return Number.NaN;
  return Object.values(blankCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function textFromJson(result) {
  return result?.text || JSON.stringify(result?.payload || {});
}

function findEndpoint(bundle, startsWithPath) {
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  return endpoints[startsWithPath] || Object.entries(endpoints).find(([key]) => key.startsWith(startsWithPath))?.[1] || null;
}

function sourceReport(payload, config) {
  const reports = Array.isArray(payload?.sourceReports)
    ? payload.sourceReports
    : Array.isArray(payload?.reports)
      ? payload.reports
      : Array.isArray(payload)
        ? payload
        : [];
  return reports.find((row) => row?.key === config.sourceReportKey || config.sourceReportPattern.test(String(row?.strategy || row?.name || row?.label || row?.module || ""))) || null;
}

function productionLayerOk(result) {
  return endpointAccessibleOrProtected(result);
}

function runIdFromMobile(text) {
  return String(text || "").match(/data-run-id="([^"]+)"/)?.[1] || "";
}

async function runProtectedE2EClosure(config) {
  const outDir = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || config.outDir);
  const checks = [];
  const endpoints = {
    latest: withFresh(config.productionLatestPath),
    terminalFastBundle: withFresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70"),
    mobileFragment: withFresh(`/api/mobile-fragment?tab=${config.mobileTab}`),
    scorecard: withFresh("/api/scorecard?live=1"),
    sourceReports: withFresh("/api/source-reports"),
    page88: withFresh("/88.html"),
  };

  const internalLatest = await callInternalApi(config.apiModule, config.internalQuery).catch((error) => ({
    ok: false,
    status: 0,
    payload: { ok: false, error: error.message },
    text: "",
    internalVerify: true,
  }));
  const internalPayload = internalLatest.payload || {};
  const latestSummary = summarizeLatestPayload(internalPayload);
  const expectedRunId = String(latestSummary.runId || "");

  check(checks, internalLatest.internalVerify === true, "compute_layer_uses_internal_verify_not_public_guest", { module: config.apiModule, status: internalLatest.status });
  check(checks, internalLatest.ok && internalPayload.ok === true, "compute_latest_payload_ok", { status: internalLatest.status, latestSummary });
  check(checks, config.runIdPattern.test(expectedRunId), "compute_latest_run_id_present", { expectedRunId, latestSummary });
  check(checks, internalPayload.qualityStatus === "complete" || internalPayload.status === "ready", "compute_latest_quality_complete_or_ready", latestSummary);
  check(checks, internalPayload.publishAllowed === true || internalPayload.run_quality_at_publish?.publishAllowed === true, "compute_latest_publish_allowed", latestSummary);
  check(checks, internalPayload.evidenceStatus === "complete", "compute_latest_evidence_complete", latestSummary);
  check(checks, internalPayload.fallbackUsed === false, "compute_latest_no_fallback", latestSummary);
  check(checks, Boolean(internalPayload.source_snapshot_captured_at), "compute_latest_source_snapshot_present", latestSummary);
  if (internalPayload.blankCounts !== undefined) check(checks, blankCountTotal(internalPayload.blankCounts) === 0, "compute_latest_blank_counts_zero", { blankCounts: internalPayload.blankCounts });
  if (Array.isArray(internalPayload.sampleMissingRows)) check(checks, internalPayload.sampleMissingRows.length === 0, "compute_latest_sample_missing_rows_empty", { sampleMissingRows: internalPayload.sampleMissingRows });

  const [latest, bundle, mobile, scorecard, reports, page88] = await Promise.all([
    fetchJson(endpoints.latest).catch((error) => ({ ok: false, status: 0, url: endpoints.latest, payload: { ok: false, error: error.message }, text: "" })),
    fetchJson(endpoints.terminalFastBundle).catch((error) => ({ ok: false, status: 0, url: endpoints.terminalFastBundle, payload: { ok: false, error: error.message }, text: "" })),
    fetchText(endpoints.mobileFragment, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.mobileFragment, text: "", payload: { error: error.message } })),
    fetchJson(endpoints.scorecard).catch((error) => ({ ok: false, status: 0, url: endpoints.scorecard, payload: { ok: false, error: error.message }, text: "" })),
    fetchJson(endpoints.sourceReports).catch((error) => ({ ok: false, status: 0, url: endpoints.sourceReports, payload: { ok: false, error: error.message }, text: "" })),
    fetchText(endpoints.page88, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.page88, text: "", payload: { error: error.message } })),
  ]);

  const bundleEndpoint = findEndpoint(bundle.payload, config.endpointPath);
  const bundleRunId = String(bundleEndpoint?.runId || bundleEndpoint?.transport?.runId || "");
  const mobileRunId = runIdFromMobile(mobile.text || "");
  const scorecardRow = sourceReport(scorecard.payload, config);
  const reportRow = sourceReport(reports.payload, config);

  check(checks, productionLayerOk(latest), "display_latest_endpoint_public_or_membership_protected", summarizeProtection(latest));
  if (latest.ok) check(checks, String(latest.payload?.runId || latest.payload?.latestRunId || "") === expectedRunId, "display_latest_run_id_matches_compute_when_visible", { expectedRunId, actual: latest.payload?.runId || latest.payload?.latestRunId || "" });

  check(checks, productionLayerOk(bundle), "display_terminal_fast_bundle_public_or_membership_protected", summarizeProtection(bundle));
  if (bundle.ok && bundleEndpoint) check(checks, bundleRunId === expectedRunId, "display_terminal_fast_bundle_run_id_matches_compute_when_visible", { expectedRunId, actual: bundleRunId });
  if (bundle.ok) check(checks, !/membership_required/.test(textFromJson(bundle)) || bundle.payload?.membershipRequired === true, "display_terminal_fast_bundle_guest_payload_is_redacted_if_protected", summarizeProtection(bundle));

  const mobileProtected = mobile.status === 401 && (/membership_required/.test(mobile.text || "") || /data-membership-required="1"/.test(mobile.text || "") || /mobile-terminal-locked/.test(mobile.text || ""));
  check(checks, mobile.ok || mobileProtected, "display_mobile_fragment_public_or_membership_protected", { status: mobile.status, protectedByMembership: mobileProtected, url: mobile.url });
  if (mobile.ok && mobileRunId) check(checks, mobileRunId === expectedRunId, "display_mobile_fragment_run_id_matches_compute_when_visible", { expectedRunId, actual: mobileRunId });

  check(checks, productionLayerOk(scorecard), "display_scorecard_public_or_membership_protected", summarizeProtection(scorecard));
  if (scorecard.ok && scorecardRow) check(checks, String(scorecardRow.runId || "") === expectedRunId, "display_scorecard_row_run_id_matches_compute_when_visible", { expectedRunId, row: scorecardRow });

  check(checks, productionLayerOk(reports), "display_source_reports_public_or_membership_protected", summarizeProtection(reports));
  if (reports.ok && reportRow) check(checks, String(reportRow.runId || "") === expectedRunId, "display_source_reports_row_run_id_matches_compute_when_visible", { expectedRunId, row: reportRow });

  check(checks, page88.ok && /api\/scorecard|scorecard/i.test(page88.text || ""), "display_page88_shell_ok_with_scorecard_hook", { status: page88.status, url: page88.url });

  const ok = checks.every((item) => item.ok);
  const report = {
    ok,
    strategy: config.strategy,
    verifier: config.verifier,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    readOnly: true,
    membershipAware: true,
    rule: "membership gates only protect production display/data access; compute layer uses internal verified API payload and must not be inferred from guest 401",
    expectedRunId,
    endpoints,
    computeLayer: {
      status: internalLatest.status,
      internalVerify: internalLatest.internalVerify === true,
      module: config.apiModule,
      latestSummary,
    },
    displayLayer: {
      latest: summarizeProtection(latest),
      terminalFastBundle: { ...summarizeProtection(bundle), runId: bundleRunId || "" },
      mobileFragment: { status: mobile.status, ok: Boolean(mobile.ok), protectedByMembership: mobileProtected, runId: mobileRunId || "", url: mobile.url },
      scorecard: { ...summarizeProtection(scorecard), runId: scorecardRow?.runId || "" },
      sourceReports: { ...summarizeProtection(reports), runId: reportRow?.runId || "" },
      page88: { status: page88.status, ok: Boolean(page88.ok), url: page88.url },
    },
    checks,
    issues: checks.filter((item) => !item.ok).map((item) => item.code),
  };

  ensureDir(outDir);
  const outFile = path.join(outDir, config.outFile);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok, strategy: config.strategy, runId: expectedRunId, outFile, issues: report.issues }, null, 2));
  if (!ok) process.exit(1);
}

module.exports = { runProtectedE2EClosure };
