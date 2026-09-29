"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectStage, readOpeningEvidence } = require("../lib/mother-pool-opening-evidence");
const date = "2026-09-24", stage = "us_0820";
function fixture() {
  return {
    final: { stage, stage_contract: "opening-report-two-stage-v1", date, run_id: "morning-us", complete: true, status: "complete", exitCode: 0, expected_industry_count: 15, scanned_industry_count: 15, priority_observation_contract_ok: true, priority_observation_count: 0 },
    bridge: { trade_date: date, run_id: "morning-us", status: "BRIDGE_OK", observation_count: 0, industry_count: 0, successful_industry_count: 0, forbidden_publish_guard: true, formal_candidate_count: 0, formal_candidate_allowed: false },
    ack: { trade_date: date, report_run_id: "morning-us", contract: "opening-report-0830-mother-pool-handoff-ack-v2", complete: true, db_readback_ok: true, first_blocker: null, disposition_contract: "opening-report-handoff-dispositions-v1", business_excluded_symbols: [], accepted_symbols: [], accepted_readback_symbols: [], accepted_count: 0, accepted_readback_count: 0, formal_candidate_count: 0, formal_candidate_allowed: false, forbidden_publish_guard: true },
  };
}
test("healthy zero observations requires a complete 15-industry scan", () => {
  const f = fixture(); assert.equal(inspectStage(f, date, stage).bridgeOk, true); assert.equal(inspectStage(f, date, stage).ackOk, true);
  f.final.scanned_industry_count = 14; assert.equal(inspectStage(f, date, stage).bridgeOk, false);
});
test("another stage, day or run cannot satisfy handoff", () => {
  for (const mutate of [f => f.final.stage = "asia_0850", f => f.ack.trade_date = "2026-09-23", f => f.ack.report_run_id = "other"]) {
    const f = fixture(); mutate(f); const r = inspectStage(f, date, stage); assert.equal(r.bridgeOk, false); assert.equal(r.ackOk, false);
  }
});
test("admission uses accepted symbols and requires exact readback", () => {
  const f = fixture(); Object.assign(f.ack, { accepted_symbols: ["2330"], accepted_readback_symbols: ["2330"], accepted_count: 1, accepted_readback_count: 1, business_excluded_symbols: ["2371"], db_readback_symbols: ["2330", "2371"] });
  assert.deepEqual(inspectStage(f, date, stage).symbols, ["2330"]); assert.equal(inspectStage(f, date, stage).ackOk, true);
  f.ack.accepted_readback_symbols = ["2317"]; assert.equal(inspectStage(f, date, stage).ackOk, false);
});
test("both due stages are required and missing evidence fails closed", () => {
  const before = readOpeningEvidence("missing-fixture", date, 8*60+25); assert.equal(before.required, false);
  const after = readOpeningEvidence("missing-fixture", date, 9*60); assert.equal(after.stages.length, 2); assert.equal(after.bridgeOk, false); assert.equal(after.ackOk, false);
});
