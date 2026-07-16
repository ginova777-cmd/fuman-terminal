const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/strategy4-postscan-closure");
const REQUIRE_LIVE_BLOCKED = process.argv.includes("--require-live-blocked");

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
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

async function fetchText(url, timeoutMs = 30000) {
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
      startedAt,
      finishedAt: new Date().toISOString(),
      url,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 30000) {
  const result = await fetchText(url, timeoutMs);
  let payload = null;
  try {
    payload = JSON.parse(result.text);
  } catch (error) {
    payload = { ok: false, error: "json_parse_failed", reason: error.message };
  }
  return { ...result, payload };
}

function responseCapture(resolve) {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ ok: this.statusCode < 400, status: this.statusCode || 200, payload, text: JSON.stringify(payload), headers: this.headers }); return this; },
    send(body) {
      let payload = null;
      try { payload = typeof body === "string" ? JSON.parse(body) : body; } catch { payload = { html: String(body ?? "") }; }
      resolve({ ok: this.statusCode < 400, status: this.statusCode || 200, payload, text: String(body ?? ""), headers: this.headers });
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
function issue(checks, ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

function blankCountTotal(blankCounts) {
  if (!blankCounts || typeof blankCounts !== "object") return Number.NaN;
  return Object.values(blankCounts).reduce((sum, value) => sum + cleanNumber(value), 0);
}

function strategy4Endpoint(bundle) {
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  return endpoints["/api/strategy4-latest"]
    || endpoints["/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70"]
    || Object.entries(endpoints).find(([key]) => key.startsWith("/api/strategy4-latest"))?.[1]
    || null;
}

function latestPreserveReceipt() {
  const dir = path.join(RUNTIME_DIR, "data", "scan-receipts");
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((name) => /^strategy4-bad-source-drill-.*\.json$/i.test(name) || /^strategy4-preserve-previous-good-.*\.json$/i.test(name))
      .map((name) => path.join(dir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {}
  const file = files[0] || "";
  const receipt = file ? readJson(file) : null;
  return { file, receipt };
}

function latestScorecardSource() {
  const candidates = [
    path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json"),
    path.join(process.cwd(), "data", "scorecard-latest.json"),
  ];
  for (const file of candidates) {
    const payload = readJson(file);
    if (payload && typeof payload === "object") return { file, payload };
  }
  return { file: "", payload: null };
}

function summarizeStrategy4(payload) {
  const runQuality = payload?.run_quality_at_publish || {};
  return {
    runId: payload?.runId || payload?.latestRunId || "",
    qualityStatus: payload?.qualityStatus || "",
    status: payload?.status || "",
    count: cleanNumber(payload?.count),
    resultCount: cleanNumber(payload?.resultCount),
    readbackCount: cleanNumber(payload?.readbackCount),
    expectedTotal: cleanNumber(payload?.expectedTotal),
    scannedCount: cleanNumber(payload?.scannedCount),
    publishAllowed: payload?.publishAllowed,
    runQualityPublishAllowed: runQuality.publishAllowed,
    fallbackUsed: payload?.fallbackUsed,
    fallbackAllowed: payload?.fallbackAllowed,
    fallbackScope: payload?.fallbackScope,
    fallbackContract: payload?.fallbackContract,
    sourceSnapshotCapturedAt: payload?.source_snapshot_captured_at,
    sourceStatusAtRun: payload?.source_status_at_run,
    requiredFields: payload?.requiredFields,
    blankCounts: payload?.blankCounts,
    sampleMissingRows: payload?.sampleMissingRows,
  };
}

async function main() {
  const checks = [];
  const endpoints = {
    strategy4Latest: withFresh("/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1"),
    mobileFragment: withFresh("/api/mobile-fragment?tab=strategy4"),
    terminalFastBundle: withFresh("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1"),
    scorecard: withFresh("/api/scorecard"),
    scorecardPage88: withFresh("/88.html"),
  };

  const [latest, mobile, bundle, scorecard, page88] = await Promise.all([
    fetchJson(endpoints.strategy4Latest, 45000).catch((error) => ({ ok: false, status: 0, url: endpoints.strategy4Latest, payload: { ok: false, error: error.message } })),
    fetchText(endpoints.mobileFragment, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.mobileFragment, text: "", error: error.message })),
    fetchJson(endpoints.terminalFastBundle, 45000).catch((error) => ({ ok: false, status: 0, url: endpoints.terminalFastBundle, payload: { ok: false, error: error.message } })),
    fetchJson(endpoints.scorecard, 45000).catch((error) => ({ ok: false, status: 0, url: endpoints.scorecard, payload: { ok: false, error: error.message } })),
    fetchText(endpoints.scorecardPage88, 30000).catch((error) => ({ ok: false, status: 0, url: endpoints.scorecardPage88, text: "", error: error.message })),
  ]);

  const terminalRoot = process.env.FUMAN_TERMINAL_ROOT || "C:/fuman-terminal";
  const latestProtectedByMembership = latest.status === 401 && latest.payload?.protected === true && latest.payload?.reason === "missing_bearer_token";
  const internalLatest = latest.ok ? latest : await callInternal(
    path.join(terminalRoot, "api", "strategy4-latest.js"),
    "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1",
    { canvas: "1", compact: "1", shell: "1", limit: "70", live: "1" },
  );
  const payload = (latest.ok ? latest.payload : internalLatest.payload) || {};
  const mobileProtectedByMembership = mobile.status === 401 && /mobile-terminal-locked|membership_required/.test(mobile.text || "");
  const productionBundleRedacted = bundle.status === 200 && bundle.payload?.membershipRequired === true;
  const internalBundle = productionBundleRedacted ? await callInternal(
    path.join(terminalRoot, "api", "terminal-fast-bundle.js"),
    "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1",
    { canvas: "1", compact: "1", shell: "1" },
  ) : bundle;
  const bundlePayload = internalBundle.payload || bundle.payload || {};
  const runId = String(payload.runId || payload.latestRunId || "");
  const latestSummary = summarizeStrategy4(payload);

  issue(checks, (latest.ok && payload.ok !== false) || (latestProtectedByMembership && internalLatest.status === 200 && payload.ok !== false), "production_strategy4_latest_http_ok", { status: latest.status, protectedByMembership: latestProtectedByMembership, internalStatus: internalLatest.status, url: latest.url });
  issue(checks, Boolean(runId), "production_strategy4_latest_run_id_present", latestSummary);
  issue(checks, payload.qualityStatus === "complete", "production_strategy4_quality_complete", latestSummary);
  issue(checks, payload.publishAllowed !== false && payload.run_quality_at_publish?.publishAllowed !== false, "production_strategy4_publish_allowed", latestSummary);
  issue(checks, payload.fallbackUsed === false && payload.fallbackAllowed === false && payload.fallbackContract === "strategy4-fallback-disclosure-v1", "production_strategy4_fallback_hidden_formal", latestSummary);
  issue(checks, Boolean(payload.source_snapshot_captured_at), "production_strategy4_source_snapshot_present", latestSummary);
  issue(checks, payload.source_status_at_run && typeof payload.source_status_at_run === "object", "production_strategy4_source_status_present", latestSummary);
  issue(checks, cleanNumber(payload.resultCount) > 0 && cleanNumber(payload.readbackCount) === cleanNumber(payload.resultCount), "production_strategy4_readback_count_match", latestSummary);
  issue(checks, Array.isArray(payload.requiredFields) && payload.requiredFields.length >= 10, "production_strategy4_required_fields_present", latestSummary);
  issue(checks, blankCountTotal(payload.blankCounts) === 0, "production_strategy4_blank_counts_zero", latestSummary);
  issue(checks, Array.isArray(payload.sampleMissingRows) && payload.sampleMissingRows.length === 0, "production_strategy4_sample_missing_rows_empty", latestSummary);

  const mobileRunId = (mobile.text || "").match(/data-run-id="([^"]+)"/)?.[1] || "";
  issue(checks, mobile.ok || mobileProtectedByMembership, "mobile_fragment_http_ok", { status: mobile.status, protectedByMembership: mobileProtectedByMembership, url: mobile.url });
  issue(checks, mobileProtectedByMembership || (mobile.text || "").includes('data-mobile-fragment-key="strategy4"'), "mobile_fragment_strategy4_key_present", { runId: mobileRunId, protectedByMembership: mobileProtectedByMembership });
  issue(checks, mobileProtectedByMembership || mobileRunId === runId, "mobile_fragment_run_id_matches_strategy4_latest", { expected: runId, actual: mobileRunId, protectedByMembership: mobileProtectedByMembership });
  issue(checks, !(mobile.text || "").includes("formal YES") && !(mobile.text || "").includes("unattended YES"), "mobile_fragment_does_not_show_fake_yes", { runId: mobileRunId });

  const bundleStrategy4 = strategy4Endpoint(bundlePayload);
  const bundleRunId = String(bundleStrategy4?.runId || bundleStrategy4?.transport?.runId || "");
  issue(checks, bundle.ok && (bundle.payload?.ok !== false || productionBundleRedacted), "terminal_fast_bundle_http_ok", { status: bundle.status, redacted: productionBundleRedacted, internalStatus: internalBundle.status, url: bundle.url });
  issue(checks, Boolean(bundleStrategy4), "terminal_fast_bundle_strategy4_endpoint_present", { endpointKeys: Object.keys(bundlePayload?.endpoints || {}).filter((key) => key.includes("strategy4")), redacted: productionBundleRedacted });
  issue(checks, bundleRunId === runId, "terminal_fast_bundle_run_id_matches_strategy4_latest", { expected: runId, actual: bundleRunId });
  issue(checks, bundleStrategy4?.fallbackUsed !== true, "terminal_fast_bundle_strategy4_no_fallback", { fallbackUsed: bundleStrategy4?.fallbackUsed, fallbackScope: bundleStrategy4?.fallbackScope });

  const localHtml88 = readText(path.join(process.cwd(), "88.html"));
  const productionHtml88 = page88.text || "";
  issue(checks, localHtml88.includes("/api/scorecard?live=1") && localHtml88.includes("scorecardStrategy4Live"), "scorecard_88_local_strategy4_live_hook_present", {
    file: path.join(process.cwd(), "88.html"),
    hook: "scorecardStrategy4Live",
    endpoint: "/api/scorecard?live=1",
  });
  issue(checks, page88.ok && productionHtml88.includes("/api/scorecard?live=1") && productionHtml88.includes("scorecardStrategy4Live"), "scorecard_88_production_strategy4_live_hook_present", {
    status: page88.status,
    url: page88.url,
    hook: "scorecardStrategy4Live",
    endpoint: "/api/scorecard?live=1",
  });
  const scorecardProtectedByMembership = scorecard.status === 401 && scorecard.payload?.protected === true && scorecard.payload?.error === "membership_required";
  issue(checks, (scorecard.ok && scorecard.payload?.ok !== false) || scorecardProtectedByMembership, "scorecard_api_http_ok", { status: scorecard.status, protectedByMembership: scorecardProtectedByMembership, url: scorecard.url, runId: scorecard.payload?.runId || "" });
  const scorecardSource = latestScorecardSource();
  const scorecardSourceReports = Array.isArray(scorecard.payload?.sourceReports) && scorecard.payload.sourceReports.length
    ? scorecard.payload.sourceReports
    : Array.isArray(scorecardSource.payload?.sourceReports)
      ? scorecardSource.payload.sourceReports
      : [];
  const scorecardStrategy4Row = scorecardSourceReports.find((row) => row?.key === "strategy4" || /策略4/.test(String(row?.strategy || ""))) || null;
  const scorecardStrategy4RunId = String(scorecardStrategy4Row?.runId || "");
  issue(checks, Boolean(scorecardStrategy4Row), "scorecard_88_strategy4_source_row_present", {
    scorecardApiHasSourceReports: Array.isArray(scorecard.payload?.sourceReports),
    fallbackSourceFile: scorecardSource.file || "",
  });
  issue(checks, scorecardStrategy4RunId === runId, "scorecard_88_strategy4_row_run_id_matches_strategy4_latest", {
    expected: runId,
    actual: scorecardStrategy4RunId,
    sourcePath: Array.isArray(scorecard.payload?.sourceReports) && scorecard.payload.sourceReports.length
      ? "/api/scorecard.sourceReports[key=strategy4].runId"
      : `${scorecardSource.file || "missing"}.sourceReports[key=strategy4].runId`,
    row: scorecardStrategy4Row,
  });

  const preserve = latestPreserveReceipt();
  const receipt = preserve.receipt || {};
  const protection = receipt.protectionDecision && typeof receipt.protectionDecision === "object"
    ? receipt.protectionDecision
    : receipt;
  const blockedNewPublish = protection.blockedNewPublish === true || protection.publishAllowed === false || receipt.blockedDecision?.publishAllowed === false;
  const preserveOk = (protection.preservedPreviousGood === true || protection.preservePreviousGood === true)
    && blockedNewPublish
    && protection.latestPointerUpdatedByBadSource === false
    && protection.emptyResultOverwroteGoodRun === false;
  issue(checks, preserveOk, "strategy4_preserve_previous_good_receipt_valid", {
    file: preserve.file || "",
    badSourceRunId: receipt.badSourceRunId || "",
    previousGoodRunId: receipt.previousGood?.runId || receipt.previousGoodRunId || receipt.previousGoodRunId || "",
    preservedPreviousGood: protection.preservedPreviousGood ?? protection.preservePreviousGood,
    latestPointerUpdatedByBadSource: protection.latestPointerUpdatedByBadSource,
    emptyResultOverwroteGoodRun: protection.emptyResultOverwroteGoodRun,
    evidenceScope: receipt.evidenceScope || "historical_receipt",
  });
  issue(checks, !REQUIRE_LIVE_BLOCKED || String(receipt.evidenceScope || "").startsWith("current_live_"), "strategy4_current_live_bad_source_receipt_required", {
    required: REQUIRE_LIVE_BLOCKED,
    actualEvidenceScope: receipt.evidenceScope || "historical_receipt_or_not_declared",
  });

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    strategy: "strategy4",
    verifier: "verify-strategy4-postscan-closure",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    readOnly: true,
    endpoints,
    runId,
    latestSummary,
    surfaces: {
      productionApi: { status: latest.status, runId },
      mobile: { status: mobile.status, runId: mobileRunId },
      desktopFastBundle: { status: bundle.status, runId: bundleRunId },
      scorecard88: {
        localSourceFileHook: localHtml88.includes("scorecardStrategy4Live"),
        productionPageHook: productionHtml88.includes("scorecardStrategy4Live"),
        pageStatus: page88.status,
        scorecardStatus: scorecard.status,
        scorecardRunId: scorecard.payload?.runId || "",
        strategy4RowRunId: scorecardStrategy4RunId,
        strategy4RowSource: Array.isArray(scorecard.payload?.sourceReports) && scorecard.payload.sourceReports.length
          ? "/api/scorecard.sourceReports"
          : scorecardSource.file || "",
      },
    },
    failClosedEvidence: {
      latestPointerBadSourceBeforeAfter: receipt.evidenceScope || (REQUIRE_LIVE_BLOCKED ? "required_by_flag" : "not_run_current_round"),
      preserveReceiptPath: preserve.file || "",
      preserveReceiptScope: preserveOk ? (receipt.evidenceScope || "historical_receipt") : "missing_or_invalid",
      preserveReceipt: receipt,
    },
    checks,
    issues: checks.filter((check) => !check.ok),
  };

  ensureDir(OUT_DIR);
  const jsonFile = path.join(OUT_DIR, "strategy4-postscan-closure.json");
  fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[strategy4-postscan-closure] wrote ${jsonFile}`);
  console.log(`[strategy4-postscan-closure] runId=${runId || "missing"} checks=${checks.length} issues=${report.issues.map((item) => item.code).join(",") || "none"}`);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[strategy4-postscan-closure] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
