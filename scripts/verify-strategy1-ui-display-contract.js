"use strict";

const fs = require("fs");
const path = require("path");
const openBuyApi = require("../api/open-buy-latest");
const scanner = require("./scan-open-buy-cache");
const { attachRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_FILE = path.join(ROOT, "data/contracts/strategy1-ui-display-matrix.json");

const MATRIX_COLUMNS = [
  "uiSurface",
  "routeOrEndpoint",
  "rendererFile",
  "apiEndpointUsed",
  "forbiddenStaticPaths",
  "displayedFields",
  "requiredDisplayedFields",
  "uiBlankHandling",
  "degradedDisplayRule",
  "fallbackDisplayRule",
  "previousGoodDisplayRule",
  "verifierCommand",
  "negativeTest",
];

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function hasCompleteWriteBudget(value) {
  return isObject(value)
    && typeof value.ok === "boolean"
    && Number.isFinite(Number(value.limit))
    && Number.isFinite(Number(value.used))
    && Number.isFinite(Number(value.remaining))
    && typeof value.allowed === "boolean"
    && typeof value.finalStatus === "string"
    && value.finalStatus.length > 0;
}

function baseScannerOutput(rows = [{ code: "2330", name: "台積電", decision: "BUY", reason: "contract sample", score: 98 }], overrides = {}) {
  const output = {
    ok: true,
    source: "strategy1-ui-display-contract",
    runId: "strategy1-ui-display-20260704",
    startedAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:01:00.000Z",
    usedDate: "20260704",
    complete: true,
    scanStatus: "complete",
    total: rows.length,
    scannedThisRun: rows.length,
    scannedCodes: rows.map((row) => row.code).filter(Boolean),
    count: rows.length,
    resultCount: rows.length,
    rows,
    matches: rows,
    sourceCoverage: {
      status: "ready",
      ok: true,
      fresh_quote_coverage_120s: 1,
      quote_age_seconds: 30,
      active_symbols: rows.length,
      fresh_quotes: rows.length,
      intraday_1m_status: "not_applicable",
      ma_status: "not_applicable",
      dailyVolumeStatus: "not_applicable",
      preopenStatus: "ready",
      futoptStatus: "ready",
    },
    writeBudget: { ok: true, limit: 1, used: 1, remaining: 0, allowed: true, finalStatus: "write-accepted" },
    retentionOk: true,
    ...overrides,
  };
  const audit = scanner.buildStrategy1BusinessFieldAudit(Array.isArray(output.rows) ? output.rows : []);
  return {
    ...output,
    requiredFields: output.requiredFields || audit.requiredFields,
    blankCounts: output.blankCounts || audit.blankCounts,
    sampleMissingRows: output.sampleMissingRows || audit.sampleMissingRows,
  };
}

function sampleRows() {
  return [
    {
      run_id: "strategy1-ui-display-20260704",
      strategy: "strategy1",
      scan_date: "2026-07-04",
      code: "2330",
      name: "台積電",
      price: 1000,
      close: 1000,
      change_percent: 1.2,
      volume: 10000,
      trade_volume: 10000,
      trade_value: 10000000,
      score: 98,
      rank: 1,
      reason: "contract sample",
      signals: [],
      payload: { code: "2330", name: "台積電", decision: "BUY", reason: "contract sample", score: 98 },
      decision: "BUY",
      block_reason: "",
      setup_type: "contract",
      complete: true,
      quality_status: "complete",
      generated_at: "2026-07-04T00:00:00.000Z",
      updated_at: "2026-07-04T00:00:00.000Z",
    },
  ];
}

function status(overrides = {}) {
  return {
    decision_ready: true,
    is_trading_day: true,
    latest_trading_day: "2026-07-04",
    trade_date: "2026-07-04",
    last_error: "",
    ...overrides,
  };
}

function buildFormalPayload({ scannerOutput = baseScannerOutput(), rows = sampleRows(), runStatus = status(), options = {}, payloadOverrides = {} } = {}) {
  const run = scanner.buildOpenBuyRunRow(scannerOutput, scannerOutput.runId);
  const raw = openBuyApi.__contract.buildPayload(rows, run, runStatus, options);
  return attachRunTimeSourceEvidence({ ...raw, ...payloadOverrides }, { strategy: "strategy1", endpoint: "api/open-buy-latest" });
}

function result(label, ok, details = {}) {
  return { label, ok: Boolean(ok), ...details };
}

function verifyMatrixShape(matrix) {
  const issues = [];
  if (!Array.isArray(matrix) || matrix.length === 0) issues.push("ui_display_matrix_empty");
  matrix.forEach((row, index) => {
    for (const column of MATRIX_COLUMNS) {
      if (!(column in row)) issues.push(`row_${index}_missing_${column}`);
    }
    if (row.apiEndpointUsed !== "/api/open-buy-latest") issues.push(`row_${index}_wrong_strategy1_endpoint`);
    if (!Array.isArray(row.forbiddenStaticPaths) || row.forbiddenStaticPaths.length === 0) issues.push(`row_${index}_missing_forbidden_static_paths`);
    if (!Array.isArray(row.requiredDisplayedFields) || row.requiredDisplayedFields.length === 0) issues.push(`row_${index}_missing_required_displayed_fields`);
  });
  return result("ui_display_matrix_shape", issues.length === 0, { issues });
}

function verifyStaticUiEndpoints(matrix) {
  const issues = [];
  const checkedFiles = [...new Set(matrix.map((row) => row.rendererFile))];
  const files = Object.fromEntries(checkedFiles.map((file) => [file, readText(file)]));
  for (const row of matrix) {
    const text = files[row.rendererFile] || "";
    const routeLoaderText = row.rendererFile === "terminal-open-buy-view.js"
      ? `${readText("terminal-app.js")}\n${files["terminal-runtime-config.js"] || ""}`
      : "";
    if (!text.includes(row.apiEndpointUsed) && !routeLoaderText.includes(row.apiEndpointUsed)) {
      issues.push(`${row.rendererFile}_missing_${row.apiEndpointUsed}`);
    }
    for (const forbidden of row.forbiddenStaticPaths || []) {
      if (text.includes(forbidden)) issues.push(`${row.rendererFile}_uses_forbidden_${forbidden}`);
    }
  }
  const desktop = files["terminal-open-buy-view.js"] || "";
  if (!desktop.includes("candidate_2130_futopt_0845")) issues.push("desktop_missing_0845_futopt_stage_card");
  if (!desktop.includes("openBuyStageCards")) issues.push("desktop_missing_stage_cards_source");
  const fastBundle = files["api/terminal-fast-bundle.js"] || "";
  if (!fastBundle.includes("previous_2130_carry_forward")) issues.push("fast_bundle_missing_previous_good_marker");
  if (!fastBundle.includes("fastBundleRepair")) issues.push("fast_bundle_missing_repair_disclosure");
  const mobile = files["api/mobile-fragment.js"] || "";
  if (!mobile.includes("data-run-id")) issues.push("mobile_missing_run_id_display");
  if (!mobile.includes("isEmptyStrategy1WaitingSnapshot")) issues.push("mobile_missing_strategy1_empty_waiting_guard");
  const runtime = files["terminal-runtime-config.js"] || "";
  if (!runtime.includes('openBuyCache: "/api/open-buy-latest"')) issues.push("runtime_openBuyCache_not_api_latest");
  return result("ui_static_endpoint_contract", issues.length === 0, { checkedFiles, issues });
}

function verifyFormalPayloadForDisplay() {
  const payload = buildFormalPayload();
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const issues = [];
  if (!payload.runId) issues.push("runId_missing");
  if (!payload.usedDate && !payload.tradeDate) issues.push("tradeDate_missing");
  if (cleanNumber(payload.count ?? payload.resultCount ?? rows.length) <= 0) issues.push("count_missing");
  if (!Array.isArray(payload.stageCards) || !payload.stageCards.some((card) => card.key === "candidate_2130_futopt_0845")) {
    issues.push("stageCards_missing_candidate_2130_futopt_0845");
  }
  if (!hasCompleteWriteBudget(payload.writeBudget)) issues.push("writeBudget_incomplete");
  if (payload.retentionOk !== true) issues.push("retentionOk_not_true");
  if (payload.publishAllowed !== true) issues.push("publishAllowed_not_true_for_ready_payload");
  if (payload.unattendedStatus !== "YES") issues.push("unattendedStatus_not_yes_for_ready_payload");
  return result("ui_formal_payload_display_fields", issues.length === 0, {
    runId: payload.runId,
    count: payload.count ?? payload.resultCount ?? rows.length,
    stageKeys: Array.isArray(payload.stageCards) ? payload.stageCards.map((card) => card.key).slice(0, 6) : [],
    issues,
  });
}

function verifyNegativeDegradedPayloadBlocksLatest() {
  const blankRows = [{ code: "2330", name: "", decision: "BUY", reason: "contract sample", score: 98 }];
  const scannerOutput = baseScannerOutput(blankRows);
  const payload = buildFormalPayload({ scannerOutput });
  const issues = [];
  if (payload.evidenceStatus !== "source_quality_fail" && payload.evidenceStatus !== "insufficient") issues.push("evidenceStatus_not_insufficient");
  if (payload.unattendedStatus !== "NO") issues.push("unattendedStatus_not_NO");
  if (payload.publishAllowed !== false) issues.push("publishAllowed_not_false");
  if (payload.degradedBlocksLatest !== true) issues.push("degradedBlocksLatest_not_true");
  if (payload.preservePreviousGood !== true) issues.push("preservePreviousGood_not_true");
  if (payload.updatesLatestPointer === true || payload.latestPointerUpdated === true) issues.push("latest_pointer_updated");
  return result("ui_negative_degraded_payload_blocks_latest", issues.length === 0, {
    field: "name",
    blankCount: payload.blankCounts?.name ?? 0,
    evidenceStatus: payload.evidenceStatus,
    unattendedStatus: payload.unattendedStatus,
    publishAllowed: payload.publishAllowed,
    degradedBlocksLatest: payload.degradedBlocksLatest,
    preservePreviousGood: payload.preservePreviousGood,
    latestPointerUpdated: payload.latestPointerUpdated === true || payload.updatesLatestPointer === true,
    issues,
  });
}

function verifyFallbackDisplayOnlyBlocksFormal() {
  const payload = buildFormalPayload({
    payloadOverrides: {
      fallbackUsed: true,
      fallbackScope: "display-only",
      fallbackAllowed: true,
      fallbackDetails: { reason: "ui display-only sample" },
      fallbackContract: { scope: "display-only", latestAllowed: false },
    },
  });
  const issues = [];
  if (payload.fallbackUsed !== true) issues.push("fallbackUsed_not_disclosed");
  if (payload.fallbackScope !== "display-only") issues.push("fallbackScope_not_display_only");
  if (payload.unattendedStatus !== "NO") issues.push("fallback_unattendedStatus_not_NO");
  if (payload.publishAllowed !== false) issues.push("fallback_publishAllowed_not_false");
  if (payload.degradedBlocksLatest !== true) issues.push("fallback_degradedBlocksLatest_not_true");
  if (payload.preservePreviousGood !== true) issues.push("fallback_preservePreviousGood_not_true");
  return result("ui_negative_fallback_display_only_blocks_contract", issues.length === 0, {
    fallbackUsed: payload.fallbackUsed,
    fallbackScope: payload.fallbackScope,
    unattendedStatus: payload.unattendedStatus,
    publishAllowed: payload.publishAllowed,
    degradedBlocksLatest: payload.degradedBlocksLatest,
    preservePreviousGood: payload.preservePreviousGood,
    issues,
  });
}

function main() {
  const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
  const checks = [
    verifyMatrixShape(matrix),
    verifyStaticUiEndpoints(matrix),
    verifyFormalPayloadForDisplay(),
    verifyNegativeDegradedPayloadBlocksLatest(),
    verifyFallbackDisplayOnlyBlocksFormal(),
  ];
  for (const check of checks) {
    console.log(`${check.label} ${check.ok ? "PASS" : "FAIL"} ${JSON.stringify(check)}`);
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

if (require.main === module) main();
