"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const institutionApi = require("../api/institution-latest");
const {
  buildInstitutionRunRow,
  buildInstitutionResultRows,
} = require("./scan-institution-cache");

const ROOT = path.resolve(__dirname, "..");
const MIN_ROWS = 1500;
const REQUIRED_FIELDS = ["foreign", "trust", "dealer", "total"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function numberValue(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isObject(value) && Object.keys(value).length === 0) continue;
    return value;
  }
  return "";
}

function nested(object, dotted) {
  return String(dotted || "").split(".").filter(Boolean).reduce((cursor, part) => cursor?.[part], object);
}

function rowsFrom(payload) {
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.records)) return payload.records;
  if (isObject(payload.data)) return Object.values(payload.data);
  return [];
}

function fieldPresent(row, names) {
  return names.some((name) => {
    const value = nested(row, name);
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
}

function sourceFrom(payload) {
  const coverage = payload.sourceCoverage || payload.source_coverage || payload.sourceHealth || {};
  const runQuality = payload.run_quality_at_publish || {};
  const status = firstNonBlank(
    payload.institution_source_status_at_run,
    payload.chip_source_status_at_run,
    payload.source_status_at_run,
    runQuality.institution_source_status_at_run,
    runQuality.chip_source_status_at_run,
    runQuality.source_status_at_run,
    payload.sourceStatusAtRun,
    coverage
  ) || {};
  const rows = rowsFrom(payload);
  const sourceRows = numberValue(firstNonBlank(status.institutionalRows, status.institutional_rows, status.sourceRows, coverage.institutionalRows, coverage.institutional_rows, coverage.sourceRows));
  const resultRows = numberValue(firstNonBlank(status.validAfterExclusionRows, status.valid_after_exclusion_rows, status.resultRows, coverage.validAfterExclusionRows, coverage.valid_after_exclusion_rows, coverage.resultRows, payload.count, rows.length));
  return {
    raw: status,
    hasInstitutionChipStatus: Boolean(payload.institution_source_status_at_run || payload.chip_source_status_at_run || runQuality.institution_source_status_at_run || runQuality.chip_source_status_at_run),
    coverageStatus: String(firstNonBlank(status.coverageStatus, status.coverage_status, status.status, coverage.coverageStatus, coverage.coverage_status, coverage.status)).toLowerCase(),
    latestTradeDate: String(firstNonBlank(status.latestTradeDate, status.latest_trade_date, coverage.latestTradeDate, coverage.latest_trade_date)),
    usedDate: String(firstNonBlank(status.usedDate, status.used_date, coverage.usedDate, coverage.used_date, payload.usedDate, payload.tradeDate)),
    institutionalRows: sourceRows,
    validAfterExclusionRows: resultRows,
    sourceRows,
    resultRows,
    sources: [
      ...new Set([
        ...(Array.isArray(status.sources) ? status.sources : []),
        ...(Array.isArray(coverage.sources) ? coverage.sources : []),
        ...(Array.isArray(coverage.sourceLabels) ? coverage.sourceLabels : []),
        ...rows.map((row) => row.source || row.data_contract_source || row.dataContractSource || "").filter(Boolean),
      ].map(String)),
    ],
  };
}

function canonical(name, payload, type) {
  const quality = payload.run_quality_at_publish || {};
  const fallbackUsed = payload.fallbackUsed === true || quality.fallbackUsed === true;
  const fallbackDetails = Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : Array.isArray(quality.fallbackDetails) ? quality.fallbackDetails : [];
  const fallbackContract = payload.fallbackContract || quality.fallbackContract || "";
  const source = sourceFrom(payload);
  const resultCount = numberValue(firstNonBlank(quality.resultCount, payload.resultCount, payload.count, rowsFrom(payload).length));
  const readbackCount = numberValue(firstNonBlank(quality.readbackCount, payload.readbackCount, payload.resultReadbackCount), resultCount);
  const publishAllowed = payload.publishAllowed === true || quality.publishAllowed === true;
  const latestPointerUpdated = payload.latestPointerUpdated === true || quality.latestPointerUpdated === true || payload.latestOverwriteAllowed === true;
  const latestWriteAttempted = payload.latestWriteAttempted === true || quality.latestWriteAttempted === true || latestPointerUpdated;
  const writeBudget = payload.writeBudget || quality.writeBudget || {};
  return {
    name,
    type,
    payload,
    quality,
    source,
    sourceSnapshotCapturedAt: payload.source_snapshot_captured_at || payload.sourceSnapshotCapturedAt || "",
    resultCount,
    readbackCount,
    publishAllowed,
    latestPointerUpdated,
    latestWriteAttempted,
    overwrotePreviousGood: payload.overwrotePreviousGood === true || quality.overwrotePreviousGood === true,
    blockedReceiptWritten: payload.blockedReceiptWritten === true || quality.blockedReceiptWritten === true || Boolean(payload.blockedReceipt || payload.blockedReceiptPath || payload.receiptPath),
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    degradedBlocksLatest: payload.degradedBlocksLatest === true || quality.degradedBlocksLatest === true,
    writeBudgetAllowed: writeBudget.allowed === true,
    evidenceStatus: String(firstNonBlank(payload.evidenceStatus, quality.evidenceStatus)),
    unattendedStatus: String(firstNonBlank(payload.unattendedStatus, quality.unattendedStatus)),
    blockedReason: String(firstNonBlank(payload.blockedReason, payload.scanner_block_reason, payload.blockingReason, payload.reason, quality.blockedReason, quality.scanner_block_reason)),
    scannerBlockReason: String(firstNonBlank(payload.scanner_block_reason, payload.blockedReason, payload.blockingReason, payload.reason, quality.scanner_block_reason, quality.blockedReason)),
    fallbackUsed,
    fallbackDetails,
    fallbackContract,
  };
}

function verifyCanonical(name, payload, type) {
  const c = canonical(name, payload, type);
  const issues = [];
  const rows = rowsFrom(payload);
  const sourceUnavailable = /timeout|522|error|blocked|degraded/.test(`${c.source.coverageStatus} ${c.source.raw?.status || ""} ${c.source.raw?.httpStatus || ""}`);
  const shouldBlock = sourceUnavailable
    || c.source.institutionalRows < MIN_ROWS
    || c.source.validAfterExclusionRows < MIN_ROWS
    || c.resultCount <= 0
    || c.readbackCount !== c.resultCount
    || c.fallbackUsed;

  const push = (condition, id, detail = {}) => {
    if (!condition) issues.push({ id, ...detail });
  };

  push(Boolean(c.sourceSnapshotCapturedAt), "missing_source_snapshot_captured_at");
  push(c.source.hasInstitutionChipStatus, "missing_institution_chip_source_status");
  push(Boolean(c.source.coverageStatus), "coverageStatus_missing");
  push(sourceUnavailable || Boolean(c.source.latestTradeDate || c.source.usedDate), "latestTradeDate_usedDate_missing");
  push(c.source.sources.some((item) => /TWSE T86/i.test(item)), "twse_t86_source_missing");
  push(c.source.sources.some((item) => /TPEx 3itrade/i.test(item)), "tpex_3itrade_source_missing");
  for (const [field, aliases] of Object.entries({
    foreign: ["foreign", "foreignNet", "foreign_net", "payload.foreign", "payload.foreignNet", "payload.foreign_net"],
    trust: ["trust", "trustNet", "investmentTrustNet", "investment_trust_net", "payload.trust", "payload.trustNet", "payload.investment_trust_net"],
    dealer: ["dealer", "dealerNet", "dealer_net", "payload.dealer", "payload.dealerNet", "payload.dealer_net"],
    total: ["total", "totalNet", "institutionTotalNet", "institution_total_net", "payload.total", "payload.totalNet", "payload.institution_total_net"],
  })) {
    push(rows.every((row) => fieldPresent(row, aliases)), `${field}_field_incomplete`);
  }
  push(Boolean(c.evidenceStatus), "evidenceStatus_missing");
  push(Boolean(c.unattendedStatus), "unattendedStatus_missing");
  push(Array.isArray(c.fallbackDetails), "fallbackDetails_missing");
  push(Boolean(c.fallbackContract), "fallbackContract_missing");

  if (c.source.institutionalRows < MIN_ROWS) push(!c.publishAllowed, "institutionalRows_below_1500_but_publishAllowed_true");
  if (c.source.validAfterExclusionRows < MIN_ROWS) push(c.unattendedStatus !== "YES", "validAfterExclusionRows_below_1500_but_unattendedStatus_yes");
  if (c.resultCount <= 0) push(!c.latestPointerUpdated, "empty_result_updated_latest_pointer");
  if (/522|timeout|error/.test(`${c.source.coverageStatus} ${c.source.raw?.status || ""} ${c.source.raw?.httpStatus || ""}`)) {
    push(c.evidenceStatus !== "complete", "supabase_522_or_timeout_evidenceStatus_complete");
  }
  if (c.fallbackUsed) {
    push(c.fallbackDetails.length > 0, "fallbackUsed_without_fallbackDetails");
    push(Boolean(c.fallbackContract), "fallbackUsed_without_fallbackContract");
    push(!c.latestPointerUpdated, "fallback_display_only_updated_latest_pointer");
  }
  if (shouldBlock) {
    push(!c.latestWriteAttempted, "blocked_latestWriteAttempted_true");
    push(!c.latestPointerUpdated, "blocked_latestPointerUpdated_true");
    push(!c.overwrotePreviousGood, "blocked_overwrotePreviousGood_true");
    push(c.blockedReceiptWritten, "blockedReceiptWritten_not_true");
    push(c.preservePreviousGood, "preservePreviousGood_not_true");
    push(c.degradedBlocksLatest, "degradedBlocksLatest_not_true");
    push(!c.writeBudgetAllowed, "writeBudget_allowed_true");
    push(c.unattendedStatus === "NO", "blocked_unattendedStatus_not_NO");
    push(c.evidenceStatus === "insufficient", "blocked_evidenceStatus_not_insufficient");
    push(Boolean(c.blockedReason), "blocked_run_missing_blockedReason");
    push(Boolean(c.scannerBlockReason), "blocked_run_missing_scanner_block_reason");
  } else {
    push(c.evidenceStatus === "complete", "ready_evidenceStatus_not_complete");
    push(c.unattendedStatus === "YES", "ready_unattendedStatus_not_YES");
  }

  return { name, type, ok: issues.length === 0, issues, shouldBlock, preservePreviousGood: c.preservePreviousGood };
}

function institutionRows(count) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const code = String(1000 + index).slice(-4).padStart(4, "0");
    rows.push({
      code,
      name: `Institution ${code}`,
      rank: index + 1,
      close: 100 + index,
      percent: 1,
      tradeVolume: 5000 + index,
      value: 1000000 + index,
      foreign: 100 + index,
      trust: 50 + index,
      dealer: 25 + index,
      total: 175 + index * 3,
      foreignNet: 100 + index,
      foreign_net: 100 + index,
      trustNet: 50 + index,
      investmentTrustNet: 50 + index,
      investment_trust_net: 50 + index,
      dealerNet: 25 + index,
      dealer_net: 25 + index,
      totalNet: 175 + index * 3,
      total_net: 175 + index * 3,
      institutionTotalNet: 175 + index * 3,
      institution_total_net: 175 + index * 3,
      foreignTrustBuyVolumePct: 3.5,
      foreignTrustVolumePct: 3.5,
      institutionBuyVolumePct: 3.5,
      foreignStreak: 2,
      foreign_streak: 2,
      trustStreak: 1,
      trust_streak: 1,
      jointStreak: 1,
      joint_streak: 1,
      source: index % 2 === 0 ? "TWSE T86" : "TPEx 3itrade",
      dataContractSource: "institution-cache",
      data_contract_source: "institution-cache",
    });
  }
  return rows;
}

function sampleOutput() {
  const updatedAt = "2026-07-04T02:00:00.000Z";
  const rows = institutionRows(1600);
  return {
    ok: true,
    runId: "institution-strict-formal-run",
    source: "official TWSE T86 / TPEx 3itrade strict sample",
    updatedAt,
    startedAt: updatedAt,
    usedDate: "20260704",
    sourceCount: rows.length,
    scannedCount: rows.length,
    readbackCount: rows.length,
    count: rows.length,
    sourceDates: { twse: "20260704", tpex: "20260704" },
    sources: ["TWSE T86", "TPEx 3itrade"],
    data: Object.fromEntries(rows.map((row) => [row.code, row])),
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: false,
    fallbackDetails: [],
    sourceHealth: {
      coverageStatus: "ready",
      latestTradeDate: "2026-07-04",
      institutionalRows: rows.length,
      validAfterExclusionRows: rows.length,
      minRequiredRows: MIN_ROWS,
      reason: "strict formal sample ready",
    },
  };
}

function scannerRunPayload() {
  const output = sampleOutput();
  const run = buildInstitutionRunRow(output, output.runId, "complete");
  return {
    ...run.payload,
    count: output.count,
    resultCount: output.count,
    readbackCount: output.count,
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    latestWriteAttempted: true,
    latestPointerUpdated: true,
    overwrotePreviousGood: false,
    blockedReceiptWritten: false,
    rows: Object.values(output.data),
  };
}

function apiLatestPayload() {
  const output = sampleOutput();
  const resultRows = buildInstitutionResultRows(output, output.runId);
  const runRow = buildInstitutionRunRow(output, output.runId, "complete");
  return institutionApi._test.buildPayload(resultRows, runRow, {
    canvas: true,
    compact: true,
    limit: 120,
    sourceHealth: {
      coverage_status: "ready",
      latest_trade_date: "2026-07-04",
      institutional_rows: resultRows.length,
      valid_after_exclusion_rows: resultRows.length,
      min_required_rows: MIN_ROWS,
      reason: "strict formal sample ready",
      institutional_latest_updated_at: "2026-07-04T02:00:00.000Z",
    },
  });
}

function scanReceiptPayload() {
  const payload = scannerRunPayload();
  return {
    ...payload,
    strategy: "institution",
    label: "institution raw refresh",
    status: "complete",
    complete: true,
    matches: payload.resultCount,
    runId: "institution-strict-formal-run",
    publishAllowed: true,
    latestOverwriteAllowed: true,
  };
}

function blockedReceiptPayload() {
  return {
    strategy: "institution",
    label: "institution blocked publish",
    checkedAt: "2026-07-04T02:00:00.000Z",
    source_snapshot_captured_at: "2026-07-04T02:00:00.000Z",
    institution_source_status_at_run: {
      ok: false,
      status: "timeout",
      coverageStatus: "timeout",
      institutionalRows: 0,
      validAfterExclusionRows: 0,
      sourceRows: 0,
      resultRows: 0,
      sources: ["TWSE T86", "TPEx 3itrade"],
    },
    chip_source_status_at_run: {
      ok: false,
      status: "timeout",
      coverageStatus: "timeout",
      institutionalRows: 0,
      validAfterExclusionRows: 0,
      sourceRows: 0,
      resultRows: 0,
      sources: ["TWSE T86", "TPEx 3itrade"],
    },
    sourceCoverage: { coverageStatus: "timeout", sourceLabels: ["TWSE T86", "TPEx 3itrade"] },
    run_quality_at_publish: {
      publishAllowed: false,
      fallbackUsed: false,
      fallbackDetails: [],
      fallbackContract: "institution-fallback-disclosure-v1",
      resultCount: 0,
      readbackCount: 0,
      latestWriteAttempted: false,
      latestPointerUpdated: false,
      overwrotePreviousGood: false,
      blockedReceiptWritten: true,
      preservePreviousGood: true,
      degradedBlocksLatest: true,
      writeBudget: { allowed: false },
    },
    fallbackUsed: false,
    fallbackDetails: [],
    fallbackContract: "institution-fallback-disclosure-v1",
    publishAllowed: false,
    latestOverwriteAllowed: false,
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    overwrotePreviousGood: false,
    blockedReceiptWritten: true,
    preservePreviousGood: true,
    degradedBlocksLatest: true,
    writeBudget: { allowed: false },
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    blockedReason: "source_status_timeout",
    scanner_block_reason: "source_status_timeout",
    rows: [],
  };
}

function battleOutputPayload() {
  const payload = apiLatestPayload();
  return {
    ...payload,
    source_snapshot_captured_at: payload.source_snapshot_captured_at || "2026-07-04T02:00:00.000Z",
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    rows: payload.rows,
  };
}

function assertRunInstitutionReceiptFormat() {
  const file = path.join(ROOT, "run-institution.ps1");
  const text = fs.readFileSync(file, "utf8");
  for (const marker of [
    "Write-InstitutionReceipt",
    "Write-InstitutionBlockedReceipt",
    "source_snapshot_captured_at",
    "institution_source_status_at_run",
    "chip_source_status_at_run",
    "latestWriteAttempted",
    "latestPointerUpdated",
    "overwrotePreviousGood",
    "blockedReceiptWritten",
    "preservePreviousGood",
    "degradedBlocksLatest",
    "writeBudget",
    "evidenceStatus",
    "unattendedStatus",
    "fallbackContract",
    "blockedReason",
    "scanner_block_reason",
    "blockedReceiptPath",
  ]) {
    assert(text.includes(marker), `run-institution.ps1 missing ${marker}`);
  }
}

function expectPass(name, payload, type) {
  const result = verifyCanonical(name, payload, type);
  assert.strictEqual(result.ok, true, `${name} expected PASS: ${JSON.stringify(result.issues)}`);
  return result;
}

function expectFail(name, payload, type, expectedIssue) {
  const result = verifyCanonical(name, payload, type);
  assert.strictEqual(result.ok, false, `${name} expected FAIL`);
  assert(result.issues.some((issue) => issue.id === expectedIssue), `${name} expected ${expectedIssue}, got ${JSON.stringify(result.issues)}`);
  return { ...result, expectedIssue };
}

function negativeCases(base) {
  const cases = [];
  const add = (name, payload, expected) => cases.push({ name, payload, expected });
  const missingSnapshot = clone(base);
  delete missingSnapshot.source_snapshot_captured_at;
  add("missing-source-snapshot-captured-at", missingSnapshot, "missing_source_snapshot_captured_at");

  const missingStatus = clone(base);
  delete missingStatus.institution_source_status_at_run;
  delete missingStatus.chip_source_status_at_run;
  add("missing-institution-chip-source-status", missingStatus, "missing_institution_chip_source_status");

  const lowPublish = clone(base);
  lowPublish.institution_source_status_at_run.institutionalRows = 1499;
  lowPublish.chip_source_status_at_run.institutionalRows = 1499;
  lowPublish.sourceCoverage.institutionalRows = 1499;
  lowPublish.publishAllowed = true;
  lowPublish.run_quality_at_publish.publishAllowed = true;
  add("institutionalRows-lt-1500-publishAllowed-true", lowPublish, "institutionalRows_below_1500_but_publishAllowed_true");

  const lowYes = clone(base);
  lowYes.institution_source_status_at_run.validAfterExclusionRows = 1499;
  lowYes.chip_source_status_at_run.validAfterExclusionRows = 1499;
  lowYes.sourceCoverage.validAfterExclusionRows = 1499;
  lowYes.unattendedStatus = "YES";
  add("validAfterExclusionRows-lt-1500-unattended-yes", lowYes, "validAfterExclusionRows_below_1500_but_unattendedStatus_yes");

  const emptyLatest = clone(blockedReceiptPayload());
  emptyLatest.institution_source_status_at_run.coverageStatus = "ready";
  emptyLatest.institution_source_status_at_run.status = "ready";
  emptyLatest.institution_source_status_at_run.institutionalRows = 1600;
  emptyLatest.institution_source_status_at_run.validAfterExclusionRows = 1600;
  emptyLatest.chip_source_status_at_run = clone(emptyLatest.institution_source_status_at_run);
  emptyLatest.latestPointerUpdated = true;
  emptyLatest.run_quality_at_publish.latestPointerUpdated = true;
  add("empty-result-updates-latest-pointer", emptyLatest, "empty_result_updated_latest_pointer");

  const supabase522 = clone(blockedReceiptPayload());
  supabase522.institution_source_status_at_run.status = "error";
  supabase522.institution_source_status_at_run.coverageStatus = "error";
  supabase522.institution_source_status_at_run.httpStatus = 522;
  supabase522.chip_source_status_at_run = clone(supabase522.institution_source_status_at_run);
  supabase522.evidenceStatus = "complete";
  add("supabase-522-evidence-complete", supabase522, "supabase_522_or_timeout_evidenceStatus_complete");

  const fallbackUpdates = clone(blockedReceiptPayload());
  fallbackUpdates.institution_source_status_at_run.coverageStatus = "ready";
  fallbackUpdates.institution_source_status_at_run.status = "ready";
  fallbackUpdates.institution_source_status_at_run.institutionalRows = 1600;
  fallbackUpdates.institution_source_status_at_run.validAfterExclusionRows = 1600;
  fallbackUpdates.chip_source_status_at_run = clone(fallbackUpdates.institution_source_status_at_run);
  fallbackUpdates.run_quality_at_publish.resultCount = 10;
  fallbackUpdates.run_quality_at_publish.readbackCount = 10;
  fallbackUpdates.fallbackUsed = true;
  fallbackUpdates.fallbackDetails = [{ scope: "display-only" }];
  fallbackUpdates.fallbackContract = "institution-fallback-disclosure-v1";
  fallbackUpdates.latestPointerUpdated = true;
  fallbackUpdates.run_quality_at_publish.latestPointerUpdated = true;
  add("fallback-display-only-updates-latest", fallbackUpdates, "fallback_display_only_updated_latest_pointer");

  const noReason = clone(blockedReceiptPayload());
  delete noReason.blockedReason;
  delete noReason.scanner_block_reason;
  add("blocked-run-missing-reason", noReason, "blocked_run_missing_blockedReason");

  const noPreserve = clone(blockedReceiptPayload());
  noPreserve.preservePreviousGood = false;
  noPreserve.run_quality_at_publish.preservePreviousGood = false;
  add("blocked-run-preservePreviousGood-false", noPreserve, "preservePreviousGood_not_true");

  return cases;
}

function main() {
  assertRunInstitutionReceiptFormat();
  const apiPayload = apiLatestPayload();
  const scannerPayload = scannerRunPayload();
  const results = [
    expectPass("api-latest-payload", apiPayload, "api"),
    expectPass("scanner-run-payload", scannerPayload, "scanner"),
    expectPass("scan-receipt", scanReceiptPayload(), "receipt"),
    expectPass("blocked-receipt", blockedReceiptPayload(), "receipt"),
    expectPass("battle-output", battleOutputPayload(), "battle-output"),
  ];
  for (const item of negativeCases(apiPayload)) {
    results.push(expectFail(item.name, item.payload, "negative", item.expected));
  }
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    contract: "institution-prewater-strict-formal-payload-v1",
    supabaseRead: false,
    supabaseWrite: false,
    deploy: false,
    results,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  apiLatestPayload,
  scannerRunPayload,
  scanReceiptPayload,
  blockedReceiptPayload,
  battleOutputPayload,
  verifyCanonical,
  negativeCases,
  sampleOutput,
  main,
};
