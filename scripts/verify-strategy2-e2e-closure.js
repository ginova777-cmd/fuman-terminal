const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/strategy2-e2e-closure");
const OLD_RUN_IDS = ["strategy2-20260707-124837", "strategy2-20260702-171437"];

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function withFresh(pathname) { const url = new URL(pathname, BASE_URL); url.searchParams.set("t", String(Date.now())); return url.toString(); }

async function fetchText(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, startedAt, finishedAt: new Date().toISOString(), url, text };
  } finally { clearTimeout(timer); }
}
async function fetchJson(url, timeoutMs = 45000) {
  const result = await fetchText(url, timeoutMs);
  let payload = null;
  try { payload = JSON.parse(result.text); } catch (error) { payload = { ok: false, error: "json_parse_failed", reason: error.message }; }
  return { ...result, payload };
}
function runIdsFromText(text) { return [...new Set([...String(text || "").matchAll(/strategy2-\d{8}-\d+/g)].map((match) => match[0]))]; }
function containsOldRunIds(text) { return OLD_RUN_IDS.filter((runId) => String(text || "").includes(runId)); }
function endpointFromBundle(bundle) {
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  return endpoints["/api/strategy2-latest"]
    || endpoints["/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=70"]
    || Object.entries(endpoints).find(([key]) => key.startsWith("/api/strategy2-latest"))?.[1]
    || Object.entries(endpoints).find(([key]) => key.startsWith("/api/latest-strategy") && /[?&]key=strategy2(?:&|$)/.test(key))?.[1]
    || null;
}
function strategy2Row(payload) {
  const reports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : [];
  const report = reports.find((row) => row?.key === "strategy2" || /strategy2|策略2|當沖/i.test(String(row?.strategy || row?.name || row?.label || "")));
  if (report) return report;
  const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.records) ? payload.records : [];
  return rows.find((row) => /strategy2|策略2|當沖/i.test(String(row?.strategy || row?.name || row?.label || row?.module || ""))) || null;
}
function check(checks, ok, code, evidence = {}) { checks.push({ ok: Boolean(ok), code, evidence }); }
function summarizeLatest(payload) {
  return {
    runId: payload?.runId || payload?.latestRunId || "",
    tradeDate: payload?.tradeDate || payload?.usedDate || "",
    ok: payload?.ok,
    qualityStatus: payload?.qualityStatus || "",
    publishAllowed: payload?.publishAllowed,
    publishBlocked: payload?.publishBlocked,
    evidenceStatus: payload?.evidenceStatus || payload?.sourceEvidenceStatus || "",
    unattendedStatus: payload?.unattendedStatus || payload?.unattended?.status || "",
    fallbackUsed: payload?.fallbackUsed,
    count: payload?.count,
    resultCount: payload?.resultCount,
    readbackCount: payload?.readbackCount,
    sourceSnapshotCapturedAt: payload?.source_snapshot_captured_at,
    warnings: payload?.warnings || [],
    issues: payload?.issues || [],
  };
}

async function main() {
  const endpoints = {
    strategy2Latest: withFresh("/api/strategy2-latest?compact=1&live=1&today=1&verify=1"),
    terminalFastBundle: withFresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70"),
    mobileFragment: withFresh("/api/mobile-fragment?tab=strategy2"),
    scorecard: withFresh("/api/scorecard?live=1"),
    sourceReports: withFresh("/api/source-reports"),
  };
  const [latest, bundle, mobile, scorecard, sourceReports] = await Promise.all([
    fetchJson(endpoints.strategy2Latest).catch((error) => ({ ok: false, status: 0, url: endpoints.strategy2Latest, payload: { ok: false, error: error.message }, text: "" })),
    fetchJson(endpoints.terminalFastBundle).catch((error) => ({ ok: false, status: 0, url: endpoints.terminalFastBundle, payload: { ok: false, error: error.message }, text: "" })),
    fetchText(endpoints.mobileFragment).catch((error) => ({ ok: false, status: 0, url: endpoints.mobileFragment, text: "", error: error.message })),
    fetchJson(endpoints.scorecard).catch((error) => ({ ok: false, status: 0, url: endpoints.scorecard, payload: { ok: false, error: error.message }, text: "" })),
    fetchJson(endpoints.sourceReports).catch((error) => ({ ok: false, status: 0, url: endpoints.sourceReports, payload: { ok: false, error: error.message }, text: "" })),
  ]);

  const checks = [];
  const latestSummary = summarizeLatest(latest.payload || {});
  const expectedRunId = latestSummary.runId;
  const bundleText = bundle.text || JSON.stringify(bundle.payload || {});
  const scorecardText = scorecard.text || JSON.stringify(scorecard.payload || {});
  const sourceReportsText = sourceReports.text || JSON.stringify(sourceReports.payload || {});
  const bundleStrategy2 = endpointFromBundle(bundle.payload);
  const allSurfaceRunIds = {
    strategy2Latest: runIdsFromText(latest.text || JSON.stringify(latest.payload || {})),
    terminalFastBundle: runIdsFromText(bundleText),
    mobileFragment: runIdsFromText(mobile.text),
    scorecard: runIdsFromText(scorecardText),
    sourceReports: runIdsFromText(sourceReportsText),
  };
  const scorecardRow = strategy2Row(scorecard.payload);
  const sourceReportRow = strategy2Row(sourceReports.payload);

  check(checks, latest.ok && latest.payload?.ok === true, "strategy2_latest_http_ok_and_payload_ok", { status: latest.status, url: latest.url, latestSummary });
  check(checks, Boolean(expectedRunId), "strategy2_latest_run_id_present", { latestSummary });
  check(checks, latestSummary.qualityStatus === "complete", "strategy2_latest_quality_complete", { latestSummary });
  check(checks, latestSummary.publishAllowed === true && latestSummary.publishBlocked !== true, "strategy2_latest_publish_allowed", { latestSummary });
  check(checks, latestSummary.evidenceStatus === "complete", "strategy2_latest_evidence_complete", { latestSummary });
  check(checks, latestSummary.unattendedStatus === "YES", "strategy2_latest_unattended_yes", { latestSummary });
  check(checks, latestSummary.fallbackUsed === false, "strategy2_latest_no_fallback", { latestSummary });
  check(checks, Number(latestSummary.count || latestSummary.resultCount || 0) > 0, "strategy2_latest_has_rows", { latestSummary });
  check(checks, Boolean(latestSummary.sourceSnapshotCapturedAt), "strategy2_latest_source_snapshot_present", { latestSummary });
  check(checks, containsOldRunIds(latest.text || JSON.stringify(latest.payload || {})).length === 0, "strategy2_latest_no_old_run_ids", { oldRunIdsFound: containsOldRunIds(latest.text || JSON.stringify(latest.payload || {})) });

  check(checks, bundle.ok && bundle.payload?.ok !== false, "terminal_fast_bundle_http_ok", { status: bundle.status, url: bundle.url });
  check(checks, Boolean(bundleStrategy2), "terminal_fast_bundle_strategy2_endpoint_present", { endpointKeys: Object.keys(bundle.payload?.endpoints || {}).filter((key) => key.includes("strategy2")) });
  check(checks, allSurfaceRunIds.terminalFastBundle.length === 1 && allSurfaceRunIds.terminalFastBundle[0] === expectedRunId, "terminal_fast_bundle_only_latest_strategy2_run_id", { expectedRunId, actualRunIds: allSurfaceRunIds.terminalFastBundle, oldRunIdsFound: containsOldRunIds(bundleText) });
  check(checks, bundleStrategy2?.fallbackUsed !== true, "terminal_fast_bundle_strategy2_no_fallback", { fallbackUsed: bundleStrategy2?.fallbackUsed, fallbackScope: bundleStrategy2?.fallbackScope });

  check(checks, mobile.ok, "mobile_fragment_http_ok", { status: mobile.status, url: mobile.url });
  check(checks, allSurfaceRunIds.mobileFragment.length === 1 && allSurfaceRunIds.mobileFragment[0] === expectedRunId, "mobile_fragment_only_latest_strategy2_run_id", { expectedRunId, actualRunIds: allSurfaceRunIds.mobileFragment, oldRunIdsFound: containsOldRunIds(mobile.text) });
  check(checks, /data-run-id="/.test(mobile.text || ""), "mobile_fragment_data_run_id_present", { expectedRunId, dataRunId: (mobile.text || "").match(/data-run-id="([^"]+)"/)?.[1] || "" });

  check(checks, scorecard.ok && scorecard.payload?.ok !== false, "scorecard_http_ok", { status: scorecard.status, url: scorecard.url, scorecardRunId: scorecard.payload?.runId || "" });
  check(checks, Boolean(scorecardRow), "scorecard_strategy2_row_present", { row: scorecardRow });
  check(checks, allSurfaceRunIds.scorecard.includes(expectedRunId) && containsOldRunIds(scorecardText).length === 0, "scorecard_contains_latest_and_no_old_strategy2_run_id", { expectedRunId, allStrategy2RunIds: allSurfaceRunIds.scorecard, oldRunIdsFound: containsOldRunIds(scorecardText), row: scorecardRow });

  check(checks, sourceReports.ok && sourceReports.status !== 404 && sourceReports.payload?.ok !== false, "source_reports_http_ok_not_404", { status: sourceReports.status, url: sourceReports.url, sourceReportsRunId: sourceReports.payload?.runId || "" });
  check(checks, Boolean(sourceReportRow), "source_reports_strategy2_row_present", { row: sourceReportRow });
  check(checks, allSurfaceRunIds.sourceReports.length === 1 && allSurfaceRunIds.sourceReports[0] === expectedRunId, "source_reports_only_latest_strategy2_run_id", { expectedRunId, actualRunIds: allSurfaceRunIds.sourceReports, oldRunIdsFound: containsOldRunIds(sourceReportsText) });

  const allSurfaceValues = Object.values(allSurfaceRunIds).flat();
  check(checks, allSurfaceValues.length >= 5 && allSurfaceValues.every((runId) => runId === expectedRunId), "all_surfaces_same_strategy2_run_id", { expectedRunId, allSurfaceRunIds });

  const ok = checks.every((item) => item.ok);
  const report = {
    ok,
    strategy: "strategy2",
    verifier: "verify-strategy2-e2e-closure",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    readOnly: true,
    expectedRunId,
    endpoints,
    latestSummary,
    surfaces: {
      strategy2Latest: { status: latest.status, runIds: allSurfaceRunIds.strategy2Latest },
      terminalFastBundle: { status: bundle.status, runIds: allSurfaceRunIds.terminalFastBundle },
      mobileFragment: { status: mobile.status, runIds: allSurfaceRunIds.mobileFragment },
      scorecard: { status: scorecard.status, runIds: allSurfaceRunIds.scorecard, row: scorecardRow },
      sourceReports: { status: sourceReports.status, runIds: allSurfaceRunIds.sourceReports, row: sourceReportRow },
    },
    oldRunIdsBlocked: OLD_RUN_IDS,
    checks,
    issues: checks.filter((item) => !item.ok),
  };
  ensureDir(OUT_DIR);
  const jsonFile = path.join(OUT_DIR, "strategy2-e2e-closure.json");
  fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[strategy2-e2e-closure] wrote ${jsonFile}`);
  console.log(`[strategy2-e2e-closure] runId=${expectedRunId || "missing"} checks=${checks.length} issues=${report.issues.map((item) => item.code).join(",") || "none"}`);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[strategy2-e2e-closure] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

