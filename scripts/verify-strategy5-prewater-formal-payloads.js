"use strict";

const assert = require("assert");

const {
  buildStrategy5RunRow,
  buildStrategy5ResultRows,
} = require("./scan-strategy5-cache");
const strategy5Api = require("../api/strategy5-latest");
const { adaptStrategy5Payload } = require("./strategy5-prewater-payload-adapter");
const { verifyCanonical } = require("./verify-strategy5-prewater-fixtures");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sampleOutput() {
  const updatedAt = "2026-07-04T02:00:00.000Z";
  const matches = [
    {
      code: "2330",
      name: "台積電",
      close: 1000,
      price: 1000,
      percent: 1.2,
      tradeVolume: 5000,
      volume: 5000,
      score: 91,
      reason: "chip/institutional formal payload sample",
      matches: [{ id: "chip_k_confluence", reason: "chip ready", score: 91 }],
      activeMatch: { id: "chip_k_confluence", reason: "chip ready" },
    },
    {
      code: "2317",
      name: "鴻海",
      close: 220,
      price: 220,
      percent: 0.8,
      tradeVolume: 4200,
      volume: 4200,
      score: 88,
      reason: "chip/institutional formal payload sample",
      matches: [{ id: "volume_turnover_breakout", reason: "volume ready", score: 88 }],
      activeMatch: { id: "volume_turnover_breakout", reason: "volume ready" },
    },
  ];
  return {
    ok: true,
    runId: "strategy5-formal-sample-run",
    source: "formal-payload-sample",
    updatedAt,
    startedAt: updatedAt,
    generatedDate: "20260704",
    usedDate: "20260704",
    sourceDate: "20260704",
    schedule: "formal payload verifier",
    fullScan: true,
    complete: true,
    total: 2,
    scannedThisRun: 2,
    scannedCodes: matches.map((row) => row.code),
    count: matches.length,
    resultReadbackCount: matches.length,
    qualityStatus: "complete",
    retentionOk: true,
    sourceHealth: {
      coverageStatus: "ready",
      latestTradeDate: "2026-07-04",
      institutionalRows: 1800,
      marginRows: 1800,
      unifiedRows: 1800,
      validAfterExclusionRows: 1800,
      minRequiredRows: 1500,
      healthReason: "formal sample chip source ready",
    },
    dataFreshness: {
      coverageStatus: "ready",
      latestTradeDate: "2026-07-04",
      reason: "formal sample ready",
    },
    matches,
  };
}

function sampleApiPayload() {
  const output = sampleOutput();
  const resultRows = buildStrategy5ResultRows(output, output.runId);
  const runRow = buildStrategy5RunRow(output, output.runId, "complete");
  const run = {
    ...runRow,
    readback_count: resultRows.length,
    payload: runRow.payload,
  };
  return strategy5Api._test.buildPayload(resultRows, run, {
    canvas: true,
    chipSourceHealth: {
      coverage_status: "ready",
      latest_trade_date: "2026-07-04",
      institutional_rows: 1800,
      margin_rows: 1800,
      unified_rows: 1800,
      valid_after_exclusion_rows: 1800,
      min_required_rows: 1500,
      stale_days: 0,
      reason: "formal sample chip source ready",
    },
  });
}

function expectPass(name, payload, type) {
  const result = verifyCanonical(name, adaptStrategy5Payload(payload, { type }));
  assert.strictEqual(result.ok, true, `${name} expected PASS: ${result.issues.join(",")}`);
  return result;
}

function expectFail(name, payload, type, expectedIssue) {
  const result = verifyCanonical(name, adaptStrategy5Payload(payload, { type }));
  assert.strictEqual(result.ok, false, `${name} expected FAIL`);
  if (expectedIssue) {
    assert(
      result.issues.some((issue) => String(issue).includes(expectedIssue)),
      `${name} expected issue containing ${expectedIssue}, got ${result.issues.join(",")}`
    );
  }
  return result;
}

function main() {
  const output = sampleOutput();
  const runRow = buildStrategy5RunRow(output, output.runId, "complete");
  const resultRows = buildStrategy5ResultRows(output, output.runId);
  const scannerPayload = {
    ...runRow.payload,
    count: resultRows.length,
    resultCount: resultRows.length,
    resultReadbackCount: resultRows.length,
    run_quality_at_publish: {
      ...runRow.payload.run_quality_at_publish,
      resultCount: resultRows.length,
      readbackCount: resultRows.length,
    },
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    latestPointerUpdated: true,
    blockedReceiptWritten: false,
  };
  const apiPayload = sampleApiPayload();

  const results = [
    expectPass("writer-run-payload", runRow.payload, "scanner"),
    expectPass("scanner-result-readback-payload", scannerPayload, "scanner"),
    expectPass("api-latest-payload", apiPayload, "api"),
  ];

  const missingCapturedAt = clone(apiPayload);
  delete missingCapturedAt.source_snapshot_captured_at;
  delete missingCapturedAt.sourceSnapshotCapturedAt;
  if (missingCapturedAt.runTimeSourceSnapshot) delete missingCapturedAt.runTimeSourceSnapshot.source_snapshot_captured_at;
  if (missingCapturedAt.run_time_source_snapshot) delete missingCapturedAt.run_time_source_snapshot.source_snapshot_captured_at;
  results.push(expectFail("missing-source-snapshot-captured-at", missingCapturedAt, "api", "source_snapshot_captured_at_missing"));

  const sourceNotReadyAllowsLatest = clone(apiPayload);
  sourceNotReadyAllowsLatest.source_status_at_run = { status: "critical", ok: false, reason: "formal_source_not_ready" };
  sourceNotReadyAllowsLatest.publishGate.publishAllowed = true;
  sourceNotReadyAllowsLatest.publishGate.latestOverwriteAllowed = true;
  sourceNotReadyAllowsLatest.run_quality_at_publish.publishAllowed = true;
  sourceNotReadyAllowsLatest.latestPointerUpdated = true;
  results.push(expectFail("source-not-ready-allows-latest", sourceNotReadyAllowsLatest, "api", "blocked_source_updated_latest"));

  const emptyResultOverwrites = clone(apiPayload);
  emptyResultOverwrites.count = 0;
  emptyResultOverwrites.resultCount = 0;
  emptyResultOverwrites.run_quality_at_publish.resultCount = 0;
  emptyResultOverwrites.run_quality_at_publish.readbackCount = 0;
  emptyResultOverwrites.latestPointerUpdated = true;
  emptyResultOverwrites.emptyResultWritten = true;
  results.push(expectFail("empty-result-overwrites-previous-good", emptyResultOverwrites, "api", "empty_result_overwrote_previous_good"));

  const fallbackDisplayOnly = clone(apiPayload);
  fallbackDisplayOnly.fallbackUsed = true;
  fallbackDisplayOnly.fallbackScope = ["display-only"];
  fallbackDisplayOnly.fallbackDetails = [{ source: "display-only" }];
  fallbackDisplayOnly.fallbackAllowed = false;
  fallbackDisplayOnly.latestPointerUpdated = true;
  results.push(expectFail("fallback-display-only", fallbackDisplayOnly, "api", "blocked_source_updated_latest"));

  const formalSourceFallback = clone(apiPayload);
  formalSourceFallback.fallbackUsed = true;
  formalSourceFallback.fallbackScope = ["formal-source"];
  formalSourceFallback.fallbackDetails = [{ source: "formal-source", reason: "mutation formal source fallback must not publish" }];
  formalSourceFallback.fallbackAllowed = false;
  formalSourceFallback.fallbackContract = "strategy5-formal-source-fallback-blocks-latest";
  formalSourceFallback.run_quality_at_publish.fallbackUsed = true;
  formalSourceFallback.run_quality_at_publish.fallbackScope = ["formal-source"];
  formalSourceFallback.run_quality_at_publish.fallbackDetails = formalSourceFallback.fallbackDetails;
  formalSourceFallback.run_quality_at_publish.fallbackAllowed = false;
  formalSourceFallback.run_quality_at_publish.fallbackContract = formalSourceFallback.fallbackContract;
  formalSourceFallback.latestPointerUpdated = true;
  results.push(expectFail("formal-source-fallback", formalSourceFallback, "api", "blocked_source_updated_latest"));

  const missingEvidenceStatus = clone(apiPayload);
  delete missingEvidenceStatus.evidenceStatus;
  if (missingEvidenceStatus.unattended) delete missingEvidenceStatus.unattended.evidenceStatus;
  if (missingEvidenceStatus.run_quality_at_publish) delete missingEvidenceStatus.run_quality_at_publish.evidenceStatus;
  results.push(expectFail("missing-evidence-status", missingEvidenceStatus, "api", "evidenceStatus_missing"));

  const readbackMismatch = clone(apiPayload);
  readbackMismatch.run_quality_at_publish.readbackCount = Number(readbackMismatch.run_quality_at_publish.resultCount || 0) + 1;
  readbackMismatch.latestPointerUpdated = true;
  results.push(expectFail("readback-mismatch", readbackMismatch, "api", "blocked_source_updated_latest"));

  const fakeYes = clone(sourceNotReadyAllowsLatest);
  fakeYes.evidenceStatus = "complete";
  fakeYes.unattendedStatus = "YES";
  fakeYes.unattended.status = "YES";
  results.push(expectFail("fake-unattended-yes", fakeYes, "api", "blocked_fixture_claims_unattended_yes"));

  const previousGoodMissing = clone(apiPayload);
  previousGoodMissing.source_status_at_run = { status: "critical", ok: false, reason: "formal_previous_good_missing" };
  previousGoodMissing.publishGate.publishAllowed = false;
  previousGoodMissing.publishGate.latestOverwriteAllowed = false;
  previousGoodMissing.run_quality_at_publish.publishAllowed = false;
  previousGoodMissing.preservePreviousGood = false;
  previousGoodMissing.run_quality_at_publish.preservePreviousGood = false;
  previousGoodMissing.latestPointerUpdated = false;
  previousGoodMissing.blockedReceiptWritten = true;
  previousGoodMissing.evidenceStatus = "insufficient";
  previousGoodMissing.unattendedStatus = "NO";
  previousGoodMissing.unattended.status = "NO";
  results.push(expectFail("previous-good-not-preserved", previousGoodMissing, "api", "preserve_previous_good_missing"));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    results,
  }, null, 2));
}

if (require.main === module) main();

module.exports = {
  clone,
  sampleOutput,
  sampleApiPayload,
  expectPass,
  expectFail,
};
