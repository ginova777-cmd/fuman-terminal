"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boundedScorecardPayload } = require("../lib/daytrade-scorecard-payload");

test("normal writer scorecard preserves identity and false/zero gate evidence", () => {
  const payload = { trade_date: "2026-09-24", writer_run_id: "writer-1", active_symbols: 0,
    scanner_can_run_opening: false, cooldown_until: null, candles: ["large"], quotes: ["large"] };
  assert.deepEqual(boundedScorecardPayload(payload), { trade_date: "2026-09-24",
    writer_run_id: "writer-1", active_symbols: 0, scanner_can_run_opening: false, cooldown_until: null });
  assert.equal(payload.candles.length, 1);
});
test("missing and inherited fields are not fabricated", () => {
  const payload = Object.create({ trade_date: "old" });
  payload.source_status = "blocked";
  assert.deepEqual(boundedScorecardPayload(payload), { source_status: "blocked" });
  assert.deepEqual(boundedScorecardPayload({}), {});
});
test("bounded serialization omits large source arrays", () => {
  const result = boundedScorecardPayload({ canonical_run_id: "run-1", candles: Array(100000).fill("candle") });
  assert.equal(JSON.stringify(result), '{"canonical_run_id":"run-1"}');
});
