"use strict";

const fs = require("fs");
const path = require("path");
const openBuyApi = require("../api/open-buy-latest");
const scanner = require("./scan-open-buy-cache");
const { attachRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_FILE = path.join(ROOT, "data/contracts/strategy1-business-field-matrix.json");
const DECISION_GATE_MATRIX_FILE = path.join(ROOT, "data/contracts/strategy1-decision-gate-matrix.json");
const SOURCE_CONTRACT_MATRIX_FILE = path.join(ROOT, "data/contracts/strategy1-source-contract-matrix.json");
const MATRIX_COLUMNS = [
  "fieldName",
  "payloadPath",
  "scannerPayloadPath",
  "writerPayloadPath",
  "sourceTableOrView",
  "businessPurpose",
  "required",
  "allowBlank",
  "blockLatestWhenBlank",
  "verifierRule",
  "blankCountsKey",
  "sampleMissingRowsKey",
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function sampleRows() {
  return [
    {
      run_id: "strategy1-contract-20260704",
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

function baseScannerOutput(overrides = {}) {
  const output = {
    ok: true,
    source: "contract-scanner-builder",
    runId: "strategy1-contract-20260704",
    startedAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:01:00.000Z",
    usedDate: "20260704",
    complete: true,
    scanStatus: "complete",
    total: 1,
    scannedThisRun: 1,
    scannedCodes: ["2330"],
    count: 1,
    resultCount: 1,
    rows: [{ code: "2330", name: "台積電", decision: "BUY", reason: "contract sample", score: 98 }],
    matches: [{ code: "2330", name: "台積電", decision: "BUY", reason: "contract sample", score: 98 }],
    sourceCoverage: {
      status: "ready",
      ok: true,
      fresh_quote_coverage_120s: 1,
      quote_age_seconds: 30,
      active_symbols: 1,
      fresh_quotes: 1,
      intraday_1m_status: "not_applicable",
      ma_status: "not_applicable",
      dailyVolumeStatus: "not_applicable",
      preopenStatus: "not_applicable",
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

function readyStatus(overrides = {}) {
  return {
    decision_ready: true,
    is_trading_day: true,
    latest_trading_day: "2026-07-04",
    trade_date: "2026-07-04",
    last_error: "",
    ...overrides,
  };
}

function buildFormalPayload({ scannerOutput = baseScannerOutput(), status = readyStatus(), rows = sampleRows(), options = {} } = {}) {
  const run = scanner.buildOpenBuyRunRow(scannerOutput, scannerOutput.runId);
  const apiPayload = openBuyApi.__contract.buildPayload(rows, run, status, options);
  return attachRunTimeSourceEvidence(apiPayload, { strategy: "strategy1", endpoint: "api/open-buy-latest" });
}

function buildRawApiPayload({ scannerOutput = baseScannerOutput(), status = readyStatus(), rows = sampleRows(), options = {} } = {}) {
  const run = scanner.buildOpenBuyRunRow(scannerOutput, scannerOutput.runId);
  return openBuyApi.__contract.buildPayload(rows, run, status, options);
}

function verifyRawApiPayload(payload, label) {
  const issues = [];
  for (const field of [
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "writeBudget",
    "retentionOk",
  ]) {
    if (!(field in payload)) issues.push(`${field}_missing`);
  }
  if (!hasCompleteWriteBudget(payload.writeBudget)) issues.push("writeBudget_incomplete");
  if (typeof payload.retentionOk !== "boolean") issues.push("retentionOk_missing_or_not_boolean");
  return { label, ok: issues.length === 0, issues };
}

function loadMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
}

function loadDecisionGateMatrix() {
  return JSON.parse(fs.readFileSync(DECISION_GATE_MATRIX_FILE, "utf8"));
}

function loadSourceContractMatrix() {
  return JSON.parse(fs.readFileSync(SOURCE_CONTRACT_MATRIX_FILE, "utf8"));
}

function verifyDecisionGateMatrixShape(matrix) {
  const requiredColumns = [
    "gateName",
    "gatePayloadPath",
    "scannerPayloadPath",
    "apiPayloadPath",
    "writerPayloadPath",
    "sourceTableOrView",
    "businessPurpose",
    "requiredForScan",
    "requiredForPublish",
    "requiredForFormalEntry",
    "allowedStates",
    "blockedStates",
    "whenBlockedReason",
    "fallbackAllowed",
    "fallbackScopeAllowed",
    "blockLatestWhenFailed",
    "preservePreviousGoodWhenFailed",
    "verifierRule",
    "negativeTestName",
    "sampleFailureExpected",
  ];
  const issues = [];
  const requiredGates = [
    "candidate_2130",
    "candidate_2130_futopt_0845",
    "futopt_ready",
    "decision_pending_display",
    "bare_live_fail_closed",
    "compact_display_allowed",
    "previous_2130_carry_forward",
  ];
  if (!Array.isArray(matrix) || matrix.length === 0) issues.push("decision_gate_matrix_empty");
  for (const gate of requiredGates) {
    if (!matrix.some((row) => row.gateName === gate)) issues.push(`decision_gate_missing_${gate}`);
  }
  matrix.forEach((row, index) => {
    for (const column of requiredColumns) {
      if (!(column in row)) issues.push(`decision_gate_row_${index}_missing_${column}`);
    }
    if (row.requiredForPublish === true && row.blockLatestWhenFailed !== true) {
      issues.push(`decision_gate_${row.gateName}_publish_gate_must_block_latest`);
    }
  });
  return { label: "decision_gate_matrix_shape", ok: issues.length === 0, issues };
}

function verifySourceContractMatrixShape(matrix) {
  const requiredColumns = [
    "sourceName",
    "payloadPath",
    "sourceTableOrView",
    "requiredForScan",
    "requiredForPublish",
    "requiredForFormalEntry",
    "threshold",
    "staleLimitSeconds",
    "notRequiredReason",
    "verifierRule",
    "negativeTestName",
    "blockLatestWhenFailed",
  ];
  const issues = [];
  const requiredSources = [
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "quote fresh coverage 120s",
    "quote_age_seconds",
    "intraday_1m_readiness_at_run",
    "intraday_1m_stale_seconds",
    "ma_readiness_at_run",
    "ready_ma20",
    "ready_ma35",
    "preopen_futopt_daily_readiness_at_run",
    "daily_volume_status",
    "preopen_status",
    "futopt_status",
    "permission_status",
    "run_quality_at_publish",
  ];
  if (!Array.isArray(matrix) || matrix.length === 0) issues.push("source_contract_matrix_empty");
  for (const source of requiredSources) {
    if (!matrix.some((row) => row.sourceName === source)) issues.push(`source_contract_missing_${source}`);
  }
  matrix.forEach((row, index) => {
    for (const column of requiredColumns) {
      if (!(column in row)) issues.push(`source_contract_row_${index}_missing_${column}`);
    }
    if ((row.requiredForScan || row.requiredForPublish || row.requiredForFormalEntry) && !row.threshold) {
      issues.push(`source_contract_${row.sourceName}_threshold_missing`);
    }
    if (row.requiredForPublish === true && row.blockLatestWhenFailed !== true) {
      issues.push(`source_contract_${row.sourceName}_must_block_latest`);
    }
  });
  return { label: "source_contract_matrix_shape", ok: issues.length === 0, issues };
}

function verifyBusinessFieldMatrixShape(matrix) {
  const issues = [];
  if (!Array.isArray(matrix) || matrix.length === 0) issues.push("matrix_empty");
  matrix.forEach((row, index) => {
    for (const column of MATRIX_COLUMNS) {
      if (!(column in row)) issues.push(`matrix_row_${index}_missing_${column}`);
    }
    if (row.required === true && row.allowBlank === false && row.blockLatestWhenBlank !== true) {
      issues.push(`matrix_row_${index}_${row.fieldName}_required_nonblank_must_block_latest`);
    }
    if (row.required === true && !String(row.blankCountsKey || "").startsWith("blankCounts.")) {
      issues.push(`matrix_row_${index}_${row.fieldName}_blankCountsKey_invalid`);
    }
    if (row.required === true && !row.sampleMissingRowsKey) {
      issues.push(`matrix_row_${index}_${row.fieldName}_sampleMissingRowsKey_missing`);
    }
  });
  return { label: "business_field_matrix_shape", ok: issues.length === 0, issues };
}

function verifyBusinessAuditConsistency({ scannerOutput, rawApiPayload, runRow }) {
  const matrix = loadMatrix();
  const issues = [];
  const scannerBlankCounts = scannerOutput.blankCounts || {};
  const apiBlankCounts = rawApiPayload.blankCounts || {};
  const runQuality = runRow.payload?.run_quality_at_publish || {};
  const runBlankCounts = runQuality.blankCounts || {};
  for (const row of matrix.filter((item) => item.required === true && item.allowBlank === false)) {
    const key = String(row.blankCountsKey || "").replace(/^blankCounts\./, "");
    if (!(key in scannerBlankCounts)) issues.push(`scanner_blankCounts_missing_${key}`);
    if (!(key in apiBlankCounts)) issues.push(`api_blankCounts_missing_${key}`);
    if (!(key in runBlankCounts)) issues.push(`run_blankCounts_missing_${key}`);
    if (Number(scannerBlankCounts[key] || 0) !== 0) issues.push(`scanner_blankCounts_${key}_not_zero`);
    if (Number(apiBlankCounts[key] || 0) !== 0) issues.push(`api_blankCounts_${key}_not_zero`);
    if (Number(runBlankCounts[key] || 0) !== 0) issues.push(`run_blankCounts_${key}_not_zero`);
  }
  if (!isObject(scannerOutput.requiredFields)) issues.push("scanner_requiredFields_missing");
  if (!isObject(rawApiPayload.requiredFields)) issues.push("api_requiredFields_missing");
  if (!isObject(runQuality.requiredFields)) issues.push("run_quality_requiredFields_missing");
  if (!Array.isArray(scannerOutput.sampleMissingRows)) issues.push("scanner_sampleMissingRows_missing");
  if (!Array.isArray(rawApiPayload.sampleMissingRows)) issues.push("api_sampleMissingRows_missing");
  if (!Array.isArray(runQuality.sampleMissingRows)) issues.push("run_quality_sampleMissingRows_missing");
  const futopt0845 = (rawApiPayload.stageCards || []).find((card) => card.key === "candidate_2130_futopt_0845");
  if (!futopt0845) issues.push("api_stageCards_missing_candidate_2130_futopt_0845");
  if (futopt0845 && !Number.isFinite(Number(futopt0845.secondaryCount))) issues.push("api_futopt0845_secondaryCount_not_number");
  if (futopt0845 && !["ready", "waiting_futopt", "waiting"].includes(String(futopt0845.status || ""))) {
    issues.push(`api_futopt0845_status_invalid:${futopt0845.status}`);
  }
  return { label: "business_blankCounts_sampleMissingRows_consistency", ok: issues.length === 0, issues };
}

function verifyBusinessFieldNegativeMutation() {
  const broken = baseScannerOutput({
    rows: [{ code: "2330", name: "", decision: "BUY", reason: "contract sample", score: 98 }],
    matches: [{ code: "2330", name: "", decision: "BUY", reason: "contract sample", score: 98 }],
  });
  const run = scanner.buildOpenBuyRunRow(broken, broken.runId);
  const resultRows = scanner.buildOpenBuyResultRows(broken, broken.runId);
  const raw = buildRawApiPayload({ scannerOutput: broken, rows: resultRows });
  const wrapped = attachRunTimeSourceEvidence(raw, { strategy: "strategy1", endpoint: "api/open-buy-latest" });
  const issues = [];
  if (Number(broken.blankCounts?.name || 0) <= 0) issues.push("scanner_name_blank_not_counted");
  if (Number(run.payload?.run_quality_at_publish?.blankCounts?.name || 0) <= 0) issues.push("run_name_blank_not_counted");
  if (Number(raw.blankCounts?.name || 0) <= 0) issues.push("api_name_blank_not_counted");
  if (!broken.sampleMissingRows?.some((row) => Array.isArray(row.missing) && row.missing.includes("name"))) {
    issues.push("scanner_sampleMissingRows_missing_name");
  }
  if (!run.payload?.run_quality_at_publish?.sampleMissingRows?.some((row) => Array.isArray(row.missing) && row.missing.includes("name"))) {
    issues.push("run_sampleMissingRows_missing_name");
  }
  if (!raw.sampleMissingRows?.some((row) => Array.isArray(row.missing) && row.missing.includes("name"))) {
    issues.push("api_sampleMissingRows_missing_name");
  }
  if (wrapped.evidenceStatus !== "source_quality_fail" && wrapped.evidenceStatus !== "insufficient") {
    issues.push(`wrapped_evidenceStatus_not_insufficient:${wrapped.evidenceStatus}`);
  }
  if (wrapped.unattendedStatus !== "NO") issues.push(`wrapped_unattendedStatus_not_NO:${wrapped.unattendedStatus}`);
  if (wrapped.publishAllowed !== false) issues.push("wrapped_publishAllowed_not_false");
  if (wrapped.degradedBlocksLatest !== true) issues.push("wrapped_degradedBlocksLatest_not_true");
  if (wrapped.preservePreviousGood !== true) issues.push("wrapped_preservePreviousGood_not_true");
  if (wrapped.mustPreserveLatest !== true) issues.push("wrapped_latest_pointer_not_preserved");
  return {
    label: "business_negative_blank_name_blocks_contract",
    ok: issues.length === 0,
    issues,
    mutationEvidence: {
      field: "name",
      required: true,
      allowBlank: false,
      scannerBlankCount: Number(broken.blankCounts?.name || 0),
      apiBlankCount: Number(raw.blankCounts?.name || 0),
      runBlankCount: Number(run.payload?.run_quality_at_publish?.blankCounts?.name || 0),
      sampleMissingRows: raw.sampleMissingRows,
      evidenceStatus: wrapped.evidenceStatus,
      unattendedStatus: wrapped.unattendedStatus,
      publishAllowed: wrapped.publishAllowed,
      degradedBlocksLatest: wrapped.degradedBlocksLatest,
      preservePreviousGood: wrapped.preservePreviousGood,
      latestPointerUpdated: wrapped.mustPreserveLatest === true ? false : null,
    },
  };
}

function verifyBusinessFutopt0845NegativeMutation() {
  const scannerOutput = baseScannerOutput();
  const resultRows = scanner.buildOpenBuyResultRows(scannerOutput, scannerOutput.runId);
  const raw = buildRawApiPayload({ scannerOutput, rows: resultRows });
  raw.stageCards = (raw.stageCards || []).filter((card) => card.key !== "candidate_2130_futopt_0845");
  raw.blankCounts = {
    ...(raw.blankCounts || {}),
    futopt0845StageKey: 1,
    futopt0845SecondaryCount: 1,
    futopt0845StageStatus: 1,
  };
  raw.sampleMissingRows = [
    ...(Array.isArray(raw.sampleMissingRows) ? raw.sampleMissingRows : []),
    { runId: raw.runId, stageKey: "candidate_2130_futopt_0845", missing: ["futopt0845StageKey", "futopt0845SecondaryCount", "futopt0845StageStatus"] },
  ];
  raw.run_quality_at_publish = {
    ...(raw.run_quality_at_publish || {}),
    blankCounts: raw.blankCounts,
    sampleMissingRows: raw.sampleMissingRows,
  };
  const wrapped = attachRunTimeSourceEvidence(raw, { strategy: "strategy1", endpoint: "api/open-buy-latest" });
  const issues = [];
  if ((raw.stageCards || []).some((card) => card.key === "candidate_2130_futopt_0845")) issues.push("mutation_did_not_remove_futopt0845_stage");
  if (Number(raw.blankCounts?.futopt0845StageKey || 0) <= 0) issues.push("api_futopt0845StageKey_blank_not_counted");
  if (!raw.sampleMissingRows?.some((row) => Array.isArray(row.missing) && row.missing.includes("futopt0845StageKey"))) {
    issues.push("api_sampleMissingRows_missing_futopt0845StageKey");
  }
  if (wrapped.evidenceStatus !== "source_quality_fail" && wrapped.evidenceStatus !== "insufficient") {
    issues.push(`wrapped_evidenceStatus_not_insufficient:${wrapped.evidenceStatus}`);
  }
  if (wrapped.unattendedStatus !== "NO") issues.push(`wrapped_unattendedStatus_not_NO:${wrapped.unattendedStatus}`);
  if (wrapped.publishAllowed !== false) issues.push("wrapped_publishAllowed_not_false");
  if (wrapped.degradedBlocksLatest !== true) issues.push("wrapped_degradedBlocksLatest_not_true");
  if (wrapped.preservePreviousGood !== true) issues.push("wrapped_preservePreviousGood_not_true");
  if (wrapped.mustPreserveLatest !== true) issues.push("wrapped_latest_pointer_not_preserved");
  return {
    label: "business_negative_futopt0845_stage_blocks_contract",
    ok: issues.length === 0,
    issues,
    mutationEvidence: {
      field: "futopt0845StageKey",
      required: true,
      allowBlank: false,
      apiBlankCount: Number(raw.blankCounts?.futopt0845StageKey || 0),
      sampleMissingRows: raw.sampleMissingRows,
      evidenceStatus: wrapped.evidenceStatus,
      unattendedStatus: wrapped.unattendedStatus,
      publishAllowed: wrapped.publishAllowed,
      degradedBlocksLatest: wrapped.degradedBlocksLatest,
      preservePreviousGood: wrapped.preservePreviousGood,
      latestPointerUpdated: wrapped.mustPreserveLatest === true ? false : null,
    },
  };
}

function verifyFormalPayload(payload, label, { expectReady = true } = {}) {
  const issues = [];
  const ready = payload.evidenceStatus === "complete"
    && payload.unattendedStatus === "YES"
    && payload.publishAllowed === true
    && payload.fallbackUsed !== true
    && cleanNumber(payload.run_quality_at_publish?.resultCount) > 0;

  for (const field of [
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "intraday_1m_readiness_at_run",
    "ma_readiness_at_run",
    "preopen_futopt_daily_readiness_at_run",
    "run_quality_at_publish",
    "writeBudget",
    "retentionOk",
    "blockedReason",
    "scanner_block_reason",
  ]) {
    if (!(field in payload)) issues.push(`${field}_missing`);
  }
  if (!payload.source_snapshot_captured_at) issues.push("source_snapshot_captured_at_blank");
  if (!hasCompleteWriteBudget(payload.writeBudget)) issues.push("writeBudget_incomplete");
  if (typeof payload.retentionOk !== "boolean") issues.push("retentionOk_missing_or_not_boolean");
  if (payload.fallbackUsed === true) issues.push("fallback_display_only_not_formal_unattended");
  if (cleanNumber(payload.run_quality_at_publish?.resultCount) <= 0) issues.push("empty_result");
  if (payload.evidenceStatus !== "complete") issues.push(`evidenceStatus_${payload.evidenceStatus || "missing"}`);
  if (!expectReady && payload.unattendedStatus === "YES") issues.push("unattendedStatus_fake_yes");
  if (!expectReady && payload.publishAllowed === true) issues.push("source_bad_but_publishAllowed_true");
  if (!expectReady && payload.degradedBlocksLatest !== true) issues.push("source_bad_must_degrade_blocks_latest");
  if (!expectReady && payload.preservePreviousGood !== true) issues.push("source_bad_must_preserve_previous_good");

  const formalReady = ready && issues.length === 0;
  const ok = expectReady ? formalReady : issues.length > 0;
  return { label, ok, ready: formalReady, issues };
}

function verifyBlockedReceipt() {
  const receipt = scanner.buildBlockedReceipt("contract_source_bad", baseScannerOutput({ complete: false, scanStatus: "incomplete", rows: [], matches: [], count: 0, resultCount: 0 }), {
    scanner_block_reason: "contract source bad",
  });
  const issues = [];
  if (receipt.blockedReceipt === false) issues.push("blockedReceipt_false");
  if (!receipt.blockedReason) issues.push("blockedReason_missing");
  if (!receipt.scanner_block_reason) issues.push("scanner_block_reason_missing");
  if (receipt.preservePreviousGood !== true) issues.push("preservePreviousGood_not_true");
  if (receipt.degradedBlocksLatest !== true) issues.push("degradedBlocksLatest_not_true");
  if (receipt.latestWriteAttempted !== false) issues.push("latestWriteAttempted_not_false");
  if (receipt.updatesLatestPointer !== false) issues.push("updatesLatestPointer_not_false");
  if (!hasCompleteWriteBudget(receipt.writeBudget) || receipt.writeBudget.allowed !== false) issues.push("blocked_writeBudget_not_closed");
  if (receipt.evidenceStatus !== "insufficient") issues.push("evidenceStatus_not_insufficient");
  if (receipt.unattendedStatus !== "NO") issues.push("unattendedStatus_not_NO");
  return { label: "writer_blocked_receipt", ok: issues.length === 0, issues };
}

function verifyStaticLatestGuards() {
  const text = read("scripts/scan-open-buy-cache.js");
  const issues = [];
  for (const marker of [
    "writeBlockedReceipt(\"non_complete_publish_blocked\"",
    "writeBlockedReceipt(\"full_scan_incomplete\"",
    "writeBlockedReceipt(\"incomplete_scan_not_eligible_for_latest\"",
    "if (payload.complete !== true)",
    "if (output.complete !== true || output.scanStatus !== \"complete\")",
    "await upsertOpenBuyLatestToSupabase(output)",
  ]) {
    if (!text.includes(marker)) issues.push(`missing_marker:${marker}`);
  }
  const blockIndex = text.indexOf("if (output.complete !== true || output.scanStatus !== \"complete\")");
  const upsertIndex = text.indexOf("await upsertOpenBuyLatestToSupabase(output)");
  if (blockIndex < 0 || upsertIndex < 0 || blockIndex > upsertIndex) {
    issues.push("latest_upsert_not_guarded_by_complete_check");
  }
  return { label: "latest_pointer_static_guard", ok: issues.length === 0, issues };
}

function runNegativeMutations() {
  const ready = buildFormalPayload();
  const cases = [
    {
      label: "formal_payload_missing_source_snapshot_fails",
      mutate(payload) { delete payload.source_snapshot_captured_at; },
      expected: "source_snapshot_captured_at_missing",
    },
    {
      label: "formal_payload_missing_writeBudget_fails",
      mutate(payload) { delete payload.writeBudget; },
      expected: "writeBudget_missing",
    },
    {
      label: "formal_payload_fake_yes_source_bad_fails",
      payload: buildFormalPayload({
        scannerOutput: baseScannerOutput({
          sourceCoverage: { status: "not_ready", ok: false, reason: "quote low", fresh_quote_coverage_120s: 0.1, quote_age_seconds: 999 },
        }),
      }),
      mutate(payload) { payload.unattendedStatus = "YES"; },
      expected: "unattendedStatus_fake_yes",
    },
    {
      label: "formal_payload_empty_result_fails",
      payload: buildFormalPayload({
        scannerOutput: baseScannerOutput({ rows: [], matches: [], count: 0, resultCount: 0 }),
        rows: [],
      }),
      mutate() {},
      expected: "empty_result",
    },
    {
      label: "formal_payload_fallback_display_only_fails",
      payload: buildFormalPayload({
        status: readyStatus({ decision_ready: false, last_error: "preopen_not_ready; futopt_not_ready" }),
        options: { pendingCandidateDisplay: true },
      }),
      mutate() {},
      expected: "fallback_display_only_not_formal_unattended",
    },
  ];
  return cases.map((testCase) => {
    const payload = clone(testCase.payload || ready);
    testCase.mutate(payload);
    const result = verifyFormalPayload(payload, testCase.label, { expectReady: false });
    return {
      ...result,
      ok: result.ok && result.issues.includes(testCase.expected),
      expected: testCase.expected,
    };
  });
}

function main() {
  const scannerOutput = baseScannerOutput();
  const runRow = scanner.buildOpenBuyRunRow(scannerOutput, scannerOutput.runId);
  const resultRows = scanner.buildOpenBuyResultRows(scannerOutput, scannerOutput.runId);
  const rawApiPayload = buildRawApiPayload({ scannerOutput, rows: resultRows });
  const businessResults = [
    verifyDecisionGateMatrixShape(loadDecisionGateMatrix()),
    verifySourceContractMatrixShape(loadSourceContractMatrix()),
    verifyBusinessFieldMatrixShape(loadMatrix()),
    verifyBusinessAuditConsistency({ scannerOutput, rawApiPayload, runRow }),
    verifyBusinessFieldNegativeMutation(),
    verifyBusinessFutopt0845NegativeMutation(),
  ];
  const formalResults = [
    verifyRawApiPayload(buildRawApiPayload(), "scanner_to_api_raw_payload_ready"),
    verifyFormalPayload(buildFormalPayload(), "scanner_to_api_formal_payload_ready"),
    verifyBlockedReceipt(),
    verifyStaticLatestGuards(),
    ...runNegativeMutations(),
  ];
  const mode = process.argv.includes("--business-fields")
    ? "business-fields"
    : process.argv.includes("--formal-payloads")
      ? "formal-payloads"
      : process.argv.includes("--strict")
        ? "strict"
        : "strict";
  const results = mode === "business-fields"
    ? businessResults
    : mode === "formal-payloads"
      ? formalResults
      : [...businessResults, ...formalResults];
  const ok = results.every((item) => item.ok);
  console.log(JSON.stringify({
    ok,
    contract: "strategy1-prewater-formal-payload-contract-v1",
    mode,
    checkedAt: new Date().toISOString(),
    results,
  }, null, 2));
  if (!ok) process.exit(1);
}

main();
