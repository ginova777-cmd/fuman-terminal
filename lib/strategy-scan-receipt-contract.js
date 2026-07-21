"use strict";

const MODULES = [
  { key: "strategy2", receiptKey: "strategy2", label: "Strategy2" },
  { key: "strategy3", receiptKey: "strategy3", label: "Strategy3" },
  { key: "strategy4", receiptKey: "strategy4", label: "Strategy4" },
  { key: "strategy5", receiptKey: "strategy5", label: "Strategy5" },
  { key: "institution", receiptKey: "institution", label: "Institution" },
  { key: "cb", receiptKey: "cb-detect", label: "CB" },
  { key: "warrant", receiptKey: "warrant-flow", label: "Warrant" },
];

const CONTRACT = "strategy-scan-receipt-contract-v1";
const NORMALIZATION_SOURCE = "derived_from_existing_receipt_v1";

function bool(value) { return value === true; }
function stringValue(value) { return value === undefined || value === null ? "" : String(value); }
function cleanNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function blockingTextIncludes(row, pattern) {
  const text = [row.status, row.qualityStatus, row.blockingReason, row.scanner_block_reason, row.blockedReason]
    .map((value) => stringValue(value).toLowerCase()).join(" ");
  return pattern.test(text);
}

function normalizeStrategyScanReceipt(row, options = {}) {
  if (!row || typeof row !== "object") return row;
  const key = options.key || row.strategy || "";
  const status = stringValue(row.status);
  const complete = row.complete === true;
  const exitCode = cleanNumber(row.exitCode, 0);
  const runId = stringValue(row.runId);
  const preservedLatest = row.preservedLatest === true || (row.publishBlocked === true && Boolean(runId));
  const rawFallback = row.fallback === true && !preservedLatest;
  const blocked = status !== "complete" || complete !== true || exitCode !== 0 || blockingTextIncludes(row, /blocked|preserve|previous good|source[_ -]?root[_ -]?not[_ -]?ready|not_ready|failed/);
  const preservePreviousGood = typeof row.preservePreviousGood === "boolean"
    ? row.preservePreviousGood
    : Boolean(preservedLatest || row.publishBlocked === true || rawFallback || blocked);
  const publishAllowed = typeof row.publishAllowed === "boolean"
    ? row.publishAllowed
    : Boolean(status === "complete" && complete && exitCode === 0 && !rawFallback && !preservePreviousGood);
  const latestOverwriteAllowed = typeof row.latestOverwriteAllowed === "boolean"
    ? row.latestOverwriteAllowed
    : publishAllowed;
  const latestWriteAttempted = typeof row.latestWriteAttempted === "boolean"
    ? row.latestWriteAttempted
    : publishAllowed;
  const latestPointerUpdated = typeof row.latestPointerUpdated === "boolean"
    ? row.latestPointerUpdated
    : publishAllowed;
  const evidenceStatus = stringValue(row.evidenceStatus || row.run_quality_at_publish?.evidenceStatus || (publishAllowed ? "complete" : "insufficient"));
  const unattendedStatus = stringValue(row.unattendedStatus || row.run_quality_at_publish?.unattendedStatus || (publishAllowed ? "YES" : "NO"));
  const degradedBlocksLatest = typeof row.degradedBlocksLatest === "boolean"
    ? row.degradedBlocksLatest
    : !publishAllowed;
  const blockedReceiptWritten = typeof row.blockedReceiptWritten === "boolean"
    ? row.blockedReceiptWritten
    : preservePreviousGood;
  const runQuality = {
    ...(row.run_quality_at_publish && typeof row.run_quality_at_publish === "object" ? row.run_quality_at_publish : {}),
    publishAllowed,
    latestOverwriteAllowed,
    latestWriteAttempted,
    latestPointerUpdated,
    blockedReceiptWritten,
    degradedBlocksLatest,
    preservePreviousGood,
    fallbackUsed: row.fallbackUsed === true,
    fallbackScope: Array.isArray(row.fallbackScope) ? row.fallbackScope : [],
    fallbackAllowed: row.fallbackAllowed === true,
    fallbackDetails: Array.isArray(row.fallbackDetails) ? row.fallbackDetails : [],
    fallbackContract: row.fallbackContract || `${key || "strategy"}-receipt-normalized-fallback-v1`,
    evidenceStatus,
    unattendedStatus,
    blockedReason: row.blockedReason || row.blockingReason || row.scanner_block_reason || "",
    scanner_block_reason: row.scanner_block_reason || row.blockingReason || row.blockedReason || "",
    resultCount: cleanNumber(row.matches ?? row.resultCount ?? row.count, 0),
  };
  return {
    ...row,
    contract: row.contract || CONTRACT,
    normalizationSource: row.normalizationSource || NORMALIZATION_SOURCE,
    strategy: row.strategy || options.strategy || key,
    fallback: rawFallback,
    preservePreviousGood,
    publishAllowed,
    latestOverwriteAllowed,
    latestWriteAttempted,
    latestPointerUpdated,
    blockedReceiptWritten,
    degradedBlocksLatest,
    evidenceStatus,
    unattendedStatus,
    run_quality_at_publish: runQuality,
  };
}

function receiptContractIssues(row, options = {}) {
  const issues = [];
  if (!row || typeof row !== "object") return ["receipt_missing_or_invalid"];
  const required = [
    "strategy",
    "status",
    "complete",
    "exitCode",
    "fallback",
    "preservePreviousGood",
    "publishAllowed",
    "latestOverwriteAllowed",
    "evidenceStatus",
    "unattendedStatus",
    "run_quality_at_publish",
  ];
  for (const field of required) {
    if (row[field] === undefined || row[field] === null || row[field] === "") issues.push(`missing_${field}`);
  }
  if (typeof row.fallback !== "boolean") issues.push("fallback_not_boolean");
  if (typeof row.preservePreviousGood !== "boolean") issues.push("preservePreviousGood_not_boolean");
  if (typeof row.publishAllowed !== "boolean") issues.push("publishAllowed_not_boolean");
  if (typeof row.latestOverwriteAllowed !== "boolean") issues.push("latestOverwriteAllowed_not_boolean");
  if (!["complete", "insufficient"].includes(String(row.evidenceStatus || ""))) issues.push(`evidenceStatus_invalid:${row.evidenceStatus || "missing"}`);
  if (!["YES", "NO"].includes(String(row.unattendedStatus || ""))) issues.push(`unattendedStatus_invalid:${row.unattendedStatus || "missing"}`);
  if (row.publishAllowed === false && row.latestOverwriteAllowed === true) issues.push("publish_blocked_but_latestOverwriteAllowed_true");
  if (row.preservePreviousGood === true && row.publishAllowed === true) issues.push("preservePreviousGood_true_but_publishAllowed_true");
  if (row.run_quality_at_publish && typeof row.run_quality_at_publish === "object") {
    for (const field of ["publishAllowed", "latestOverwriteAllowed", "preservePreviousGood", "evidenceStatus", "unattendedStatus"]) {
      if (row.run_quality_at_publish[field] === undefined || row.run_quality_at_publish[field] === null || row.run_quality_at_publish[field] === "") {
        issues.push(`run_quality_missing_${field}`);
      }
    }
  } else {
    issues.push("run_quality_at_publish_not_object");
  }
  if (options.requireRunId !== false && row.publishAllowed === true && !row.runId) issues.push("publishAllowed_true_missing_runId");
  return issues;
}

module.exports = {
  CONTRACT,
  NORMALIZATION_SOURCE,
  MODULES,
  normalizeStrategyScanReceipt,
  receiptContractIssues,
};

