"use strict";

const assert = require("assert");
const {
  applyLeaderFreshness,
  assessLeaderFreshness,
  summarizeReceiptFreshness,
} = require("../lib/opening-report-asia-freshness");

const tradeDate = "2026-08-28";
const staleKorea = {
  name: "SK hynix",
  yahoo_symbol: "000660.KS",
  ok: true,
  source_time: "2026-08-27T06:00:00.000Z",
  percent: 1.53,
  direction: "positive",
  display: "偏強",
};
const freshKorea = {
  name: "Daeduck",
  yahoo_symbol: "353200.KS",
  ok: true,
  source_time: "2026-08-28T00:00:04.000Z",
  percent: 1.2,
  direction: "positive",
  display: "偏強",
};
const usClose = {
  name: "Micron",
  yahoo_symbol: "MU",
  ok: true,
  source_time: "2026-08-27T20:00:00.000Z",
  percent: 2.1,
  direction: "positive",
  display: "偏強",
};

const normalizedStale = applyLeaderFreshness(staleKorea, tradeDate);
const normalizedFresh = applyLeaderFreshness(freshKorea, tradeDate);
const normalizedUs = applyLeaderFreshness(usClose, tradeDate);

assert.strictEqual(assessLeaderFreshness(staleKorea, tradeDate).fresh, false);
assert.strictEqual(normalizedStale.ok, false);
assert.strictEqual(normalizedStale.source_gap, true);
assert.strictEqual(normalizedStale.percent, null);
assert.strictEqual(normalizedStale.reason_code, "asia_source_stale_or_outside_0800_0820_window");

assert.strictEqual(assessLeaderFreshness(freshKorea, tradeDate).fresh, true);
assert.strictEqual(normalizedFresh.ok, true);
assert.strictEqual(normalizedFresh.percent, 1.2);

assert.strictEqual(assessLeaderFreshness(usClose, tradeDate).required, false);
assert.strictEqual(normalizedUs.ok, true);

const summary = summarizeReceiptFreshness({
  industries: [{ leaders: [normalizedStale, normalizedFresh, normalizedUs] }],
}, tradeDate);
assert.strictEqual(summary.stale_promoted_count, 0);
assert.strictEqual(summary.source_gap_count, 1);

console.log(JSON.stringify({
  ok: true,
  contract: "opening_report_asia_freshness_fixtures_v1",
  stale_asia_source_gap: normalizedStale.reason_code,
  fresh_asia_leader_accepted: normalizedFresh.name,
  unaffected_us_leader: normalizedUs.name,
}, null, 2));
