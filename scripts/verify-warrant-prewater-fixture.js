"use strict";

const fs = require("fs");
const path = require("path");
const { auditRunTimeSourceSnapshot } = require("../lib/run-time-source-snapshot-contract");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_FILE = path.join(ROOT, "fixtures", "warrant-prewater-fixtures.json");
const FIXTURE_ALIASES = new Map([
  ["stale-1m", "stale-1m"],
  ["quote-low", "quote-low"],
  ["source-timeout", "source-timeout"],
  ["fallback-used", "fallback-used"],
  ["empty-result", "empty-result"],
  ["supabase-timeout", "source-timeout"],
  ["source-status-timeout", "source-timeout"],
  ["supabase-522", "supabase-522"],
  ["readback-mismatch", "readback-mismatch"],
  ["data-contract-invalid", "data-contract-invalid"],
  ["snapshot-friendly-empty", "snapshot-friendly-empty"],
  ["futopt-stale", "futopt-stale"],
  ["ma-insufficient", "ma-insufficient"],
  ["degraded-run", "degraded-run"],
  ["ready", "ready"],
]);

const REQUIRED_FIELDS = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
  "fallbackUsed",
  "fallbackScope",
  "fallbackAllowed",
  "fallbackDetails",
  "fallbackContract",
  "degradedBlocksLatest",
  "preservePreviousGood",
  "writeBudget",
  "retentionOk",
  "evidenceStatus",
  "unattendedStatus",
  "requiredFields",
  "blankCounts",
  "sampleMissingRows",
  "blockedReason",
  "scanner_block_reason",
];

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const splitAt = body.indexOf("=");
    if (splitAt === -1) flags.add(body);
    else values.set(body.slice(0, splitAt), body.slice(splitAt + 1));
  }
  return { values, flags };
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function hasOwn(value, field) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, field);
}

function sourceReady(payload) {
  return payload?.source_status_at_run?.ok === true
    && !["blocked", "failed", "error", "timeout", "stale", "degraded"].includes(String(payload?.source_status_at_run?.status || "").toLowerCase());
}

function latestWriteAllowed(payload) {
  return payload?.publishAllowed === true
    || payload?.writeBudget?.allowLatestWrite === true
    || payload?.run_quality_at_publish?.publishAllowed === true
    || payload?.run_quality_at_publish?.writeBudget?.allowLatestWrite === true;
}

function fallbackDisclosed(payload) {
  if (!Object.prototype.hasOwnProperty.call(payload, "fallbackUsed")) return false;
  if (!Array.isArray(payload.fallbackScope)) return false;
  if (!Object.prototype.hasOwnProperty.call(payload, "fallbackAllowed")) return false;
  if (!Array.isArray(payload.fallbackDetails)) return false;
  if (!payload.fallbackContract || typeof payload.fallbackContract !== "object") return false;
  if (payload.fallbackUsed === true && (!payload.fallbackScope.length || !payload.fallbackDetails.length)) return false;
  return true;
}

function verifyCase(name, entry) {
  const issues = [];
  const payload = entry?.payload || {};
  const expect = entry?.expect || {};
  const snapshotAudit = auditRunTimeSourceSnapshot(payload);
  const missingRequired = REQUIRED_FIELDS.filter((field) => !hasOwn(payload, field));
  const shouldBlock = expect.blockLatest === true;
  const shouldPreserve = expect.preservePreviousGood === true;
  const emptyResult = Number(payload.count || 0) === 0 && Array.isArray(payload.matches) && payload.matches.length === 0;
  const blockEvidence = payload.degradedBlocksLatest === true
    || payload.writeBudget?.allowLatestWrite === false
    || payload.run_quality_at_publish?.publishAllowed === false;

  if (missingRequired.length) issues.push(`required_fields_missing:${missingRequired.join(",")}`);
  if (!hasValue(payload.source_snapshot_captured_at)) issues.push("source_snapshot_captured_at_missing");
  if (!fallbackDisclosed(payload)) issues.push("fallback_disclosure_missing");
  if (payload.fallbackUsed === true && payload.fallbackScope.length === 0) issues.push("fallback_used_without_scope");
  if (payload.fallbackUsed === true && payload.fallbackDetails.length === 0) issues.push("fallback_used_without_details");
  if (!payload.evidenceStatus) issues.push("evidenceStatus_missing");
  if (payload.unattendedStatus === "YES" && (payload.evidenceStatus !== "complete" || !sourceReady(payload) || payload.fallbackUsed === true)) {
    issues.push("unattendedStatus_fake_YES");
  }
  if (!snapshotAudit.ok && payload.evidenceStatus === "complete") issues.push(`snapshot_incomplete_but_complete:${snapshotAudit.missingFields.join(",")}`);
  if (shouldBlock && !blockEvidence) issues.push("source_not_ready_but_latest_not_blocked");
  if (!sourceReady(payload) && latestWriteAllowed(payload)) issues.push("source_not_ready_but_writes_latest");
  if (emptyResult && latestWriteAllowed(payload)) issues.push("empty_result_overwrites_previous_good");
  if (shouldPreserve && payload.preservePreviousGood !== true) issues.push("preserve_previous_good_missing");
  if (shouldBlock && !payload.blockedReceipt) issues.push("blocked_receipt_missing");
  if (shouldBlock && payload.unattendedStatus === "YES") issues.push("blocked_fixture_returned_YES");
  if (expect.evidenceStatus && payload.evidenceStatus !== expect.evidenceStatus) issues.push(`evidenceStatus_${payload.evidenceStatus || "missing"}_expected_${expect.evidenceStatus}`);
  if (expect.unattendedStatus && payload.unattendedStatus !== expect.unattendedStatus) issues.push(`unattendedStatus_${payload.unattendedStatus || "missing"}_expected_${expect.unattendedStatus}`);

  return {
    name,
    ok: issues.length === 0,
    issues,
    blockLatest: shouldBlock,
    preservePreviousGood: payload.preservePreviousGood === true,
    blockedReceipt: Boolean(payload.blockedReceipt),
    evidenceStatus: payload.evidenceStatus || "",
    unattendedStatus: payload.unattendedStatus || "",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8"));
  const requested = String(args.values.get("fixture") || "").trim();
  const names = requested
    ? [FIXTURE_ALIASES.get(requested) || requested]
    : Object.keys(raw);

  const unknown = names.filter((name) => !raw[name]);
  if (unknown.length) {
    console.error(`[warrant-prewater-fixture] unknown fixture: ${unknown.join(", ")}`);
    process.exit(2);
  }

  const results = names.map((name) => verifyCase(name, raw[name]));
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`[warrant-prewater-fixture] ${status} ${result.name} blockLatest=${result.blockLatest} preservePreviousGood=${result.preservePreviousGood} blockedReceipt=${result.blockedReceipt} evidenceStatus=${result.evidenceStatus} unattendedStatus=${result.unattendedStatus}`);
    for (const issue of result.issues) console.error(`- ${result.name}: ${issue}`);
  }
  if (results.some((result) => !result.ok)) process.exit(1);
}

main();
