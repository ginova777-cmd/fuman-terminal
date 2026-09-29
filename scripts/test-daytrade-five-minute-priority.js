"use strict";
const assert = require("node:assert/strict");
const { applyFiveMinutePriority } = require("../lib/daytrade-five-minute-priority");
const { snapshotIdentity } = require("../lib/daytrade-mother-pool-snapshot");
const now = Date.parse("2026-09-16T04:00:00Z");
const snapshot = { ok: true, runId: "snapshot-1", symbols: new Set(["2330", "2303"]), snapshot: {
  trade_date: "2026-09-16", canonical_run_id: "fugle_daytrade_source:20260916:canonical", mother_pool_run_id: "snapshot-1",
  snapshot_sequence: 1, snapshot_type: "INTRADAY_FULL_SNAPSHOT", effective_at: "2026-09-16T02:00:00Z" } };
const receipt = { run_id: "five-minute-test", trade_date: "2026-09-16", complete: true, status: "complete", exit_code: 0,
  verified_at: "2026-09-16T03:59:00Z", requested_symbols: ["2330", "2303"], diagnostic_summary: { mother_pool_snapshot: snapshotIdentity(snapshot) } };
const pool = [{ symbol: "2330", payload: { formal_pool_eligible: true } }, { symbol: "2303", payload: { formal_pool_eligible: false } }];
pool.basePoolMeta = { count: 2 };
const bar = { symbol: "2303", trade_date: receipt.trade_date, run_id: receipt.run_id, source: "fugle_stock_intraday_candles_timeframe_5",
  volume_unit: "lots", volume_available: true, is_synthetic: false, bar_end: "2026-09-16T04:00:00Z", bar_count: 5,
  bar_complete: true, confirmation_eligible: true, bar_kind: "regular_session", data_gap_5m: false,
  trend_5m_strategy_version: "golden-cross-any-macd-3-9-3-v4", calculation_version: "five-minute-indicators-macd-3-9-3-v4",
  classification_contract: "daytrade_intraday_5m_branch_independent_strict_wait_v1", trend_5m_status: "CONFIRMED_STRONG_5M",
  golden_cross_any_5m: true, rsi3_cross_rsi6_up_5m: true };
const waitBar = {...bar,symbol:"2330",trend_5m_status:"WAIT_5M_CONFIRMATION",golden_cross_any_5m:false,rsi3_cross_rsi6_up_5m:false};
const good = applyFiveMinutePriority(pool, [waitBar,bar], receipt, snapshot, now);
assert.deepEqual(good.map(r => r.symbol), ["2303", "2330"]);
assert.equal(good.basePoolMeta, pool.basePoolMeta);
assert.equal(good[0], pool[1], "ranking cannot modify formal eligibility");
for (const bad of [{bar_end:"2026-09-16T03:00:00Z"}, {run_id:"old"}, {is_synthetic:true}, {volume_unit:null},
  {data_gap_5m:true}, {golden_cross_any_5m:false}, {rsi3_cross_rsi6_up_5m:null}, {bar_end:"2026-09-16T04:05:00Z"}]) {
  assert.deepEqual(applyFiveMinutePriority(pool, [waitBar,{...bar,...bad}], receipt, snapshot, now).map(r=>r.symbol), ["2330","2303"]);
}
assert.equal(applyFiveMinutePriority(pool, [waitBar,bar], receipt, snapshot, Date.parse("2026-09-16T00:55:00Z")).fiveMinutePriorityEvidence.status,"not_due");
assert.equal(applyFiveMinutePriority(pool, [waitBar,bar], receipt, snapshot, Date.parse("2026-09-16T05:30:00Z")).fiveMinutePriorityEvidence.status,"not_due");
assert.equal(applyFiveMinutePriority(pool,[waitBar,bar],{...receipt,complete:false},snapshot,now).fiveMinutePriorityEvidence.status,"blocked");
assert.deepEqual(applyFiveMinutePriority(pool,[waitBar,bar,bar],receipt,snapshot,now).fiveMinutePriorityEvidence.promoted_symbols,[]);
console.log("PASS intraday priority: time, source, freshness, run, snapshot, duplicate rejection, metadata and eligibility preservation");
const { verifyPriorityPublication } = require("../lib/daytrade-five-minute-priority");
const artifact = { tradeDate: receipt.trade_date, canonicalRunId: snapshot.snapshot.canonical_run_id,
  motherPoolSnapshotRunId: snapshot.runId, motherPoolSnapshotSequence: 1,
  daytradeMotherPoolSymbols: ["2303", "2330"], daytradePrioritySymbols: ["2330"], daytradeHotPoolSymbols: ["2330"],
  daytradeFormalPrioritySymbols: ["2330"], daytradeCandlePrioritySymbols: ["2303", "2330"], fiveMinutePriorityEvidence: good.fiveMinutePriorityEvidence };
assert.equal(verifyPriorityPublication(artifact, JSON.parse(JSON.stringify(artifact))).complete, true);
assert.equal(verifyPriorityPublication(artifact, { ...artifact, daytradeCandlePrioritySymbols: ["2330"] }).complete, false);
assert.equal(verifyPriorityPublication(artifact, null).complete, false);
assert.equal(verifyPriorityPublication(artifact, artifact).overall_intraday_complete, false);
console.log("PASS priority publication readback receipt rejects missing or changed publication");
assert.equal(applyFiveMinutePriority(pool,[],receipt,snapshot,now).fiveMinutePriorityEvidence.first_blocker,"five_minute_pinned_readback_incomplete");
assert.equal(applyFiveMinutePriority(pool,[bar],receipt,snapshot,now).fiveMinutePriorityEvidence.first_blocker,"five_minute_pinned_readback_incomplete");
