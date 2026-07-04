"use strict";

const fs = require("fs");
const path = require("path");
const { adaptStrategy5Payload } = require("./strategy5-prewater-payload-adapter");

const FIXTURE_FILE = path.join(__dirname, "..", "fixtures", "strategy5-prewater-fixtures.json");
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return override;
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (key === "extends") continue;
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(result[key], value)
      : value;
  }
  return result;
}

function resolveFixture(fixtures, name, seen = new Set()) {
  const raw = fixtures[name];
  if (!raw) throw new Error(`unknown fixture: ${name}`);
  if (!raw.extends) return deepMerge({}, raw);
  if (seen.has(name)) throw new Error(`fixture inheritance loop: ${[...seen, name].join(" -> ")}`);
  seen.add(name);
  return deepMerge(resolveFixture(fixtures, raw.extends, seen), raw);
}

function isReadyStatus(value) {
  const status = String(value?.status || value || "").toLowerCase();
  return status === "ready" || status === "not_required" || status === "not-required";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function verifyCanonical(name, canonical) {
  const issues = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in canonical)) issues.push(`missing_${field}`);
  }

  const publishAllowed = canonical.publishAllowed === true || canonical.run_quality_at_publish?.publishAllowed === true;
  const resultCount = Number(canonical.resultCount ?? canonical.run_quality_at_publish?.resultCount ?? 0);
  const readbackCount = Number(canonical.readbackCount ?? canonical.run_quality_at_publish?.readbackCount ?? 0);
  const blankCounts = canonical.blankCounts && typeof canonical.blankCounts === "object" ? canonical.blankCounts : {};
  const blankTotal = Object.values(blankCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const evidenceComplete = canonical.evidenceStatus === "complete";
  const unattendedYes = canonical.unattendedStatus === "YES";
  const sourceReady = canonical.sourceReady === true
    && isReadyStatus(canonical.quote_coverage_at_run)
    && isReadyStatus(canonical.intraday_1m_readiness_at_run)
    && isReadyStatus(canonical.ma_readiness_at_run)
    && isReadyStatus(canonical.preopen_futopt_daily_readiness_at_run);
  const fallbackDisclosed = typeof canonical.fallbackUsed === "boolean"
    && Array.isArray(canonical.fallbackScope)
    && typeof canonical.fallbackAllowed === "boolean"
    && Array.isArray(canonical.fallbackDetails)
    && typeof canonical.fallbackContract === "string";
  const shouldBlock = !sourceReady || !publishAllowed || resultCount <= 0 || readbackCount !== resultCount || canonical.fallbackUsed === true || blankTotal > 0;

  if (!canonical.source_snapshot_captured_at) issues.push("source_snapshot_captured_at_missing");
  if (!fallbackDisclosed) issues.push("fallback_disclosure_missing");
  if (!canonical.evidenceStatus) issues.push("evidenceStatus_missing");
  if (canonical.hasEvidenceStatus === false) issues.push("evidenceStatus_missing");
  if (!canonical.unattendedStatus) issues.push("unattendedStatus_missing");
  if (blankTotal > 0) issues.push("business_required_field_blank");
  if (shouldBlock && canonical.latestPointerUpdated) issues.push("blocked_source_updated_latest");
  if (shouldBlock && canonical.emptyResultWritten) issues.push("empty_result_overwrote_previous_good");
  if (shouldBlock && canonical.blockedReceiptWritten !== true) issues.push("blocked_receipt_missing");
  if (shouldBlock && canonical.preservePreviousGood !== true) issues.push("preserve_previous_good_missing");
  if (shouldBlock && canonical.degradedBlocksLatest !== true) issues.push("degradedBlocksLatest_missing");
  if (shouldBlock && !canonical.blockedReason && !canonical.scanner_block_reason) issues.push("blocked_reason_missing");
  if (shouldBlock && evidenceComplete) issues.push("blocked_fixture_claims_complete_evidence");
  if (shouldBlock && unattendedYes) issues.push("blocked_fixture_claims_unattended_yes");
  if (!shouldBlock && !evidenceComplete) issues.push("ready_fixture_not_complete");
  if (!shouldBlock && !unattendedYes) issues.push("ready_fixture_not_unattended_yes");

  return {
    name,
    ok: issues.length === 0,
    shouldBlockLatest: shouldBlock,
    preservePreviousGood: canonical.preservePreviousGood === true,
    blockedReceiptWritten: canonical.blockedReceiptWritten === true,
    evidenceStatus: canonical.evidenceStatus,
    unattendedStatus: canonical.unattendedStatus,
    issues,
  };
}

function verifyFixture(name, fixture) {
  return verifyCanonical(name, adaptStrategy5Payload(fixture, { type: "fixture" }));
}

function mutationCases(base) {
  const cases = [];
  const missingCapturedAt = clone(base);
  delete missingCapturedAt.source_snapshot_captured_at;
  cases.push(["mutation-missing-source-snapshot", missingCapturedAt]);

  const sourceNotReady = clone(base);
  sourceNotReady.source_status_at_run = { status: "critical", ok: false, reason: "mutation_source_not_ready" };
  sourceNotReady.blockedReason = "mutation_source_not_ready";
  sourceNotReady.scanner_block_reason = "mutation_source_not_ready";
  cases.push(["mutation-source-not-ready", sourceNotReady]);

  const emptyResult = clone(base);
  emptyResult.run_quality_at_publish.resultCount = 0;
  emptyResult.run_quality_at_publish.readbackCount = 0;
  emptyResult.blockedReason = "mutation_empty_result";
  emptyResult.scanner_block_reason = "mutation_empty_result";
  cases.push(["mutation-empty-result", emptyResult]);

  const fallbackUsed = clone(base);
  fallbackUsed.fallbackUsed = true;
  fallbackUsed.fallbackScope = ["display-only"];
  fallbackUsed.fallbackDetails = [{ source: "display-only" }];
  fallbackUsed.fallbackAllowed = false;
  fallbackUsed.blockedReason = "mutation_fallback_used";
  fallbackUsed.scanner_block_reason = "mutation_fallback_used";
  cases.push(["mutation-fallback-used", fallbackUsed]);

  const readbackMismatch = clone(base);
  readbackMismatch.run_quality_at_publish.readbackCount = Number(readbackMismatch.run_quality_at_publish.resultCount || 0) + 1;
  readbackMismatch.blockedReason = "mutation_readback_mismatch";
  readbackMismatch.scanner_block_reason = "mutation_readback_mismatch";
  cases.push(["mutation-readback-mismatch", readbackMismatch]);

  const fakeYes = clone(sourceNotReady);
  fakeYes.unattendedStatus = "YES";
  fakeYes.evidenceStatus = "complete";
  cases.push(["mutation-fake-yes", fakeYes]);

  return cases;
}

function verifyMutationGate(fixtures) {
  const ready = resolveFixture(fixtures, "ready");
  return mutationCases(ready).map(([name, payload]) => {
    const result = verifyFixture(name, payload);
    return {
      name,
      ok: result.ok === false,
      expectedFailure: true,
      verifierIssues: result.issues,
    };
  });
}

function main() {
  const fixtureIndex = process.argv.indexOf("--fixture");
  const payloadIndex = process.argv.indexOf("--payload");
  const typeIndex = process.argv.indexOf("--type");
  const requested = process.argv.find((arg) => arg.startsWith("--fixture="))?.split("=")[1]
    || (fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : "")
    || "";
  const payloadFile = process.argv.find((arg) => arg.startsWith("--payload="))?.split("=")[1]
    || (payloadIndex >= 0 ? process.argv[payloadIndex + 1] : "")
    || "";
  const payloadType = process.argv.find((arg) => arg.startsWith("--type="))?.split("=")[1]
    || (typeIndex >= 0 ? process.argv[typeIndex + 1] : "auto");
  const data = readJson(FIXTURE_FILE);
  const results = [];
  if (payloadFile) {
    results.push(verifyCanonical(`payload:${payloadType}:${payloadFile}`, adaptStrategy5Payload(readJson(payloadFile), { type: payloadType })));
  } else if (process.argv.includes("--sample-mutations")) {
    results.push(...verifyMutationGate(data.fixtures));
  } else {
    const names = requested ? [requested] : Object.keys(data.fixtures);
    results.push(...names.map((name) => verifyFixture(name, resolveFixture(data.fixtures, name))));
  }
  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  if (failed.length) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  REQUIRED_FIELDS,
  resolveFixture,
  verifyCanonical,
  verifyFixture,
  verifyMutationGate,
};
