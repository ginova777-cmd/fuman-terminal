"use strict";

const scorecard = require("../api/scorecard.js");
const { buildScorecardFixture } = require("./scorecard-prewater-fixture");

const testApi = scorecard.__test;
if (!testApi?.buildPayloadFromSnapshotPayload || !testApi?.validateScorecardPayload) {
  console.error("[scorecard-runtime-payload] issue=runtime_test_exports_missing rawOk=false");
  process.exit(1);
}

const payload = testApi.buildPayloadFromSnapshotPayload(buildScorecardFixture(), {
  snapshot: {
    key: "scorecard_latest",
    tradeDate: "20260704",
    updatedAt: "2026-07-04T06:00:00.000Z",
    source: "fixture",
  },
});
const result = testApi.validateScorecardPayload(payload);

if (!result.rawOk) {
  console.error(`[scorecard-runtime-payload] rawOk=false issues=${result.issues.join(",")}`);
  process.exit(1);
}

const first = payload.records[0] || {};
console.log([
  "[scorecard-runtime-payload]",
  "rawOk=true",
  `rows=${payload.records.length}`,
  `audit=${payload.audit?.unattendedStatus}`,
  `firstEvidence=${first.evidenceStatus}`,
  `firstSnapshot=${first.source_snapshot_captured_at}`,
  `firstFallback=${first.fallbackUsed}`,
].join(" "));
