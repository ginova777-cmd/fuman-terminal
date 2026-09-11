"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyDelivery } = require("../lib/strategy3-delivery-evidence");
const id = "strategy3v2-recovery-replay-20260911-20260911084738";
function fixture() {
  const row = { key: "strategy3", ok: true, runId: id, count: 2, tradeDate: "2026-09-11" };
  return {
    date: "2026-09-11",
    scan: { run_id: id, trade_date: "2026-09-11", result_count: 2, ok: true, apply: true, results: [{ code: "1560" }, { code: "2305" }] },
    tri: { runId: id, desktopRunId: id, mobileRunId: id, scorecardRunId: id, expectedDate: "20260911", count: 2, complete: true, status: "complete" },
    collection: { ok: true, blobPublished: true, tradeDate: "2026-09-11", reports: [row] },
    current: { sourceReports: [{ ...row }], records: ["2305", "1560"].map(ticker => ({ ticker, record_date: "2026-09-11", strategy: "策略3隔日沖成績單" })) },
    line: { ok: true, run_id: id, date: "20260911", count: 2, line_push_personal_ok: true, line_push_group_ok: true, delivery_evidence: [{ target_type: "personal", sent: true }, { target_type: "group", sent: true }] },
  };
}
test("all evidence agrees", () => assert.equal(verifyDelivery(fixture()).ok, true));
for (const [name, mutate] of [
  ["missing 88", x => { x.collection = null; }],
  ["old complete tri receipt", x => { x.tri.scorecardRunId = "strategy3v2-20260908-old"; }],
  ["same count wrong stock", x => { x.current.records[0].ticker = "9999"; }],
  ["duplicate stock", x => { x.current.records[0].ticker = "1560"; }],
  ["old trade date", x => { x.tri.expectedDate = "20260908"; }],
  ["missing count", x => { delete x.line.count; }],
  ["group missing", x => { x.line.line_push_group_ok = false; }],
  ["no actual delivery evidence", x => { x.line.delivery_evidence = []; }],
  ["88 local only not published", x => { x.collection.blobPublished = false; }],
  ["different current 88 run", x => { x.current.sourceReports[0].runId = "other"; }],
]) test(name, () => { const x = fixture(); mutate(x); assert.equal(verifyDelivery(x).ok, false); });
test("healthy zero results requires explicit zero everywhere", () => {
  const x = fixture(); x.scan.result_count = 0; x.scan.results = []; x.tri.count = 0;
  x.collection.reports[0].count = 0; x.current.sourceReports[0].count = 0;
  x.current.records = []; x.line.count = 0;
  assert.equal(verifyDelivery(x).ok, true);
  delete x.line.count;
  assert.equal(verifyDelivery(x).ok, false);
});
