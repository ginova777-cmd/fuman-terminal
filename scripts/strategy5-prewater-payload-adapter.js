"use strict";

const fs = require("fs");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|ok|ready|complete|allowed)$/i.test(String(value).trim());
}

function numberValue(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function nested(object, path) {
  return String(path || "").split(".").filter(Boolean).reduce((cursor, part) => {
    if (!cursor || typeof cursor !== "object") return undefined;
    return cursor[part];
  }, object);
}

function firstPath(object, paths) {
  for (const path of paths) {
    const value = nested(object, path);
    if (value !== undefined && value !== null && !(typeof value === "string" && !value.trim())) return value;
  }
  return undefined;
}

function sourceStatusReady(value) {
  if (!isObject(value)) return false;
  const status = String(value.status || value.coverageStatus || value.coverage_status || value.sourceStatus || "").toLowerCase();
  if (["not_required", "not-required", "not_applicable", "skipped"].includes(status)) return true;
  if (!["ready", "ok", "complete", "fresh"].includes(status)) return false;
  return value.ok !== false && value.ready !== false;
}

function adaptStrategy5Payload(raw, options = {}) {
  const type = options.type || raw?.type || "auto";
  const payload = isObject(raw?.payload) && type === "scanner" ? raw.payload : raw;
  const snapshot = firstValue(payload.runTimeSourceSnapshot, payload.run_time_source_snapshot, payload.sourceSnapshot, payload.source_snapshot, {});
  const quality = firstValue(
    payload.run_quality_at_publish,
    snapshot?.run_quality_at_publish,
    payload.runQualityAtPublish,
    payload.run_quality,
    {}
  );
  const publishGate = isObject(payload.publishGate) ? payload.publishGate : {};
  const fallback = isObject(payload.fallback) ? payload.fallback : {};
  const unattended = isObject(payload.unattended) ? payload.unattended : {};
  const receiptGate = isObject(payload.gateDecision) ? payload.gateDecision : {};
  const badSource = isObject(payload.badSource) ? payload.badSource : {};
  const assertions = isObject(payload.assertions) ? payload.assertions : {};
  const previousGood = isObject(payload.previousGood) ? payload.previousGood : {};
  const after = isObject(payload.after) ? payload.after : {};

  const resultCount = numberValue(firstValue(
    quality.resultCount,
    payload.resultCount,
    payload.count,
    badSource.resultCount,
    previousGood.count
  ), 0);
  const readbackCount = numberValue(firstValue(
    quality.readbackCount,
    quality.resultReadbackCount,
    payload.resultReadbackCount,
    payload.transport?.resultReadbackCount,
    previousGood.resultReadbackCount
  ), resultCount);
  const publishAllowed = boolValue(firstValue(
    quality.publishAllowed,
    payload.publishAllowed,
    publishGate.publishAllowed,
    receiptGate.publishAllowed
  ), false);
  const latestOverwriteAllowed = boolValue(firstValue(
    payload.latestOverwriteAllowed,
    publishGate.latestOverwriteAllowed,
    receiptGate.latestOverwriteAllowed
  ), publishAllowed);
  const fallbackUsed = boolValue(firstValue(
    payload.fallbackUsed,
    quality.fallbackUsed,
    fallback.used
  ), false);
  const fallbackScope = firstValue(payload.fallbackScope, quality.fallbackScope, []);
  const fallbackDetails = firstValue(payload.fallbackDetails, quality.fallbackDetails, []);
  const sourceStatusAtRun = firstValue(
    payload.source_status_at_run,
    snapshot?.source_status_at_run,
    payload.chip_source_status_at_run,
    payload.sourceStatusAtRun,
    badSource.status ? { status: badSource.status, ok: false, reason: badSource.reason } : undefined,
    payload.sourceCoverage
  );
  const sourceReady = sourceStatusReady(sourceStatusAtRun);
  const blockedReason = String(firstValue(
    payload.blockedReason,
    payload.blocked_reason,
    payload.scanner_block_reason,
    quality.blockedReason,
    quality.scanner_block_reason,
    publishGate.reason,
    badSource.reason,
    ""
  ) || "");
  const explicitEvidenceStatus = firstValue(
    payload.evidenceStatus,
    unattended.evidenceStatus,
    quality.evidenceStatus
  );
  const unattendedStatus = String(firstValue(
    payload.unattendedStatus,
    unattended.status,
    quality.unattendedStatus,
    publishAllowed ? "YES" : "NO"
  ));
  const evidenceStatus = String(firstValue(
    explicitEvidenceStatus,
    sourceReady && publishAllowed ? "complete" : "insufficient"
  ));

  return {
    type,
    source_snapshot_captured_at: firstValue(payload.source_snapshot_captured_at, snapshot?.source_snapshot_captured_at, payload.sourceSnapshotCapturedAt, payload.checkedAt, ""),
    source_status_at_run: sourceStatusAtRun,
    quote_coverage_at_run: firstValue(payload.quote_coverage_at_run, snapshot?.quote_coverage_at_run, { status: "not_required", ok: true }),
    intraday_1m_readiness_at_run: firstValue(payload.intraday_1m_readiness_at_run, snapshot?.intraday_1m_readiness_at_run, { status: "not_required", ok: true }),
    ma_readiness_at_run: firstValue(payload.ma_readiness_at_run, snapshot?.ma_readiness_at_run, { status: "not_required", ok: true }),
    preopen_futopt_daily_readiness_at_run: firstValue(payload.preopen_futopt_daily_readiness_at_run, snapshot?.preopen_futopt_daily_readiness_at_run, { status: "not_required", ok: true }),
    run_quality_at_publish: quality,
    fallbackUsed,
    fallbackScope: Array.isArray(fallbackScope) ? fallbackScope : [],
    fallbackAllowed: boolValue(firstValue(payload.fallbackAllowed, quality.fallbackAllowed), !fallbackUsed),
    fallbackDetails: Array.isArray(fallbackDetails) ? fallbackDetails : [],
    fallbackContract: String(firstValue(payload.fallbackContract, quality.fallbackContract, fallback.contract, "strategy5-fallback-disallowed-for-publish")),
    degradedBlocksLatest: boolValue(firstValue(payload.degradedBlocksLatest, quality.degradedBlocksLatest, receiptGate.degradedBlocksLatest), true),
    preservePreviousGood: boolValue(firstValue(payload.preservePreviousGood, quality.preservePreviousGood, receiptGate.preservePreviousGood), true),
    writeBudget: firstValue(payload.writeBudget, quality.writeBudget, {}),
    retentionOk: boolValue(firstValue(payload.retentionOk, quality.retentionOk, payload.retention?.ok), false),
    evidenceStatus,
    hasEvidenceStatus: explicitEvidenceStatus !== undefined || type === "receipt",
    unattendedStatus,
    requiredFields: firstValue(payload.requiredFields, quality.requiredFields, {}),
    blankCounts: firstValue(payload.blankCounts, quality.blankCounts, {}),
    sampleMissingRows: firstValue(payload.sampleMissingRows, quality.sampleMissingRows, []),
    blockedReason,
    scanner_block_reason: String(firstValue(payload.scanner_block_reason, quality.scanner_block_reason, blockedReason, "")),
    resultCount,
    readbackCount,
    publishAllowed,
    latestOverwriteAllowed,
    latestPointerUpdated: boolValue(firstValue(payload.latestPointerUpdated, after.latestPointerUpdated), latestOverwriteAllowed),
    emptyResultWritten: boolValue(firstValue(payload.emptyResultWritten, payload.writeAttempt?.wroteRows === 0 ? false : undefined), false),
    blockedReceiptWritten: boolValue(firstValue(payload.blockedReceiptWritten, Boolean(payload.ok && (payload.receiptFile || payload.receiptPath)), assertions.latestPointerUnchanged), false),
    sourceReady,
    original: raw,
  };
}

function readPayload(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const inputIndex = process.argv.indexOf("--input");
  const typeIndex = process.argv.indexOf("--type");
  const input = process.argv.find((arg) => arg.startsWith("--input="))?.split("=")[1]
    || (inputIndex >= 0 ? process.argv[inputIndex + 1] : "");
  const type = process.argv.find((arg) => arg.startsWith("--type="))?.split("=")[1]
    || (typeIndex >= 0 ? process.argv[typeIndex + 1] : "auto");
  if (!input) throw new Error("missing --input <json>");
  console.log(JSON.stringify(adaptStrategy5Payload(readPayload(input), { type }), null, 2));
}

if (require.main === module) main();

module.exports = {
  adaptStrategy5Payload,
  sourceStatusReady,
};
