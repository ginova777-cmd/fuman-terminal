"use strict";

const scorecard = require("../api/scorecard.js");
const { buildScorecardFixture } = require("./scorecard-prewater-fixture");

const testApi = scorecard.__test;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function basePayload() {
  return testApi.buildPayloadFromSnapshotPayload(buildScorecardFixture(), {
    snapshot: {
      key: "scorecard_latest",
      tradeDate: "20260704",
      updatedAt: "2026-07-04T06:00:00.000Z",
      source: "fixture",
    },
  });
}

function expectIssue(label, mutate, expectedIssue) {
  const payload = clone(basePayload());
  mutate(payload);
  const result = testApi.validateScorecardPayload(payload);
  const hit = result.issues.includes(expectedIssue);
  console.log(`[scorecard-mutation] mutation=${label} expected=${expectedIssue} issues=${result.issues.join(",") || "none"} rawOk=${result.rawOk}`);
  if (result.rawOk || !hit) {
    throw new Error(`${label} expected issue ${expectedIssue}, got ${result.issues.join(",") || "none"}`);
  }
}

const clean = testApi.validateScorecardPayload(basePayload());
if (!clean.rawOk) {
  throw new Error(`base payload should be clean, got ${clean.issues.join(",")}`);
}

expectIssue("missing evidenceStatus", (payload) => {
  delete payload.records[0].evidenceStatus;
}, "row_0_missing_evidence_status");

expectIssue("missing source_snapshot_captured_at", (payload) => {
  payload.records[0].source_snapshot_captured_at = "";
}, "row_0_missing_source_snapshot_captured_at");

expectIssue("fallbackUsed=true", (payload) => {
  payload.records[0].fallbackUsed = true;
}, "row_0_fallback_used");

expectIssue("blankCounts > 0", (payload) => {
  payload.records[0].blankCounts.ticker = 1;
}, "row_0_blank_required_field");

expectIssue("blockers > 0 but publishAllowed=true", (payload) => {
  payload.records[0].blockers = ["forced_blocker"];
  payload.records[0].publishAllowed = true;
}, "row_0_blockers_publish_allowed_conflict");

expectIssue("empty rows", (payload) => {
  payload.records = [];
}, "empty_rows");

expectIssue("cacheSource != supabase-snapshot", (payload) => {
  payload.cacheSource = "json-snapshot";
}, "cache_source_not_supabase_snapshot");

expectIssue("qualityStatus != complete", (payload) => {
  payload.qualityStatus = "degraded";
}, "quality_status_not_complete");

console.log("[scorecard-mutation] PASS all scorecard mutation gates fail closed");
