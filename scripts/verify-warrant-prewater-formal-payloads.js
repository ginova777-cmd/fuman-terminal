"use strict";

const fs = require("fs");
const path = require("path");
const { attachRunTimeSourceEvidence, buildRunTimeSourceSnapshotFields } = require("../lib/run-time-source-snapshot-contract");
const scanner = require("../api/scan-warrant-flow");
const warrantApi = require("../api/warrant-flow-latest");
const warrantWriter = require("./scan-warrant-flow-cache");
const { matrix: businessMatrix } = require("./verify-warrant-business-fields");

const ROOT = path.resolve(__dirname, "..");
const api = warrantApi._prewater;
const scannerPrewater = scanner._prewater;

const REQUIRED_TOP_LEVEL = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "run_quality_at_publish",
  "writeBudget",
  "retentionOk",
  "fallbackUsed",
  "fallbackScope",
  "fallbackAllowed",
  "fallbackDetails",
  "evidenceStatus",
  "unattendedStatus",
  "degradedBlocksLatest",
  "preservePreviousGood",
  "blockedReason",
  "scanner_block_reason",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(value, field) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, field);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function sourceReady(payload) {
  const status = String(payload?.source_status_at_run?.status || "").toLowerCase();
  return payload?.source_status_at_run?.ok === true && ["ready", "complete", "ok", "allow"].includes(status);
}

function latestAllowed(payload) {
  return payload?.publishAllowed === true
    || payload?.writeBudget?.allowLatestWrite === true
    || payload?.run_quality_at_publish?.publishAllowed === true
    || payload?.run_quality_at_publish?.writeBudget?.allowLatestWrite === true;
}

function rowCount(payload) {
  return Number(payload?.count || 0)
    + Number(payload?.volumeCount || 0)
    + Number(payload?.singleSignalCount || 0);
}

function formalizeApiPayload(payload, options = {}) {
  return attachRunTimeSourceEvidence(api.attachWarrantSelfCheck(payload, options));
}

function formalizeRunPayload(payload) {
  return attachRunTimeSourceEvidence(payload);
}

function sampleScannerRows() {
  const common = {
    market: "上市",
    tradeDate: "20260704",
    underlyingCode: "2317",
    underlyingName: "鴻海",
    underlyingClose: 198,
    underlyingPercent: 1.2,
    daysToExpiry: 45,
    basicVerified: true,
    priceVerified: true,
    quoteSource: "TWSE STOCK_DAY_ALL",
    isAtMoney: true,
  };
  return [
    { ...common, code: "123456", name: "鴻海中信A購01", type: "call", value: 12000000, volume: 900000, strike: 200, moneynessPct: 1.01 },
    { ...common, code: "123457", name: "鴻海凱基B購02", type: "call", value: 9000000, volume: 700000, strike: 205, moneynessPct: 1.04 },
    { ...common, code: "123458", name: "鴻海元大C購03", type: "call", value: 6500000, volume: 550000, strike: 210, moneynessPct: 1.06 },
    { ...common, code: "123459", name: "鴻海元富D售01", type: "put", value: 1200000, volume: 120000, strike: 180, moneynessPct: 0.91 },
  ];
}

function apiRowsFromScannerPayload(scannerPayload, runId = "warrant-flow-formal-ready") {
  const base = {
    run_id: runId,
    strategy: "warrant_flow",
    scan_date: "2026-07-04",
    complete: true,
    quality_status: "complete",
    schema_version: "warrant-flow-run-id-complete-v1",
    data_contract_source: "warrant-flow-cache",
    generated_at: "2026-07-04T01:30:00.000Z",
    updated_at: "2026-07-04T01:30:00.000Z",
  };
  const rows = [];
  for (const [type, items] of [["match", scannerPayload.matches], ["volume", scannerPayload.volumeMatches], ["single", scannerPayload.singleSignals]]) {
    (items || []).forEach((item, index) => {
      rows.push({
        ...base,
        result_type: type,
        code: String(item.warrantCode || item.code || item.underlyingCode || `${type}-${index + 1}`),
        name: String(item.warrantName || item.name || item.underlyingName || ""),
        underlying_code: String(item.underlyingCode || item.code || ""),
        underlying_name: String(item.underlyingName || item.name || ""),
        score: Number(item.finalScore || item.score || 0),
        rank: index + 1,
        reason: String(item.reason || item.actionLabel || ""),
        payload: item,
      });
    });
  }
  return rows;
}

function businessRows(payload) {
  return [
    ...(Array.isArray(payload?.rows) ? payload.rows.map((row) => ({ ...row, __kind: row.__kind || "row" })) : []),
    ...(Array.isArray(payload?.matches) ? payload.matches.map((row) => ({ ...row, __kind: row.__kind || "match" })) : []),
    ...(Array.isArray(payload?.volumeMatches) ? payload.volumeMatches.map((row) => ({ ...row, __kind: row.__kind || "volume" })) : []),
    ...(Array.isArray(payload?.singleSignals) ? payload.singleSignals.map((row) => ({ ...row, __kind: row.__kind || "single" })) : []),
  ].filter((row, index, rows) => row && typeof row === "object" && rows.findIndex((item) => item === row) === index);
}

function businessValueOk(fieldName, row, payload) {
  const number = (...values) => values.map((value) => Number(value)).find((value) => Number.isFinite(value));
  const text = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";
  const top = Array.isArray(row.topWarrants) ? row.topWarrants : [];
  switch (fieldName) {
    case "underlyingCode": return /^\d{4}$/.test(text(row.underlyingCode, row.code));
    case "underlyingName": return Boolean(text(row.underlyingName, row.name));
    case "warrantCode": return /^\d{5,6}$/.test(text(row.warrantCode)) || top.some((item) => /^\d{5,6}$/.test(text(item.code)));
    case "warrantName": return Boolean(text(row.warrantName)) || top.some((item) => Boolean(text(item.name)));
    case "finalScore": return (number(row.finalScore) || 0) > 0;
    case "score": return (number(row.score, row.finalScore) || 0) > 0;
    case "reason": return Boolean(text(row.reason));
    case "actionLabel": return Boolean(text(row.actionLabel, row.reason));
    case "signalGrade": return /^[ABC]$/.test(text(row.signalGrade)) || /^[ABC]/.test(text(row.reason));
    case "stockRisk": return Boolean(text(row.stockRisk, row.reason));
    case "callValue": return (number(row.callValue, row.value) || 0) > 0;
    case "putValue": return row.putValue !== undefined ? (number(row.putValue) ?? -1) >= 0 : true;
    case "callPutRatio": return (number(row.callPutRatio, row.volumeMultiple, row.warrantHeatScore, row.score) || 0) > 0;
    case "warrantHeatScore": return (number(row.warrantHeatScore, row.score, row.finalScore) || 0) > 0;
    case "stockSetupScore": return (number(row.stockSetupScore, row.score, row.finalScore) || 0) > 0;
    case "branchPowerScore": return row.branchPowerScore !== undefined ? (number(row.branchPowerScore) ?? -1) >= 0 : true;
    case "branchStatus": return row.branchPowerScore === undefined || Boolean(text(row.branchStatus));
    case "volumeMultiple": return row.volumeMultiple === undefined || (number(row.volumeMultiple) || 0) > 0;
    case "thirtyMinuteVolume": return row.thirtyMinuteVolume === undefined || (number(row.thirtyMinuteVolume) || 0) > 0;
    case "floatingUnits": return row.floatingUnits === undefined || (number(row.floatingUnits) || 0) > 0;
    case "quoteSource": return Boolean(text(row.quoteSource)) || top.some((item) => Boolean(text(item.quoteSource)));
    case "source_snapshot_captured_at": return Boolean(text(payload.source_snapshot_captured_at));
    case "fallbackUsed": return Object.prototype.hasOwnProperty.call(payload, "fallbackUsed");
    default: return true;
  }
}

function assertBusinessMatrixPayload(label, payload) {
  const rows = businessRows(payload);
  const issues = [];
  for (const field of businessMatrix) {
    if (payload.blankCounts && !Object.prototype.hasOwnProperty.call(payload.blankCounts, field.blankCountsKey)) {
      issues.push(`${field.fieldName}: blankCounts missing ${field.blankCountsKey}`);
    }
    if (field.required && field.allowBlank === false) {
      if (["source_snapshot_captured_at", "fallbackUsed"].includes(field.fieldName)) {
        if (!businessValueOk(field.fieldName, {}, payload)) issues.push(`${field.fieldName}: top-level missing`);
        continue;
      }
      const applicableRows = rows.filter((row) => {
        if (field.fieldName === "finalScore") return row.__kind !== "single";
        if (["volumeMultiple", "thirtyMinuteVolume", "floatingUnits"].includes(field.fieldName)) return row.volumeMultiple !== undefined || row.thirtyMinuteVolume !== undefined || row.floatingUnits !== undefined;
        return true;
      });
      applicableRows.forEach((row, index) => {
        if (!businessValueOk(field.fieldName, row, payload)) {
          issues.push(`${field.fieldName}: blank at row ${index} ${row.code || row.underlyingCode || ""}`);
        }
      });
    }
  }
  if (payload.sampleMissingRows && payload.sampleMissingRows.some((row) => !Array.isArray(row.missing))) {
    issues.push("sampleMissingRows missing missing[] locator");
  }
  if (issues.length) throw new Error(`${label}: ${issues.join("; ")}`);
}

function assertFormalPayload(label, payload, options = {}) {
  const issues = [];
  const expectReady = options.expectReady === true;
  const expectBlocked = options.expectBlocked === true || !expectReady;
  const empty = rowCount(payload) <= 0
    && (!Array.isArray(payload?.matches) || payload.matches.length === 0)
    && (!Array.isArray(payload?.rows) || payload.rows.length === 0);

  for (const field of REQUIRED_TOP_LEVEL) {
    if (!hasOwn(payload, field)) issues.push(`missing_${field}`);
  }
  if (!hasValue(payload.source_snapshot_captured_at)) issues.push("missing_source_snapshot_captured_at");
  if (!hasValue(payload.source_status_at_run)) issues.push("missing_source_status_at_run");
  if (!hasValue(payload.run_quality_at_publish)) issues.push("missing_run_quality_at_publish");
  if (!hasValue(payload.writeBudget)) issues.push("missing_writeBudget");
  if (!hasOwn(payload, "retentionOk")) issues.push("missing_retentionOk");
  if (!Array.isArray(payload.fallbackScope)) issues.push("fallbackScope_not_array");
  if (!Array.isArray(payload.fallbackDetails)) issues.push("fallbackDetails_not_array");
  if (!hasValue(payload.evidenceStatus)) issues.push("missing_evidenceStatus");
  if (!hasValue(payload.unattendedStatus)) issues.push("missing_unattendedStatus");
  if (payload.fallbackUsed === true && (!payload.fallbackScope.length || !payload.fallbackDetails.length)) issues.push("fallback_used_not_disclosed");
  if (empty && (payload.ok === true || payload.unattendedStatus === "YES")) issues.push("empty_result_marked_ok_or_yes");
  if (payload.cacheSource === "snapshot-friendly-empty" && (sourceReady(payload) || latestAllowed(payload) || payload.unattendedStatus === "YES")) {
    issues.push("snapshot_friendly_empty_marked_ready");
  }
  if (payload.dataContract?.ok === false && latestAllowed(payload)) issues.push("data_contract_invalid_publish_allowed");
  if (!sourceReady(payload) && latestAllowed(payload)) issues.push("source_not_ready_latest_pointer_updates");
  if (expectBlocked && payload.degradedBlocksLatest !== true) issues.push("degradedBlocksLatest_false");
  if (expectBlocked && payload.preservePreviousGood !== true) issues.push("preservePreviousGood_false");
  if (expectBlocked && !hasValue(payload.blockedReason)) issues.push("missing_blockedReason");
  if (expectBlocked && !hasValue(payload.scanner_block_reason)) issues.push("missing_scanner_block_reason");
  if (expectReady && payload.unattendedStatus !== "YES") issues.push("ready_not_unattended_yes");
  if (expectReady && payload.evidenceStatus !== "complete") issues.push("ready_evidence_not_complete");

  if (issues.length) {
    throw new Error(`${label}: ${issues.join(",")}`);
  }
}

function expectRejected(label, payload, expectedNeedle) {
  try {
    assertFormalPayload(label, payload, { expectReady: false });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes(expectedNeedle)) throw error;
    return;
  }
  throw new Error(`${label}: negative control was accepted`);
}

function readyRunPayload() {
  const runId = "warrant-flow-formal-ready";
  const finishedAt = "2026-07-04T01:30:00.000Z";
  const runPayload = buildRunTimeSourceSnapshotFields({
    strategy: "warrant-flow",
    runId,
    startedAt: "2026-07-04T01:29:00.000Z",
    finishedAt,
    expectedTotal: 2,
    scannedCount: 2,
    resultCount: 2,
    sourceStatus: { status: "ready", ok: true, reason: "formal fixture ready" },
    quoteCoverage: { status: "not_applicable", ok: true },
    intraday1mReadiness: { status: "not_applicable", ok: true },
    maReadiness: { status: "not_applicable", ok: true },
    preopenFutoptDailyReadiness: { status: "ready", ok: true, warrant: { rows: 2 } },
    publishAllowed: true,
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    qualityStatus: "complete",
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: true,
    fallbackDetails: [],
    writeBudget: {
      status: "allow",
      allowLatestWrite: true,
      allowCompleteRunWrite: true,
      preservePreviousCompleteRun: false,
    },
    retentionOk: true,
  });
  return {
    run_id: runId,
    scan_date: "2026-07-04",
    finished_at: finishedAt,
    updated_at: finishedAt,
    complete: true,
    status: "complete",
    quality_status: "complete",
    result_count: 2,
    schema_version: "warrant-flow-run-id-complete-v1",
    data_contract_source: "warrant-flow-cache",
    payload: {
      ...runPayload,
      usedDate: "20260704",
      sourceDate: "20260704",
      tradeDate: "20260704",
    },
  };
}

function readyRows(runId = "warrant-flow-formal-ready") {
  const base = {
    run_id: runId,
    strategy: "warrant_flow",
    scan_date: "2026-07-04",
    complete: true,
    quality_status: "complete",
    schema_version: "warrant-flow-run-id-complete-v1",
    data_contract_source: "warrant-flow-cache",
    generated_at: "2026-07-04T01:30:00.000Z",
    updated_at: "2026-07-04T01:30:00.000Z",
  };
  return [
    {
      ...base,
      result_type: "match",
      code: "2330",
      underlying_code: "2330",
      underlying_name: "TSMC",
      score: 91,
      rank: 1,
      payload: { warrantCode: "123456", warrantName: "Fixture C", underlyingCode: "2330", underlyingName: "TSMC", finalScore: 91 },
    },
    {
      ...base,
      result_type: "volume",
      code: "123456",
      underlying_code: "2330",
      underlying_name: "TSMC",
      score: 80,
      rank: 1,
      payload: { warrantCode: "123456", warrantName: "Fixture C", underlyingCode: "2330", underlyingName: "TSMC", thirtyMinuteVolume: 1000, floatingUnits: 20, volumeMultiple: 3, finalScore: 80 },
    },
  ];
}

function verifyApiFormalPayloads() {
  const scannerPayload = scannerPrewater.buildScannerPayloadFromRows(sampleScannerRows(), { updatedAt: "2026-07-04T01:30:00.000Z" });
  if (!scannerPayload.matches.length || !scannerPayload.volumeMatches.length) throw new Error("scanner formal adapter did not produce matches and volumeMatches");
  assertBusinessMatrixPayload("scanner formal payload", { ...scannerPayload, rows: scannerPayload.matches, fallbackUsed: false, source_snapshot_captured_at: scannerPayload.updatedAt, blankCounts: Object.fromEntries(businessMatrix.map((field) => [field.blankCountsKey, 0])), sampleMissingRows: [] });

  const run = readyRunPayload();
  const payload = api.buildPayload(apiRowsFromScannerPayload(scannerPayload, run.run_id), run);
  payload.dataContract = api.validateDataContract(payload);
  const formalPayload = formalizeApiPayload(payload);
  assertFormalPayload("api.buildPayload ready", formalPayload, { expectReady: true });
  assertBusinessMatrixPayload("api.buildPayload business fields", formalPayload);

  const quoteRun = readyRunPayload();
  quoteRun.scan_date = "2026-07-10";
  quoteRun.payload.usedDate = "20260710";
  quoteRun.payload.sourceDate = "20260710";
  quoteRun.payload.tradeDate = "20260710";
  const freshQuoteRows = readyRows(quoteRun.run_id).map((row) => ({
    ...row,
    scan_date: "2026-07-10",
    payload: { ...row.payload, underlyingClose: 2340, displayClose: 2340, quoteDate: "20260710" },
  }));
  const freshQuotePayload = api.buildPayload(freshQuoteRows, quoteRun);
  if (freshQuotePayload.matches[0]?.underlyingQuoteFresh !== true || Number(freshQuotePayload.matches[0]?.underlyingClose) !== 2340) {
    throw new Error("api.buildPayload fresh underlying quote was not retained");
  }
  const staleQuoteRows = freshQuoteRows.map((row) => ({ ...row, payload: { ...row.payload, quoteDate: "20260625" } }));
  const staleQuotePayload = api.buildPayload(staleQuoteRows, quoteRun);
  if (staleQuotePayload.matches[0]?.underlyingQuoteFresh !== false || Number(staleQuotePayload.matches[0]?.underlyingClose) !== 0 || Number(staleQuotePayload.matches[0]?.displayClose) !== 0) {
    throw new Error("api.buildPayload stale underlying quote was not stripped: expected issue=stale_underlying_quote_stripped");
  }

  const apiError = formalizeApiPayload(api.apiOnlyError("source_timeout"), { status: "blocked", reason: "source_timeout" });
  assertFormalPayload("api.apiOnlyError blocked", apiError, { expectBlocked: true });

  const empty = formalizeApiPayload(api.emptySnapshotPayload("snapshot_friendly_empty", null, { canvas: true }), {
    status: "degraded",
    reason: "snapshot_friendly_empty",
  });
  assertFormalPayload("api.emptySnapshotPayload blocked", empty, { expectBlocked: true });
}

function verifyWriterFormalPayloads() {
  const scannerPayload = scannerPrewater.buildScannerPayloadFromRows(sampleScannerRows(), { updatedAt: "2026-07-04T01:30:00.000Z" });
  const output = {
    ...scannerPayload,
    ok: true,
    source: "github-actions",
    runId: "warrant-flow-writer-ready",
    updatedAt: "2026-07-04T01:30:00.000Z",
    tradeDate: "20260704",
    sourceDate: "20260704",
    schemaVersion: "warrant-flow-run-id-complete-v1",
    dataContractSource: "warrant-flow-cache",
    dataContract: { status: "ready", ok: true },
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: true,
    fallbackDetails: [],
  };
  const runRow = warrantWriter.buildWarrantFlowRunRow(output, output.runId, "complete");
  const formalRun = formalizeRunPayload(runRow.payload);
  assertFormalPayload("writer.buildWarrantFlowRunRow ready", formalRun, { expectReady: true });
  assertBusinessMatrixPayload("writer.runPayload business fields", { ...formalRun, rows: output.matches, volumeMatches: output.volumeMatches, singleSignals: output.singleSignals });
  const rows = warrantWriter.buildWarrantFlowResultRows(output, output.runId);
  if (rows.length !== Number(runRow.expected_total)) throw new Error("writer result rows do not match expected_total");
  for (const result of rows) assertBusinessMatrixPayload(`writer.result ${result.result_type}`, { ...formalRun, rows: [{ ...result.payload, __kind: result.result_type }] });

  const blockedOutput = { ...output, runId: "warrant-flow-writer-blocked", count: 0, matches: [], volumeCount: 0, volumeMatches: [], singleSignalCount: 0, singleSignals: [], dataContract: { status: "blocked", ok: false, reason: "empty_result" } };
  const blockedRun = warrantWriter.buildWarrantFlowRunRow(blockedOutput, blockedOutput.runId, "complete");
  assertFormalPayload("writer non-publishable run payload", formalizeRunPayload(blockedRun.payload), { expectBlocked: true });

  const mismatchOutput = { ...output, runId: "warrant-flow-writer-mismatch", count: 2, matches: output.matches, volumeCount: 0, volumeMatches: [] };
  const mismatchRun = warrantWriter.buildWarrantFlowRunRow(mismatchOutput, mismatchOutput.runId, "complete");
  const mismatchRows = warrantWriter.buildWarrantFlowResultRows(mismatchOutput, mismatchOutput.runId);
  if (Number(mismatchRun.expected_total) === mismatchRows.length) throw new Error("readback mismatch fixture did not mismatch");
  const writerSource = fs.readFileSync(path.join(ROOT, "scripts", "scan-warrant-flow-cache.js"), "utf8");
  if (!writerSource.includes("rows.length !== expectedRows") || !writerSource.includes("complete run refused")) {
    throw new Error("writer missing readback mismatch hard gate before Supabase complete publish");
  }
}

function verifyReceiptShape() {
  const source = fs.readFileSync(path.join(ROOT, "run-warrant-flow.ps1"), "utf8");
  const requiredMarkers = [
    "function Write-WarrantFlowReceipt",
    "strategy = \"warrant-flow\"",
    "status = $Status",
    "exitCode = $ExitCode",
    "complete = $Complete",
    "matches = $Matches",
    "fallback = $false",
    "runId = $RunId",
    "payloadPath = \"supabase:warrant_flow_scan_results\"",
    "blockingReason = $BlockingReason",
    "scan-receipts",
  ];
  const missing = requiredMarkers.filter((marker) => !source.includes(marker));
  if (missing.length) throw new Error(`run-warrant-flow.ps1 receipt shape missing: ${missing.join(",")}`);
}

function verifyNegativeControls() {
  const run = readyRunPayload();
  const ready = formalizeApiPayload({ ...api.buildPayload(readyRows(run.run_id), run), dataContract: { ok: true } });
  for (const field of ["source_snapshot_captured_at", "source_status_at_run", "run_quality_at_publish", "writeBudget", "retentionOk", "fallbackUsed", "fallbackScope", "fallbackAllowed", "fallbackDetails", "evidenceStatus", "unattendedStatus", "blockedReason", "scanner_block_reason"]) {
    const broken = clone(ready);
    delete broken[field];
    expectRejected(`negative missing ${field}`, broken, `missing_${field}`);
  }

  const emptyBad = clone(ready);
  emptyBad.count = 0;
  emptyBad.volumeCount = 0;
  emptyBad.singleSignalCount = 0;
  emptyBad.matches = [];
  emptyBad.rows = [];
  emptyBad.ok = true;
  emptyBad.unattendedStatus = "YES";
  expectRejected("negative empty ok yes", emptyBad, "empty_result_marked_ok_or_yes");

  const snapshotBad = clone(ready);
  snapshotBad.cacheSource = "snapshot-friendly-empty";
  snapshotBad.unattendedStatus = "YES";
  expectRejected("negative snapshot friendly ready", snapshotBad, "snapshot_friendly_empty_marked_ready");

  const contractBad = clone(ready);
  contractBad.dataContract = { ok: false, issues: ["volume_matches_empty"] };
  contractBad.publishAllowed = true;
  contractBad.writeBudget.allowLatestWrite = true;
  expectRejected("negative data contract publish", contractBad, "data_contract_invalid_publish_allowed");

  const sourceBad = clone(ready);
  sourceBad.source_status_at_run = { status: "blocked", ok: false, reason: "source_timeout" };
  sourceBad.publishAllowed = true;
  sourceBad.writeBudget.allowLatestWrite = true;
  expectRejected("negative source not ready latest", sourceBad, "source_not_ready_latest_pointer_updates");

  for (const [field, expected] of [["degradedBlocksLatest", "degradedBlocksLatest_false"], ["preservePreviousGood", "preservePreviousGood_false"]]) {
    const broken = clone(ready);
    broken.source_status_at_run = { status: "blocked", ok: false, reason: "blocked" };
    broken.publishAllowed = false;
    broken.writeBudget.allowLatestWrite = false;
    broken[field] = false;
    expectRejected(`negative ${field}`, broken, expected);
  }

  const businessBad = clone(ready);
  businessBad.rows[0].reason = "";
  try {
    assertBusinessMatrixPayload("negative missing business reason", businessBad);
  } catch (error) {
    if (!String(error.message).includes("reason")) throw error;
    return;
  }
  throw new Error("negative missing business reason was accepted");
}

function main() {
  const checks = [
    ["api formal payloads", verifyApiFormalPayloads],
    ["writer formal payloads", verifyWriterFormalPayloads],
    ["run-warrant-flow receipt shape", verifyReceiptShape],
    ["negative controls", verifyNegativeControls],
  ];
  const issues = [];
  for (const [label, fn] of checks) {
    try {
      fn();
      console.log(`[warrant-prewater-formal] PASS ${label}`);
    } catch (error) {
      issues.push(`${label}: ${error?.message || String(error)}`);
      console.error(`[warrant-prewater-formal] FAIL ${label}: ${error?.message || String(error)}`);
    }
  }
  if (issues.length) process.exit(1);
}

main();
