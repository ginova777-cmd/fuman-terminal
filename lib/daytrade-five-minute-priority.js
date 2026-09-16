"use strict";
const { isEffectiveRow } = require("../scripts/daytrade-intraday-5m-coverage-contract");
const { fiveMinuteAligned } = require("./daytrade-mother-pool-snapshot");
const SIGNALS = ["rsi3_cross_rsi6_up_5m", "kd_5_3_golden_cross_5m", "macd_3_9_3_golden_cross_5m", "ma5_cross_ma10_up_5m", "ma10_cross_ma20_up_5m", "ma5_cross_ma20_up_5m"];
function intradayWindow(now, tradeDate) {
  const local = new Date(now + 28800000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return local.toISOString().slice(0, 10) === tradeDate && minute >= 540 && minute < 810;
}
function applyFiveMinutePriority(pool, bars, receipt, snapshot, now = Date.now()) {
  const tradeDate = snapshot?.snapshot?.trade_date;
  const evidence = { contract: "daytrade_intraday_5m_priority_v1", trade_date: tradeDate || null,
    checked_at: new Date(now).toISOString(), run_id: receipt?.run_id || null,
    mother_pool_run_id: snapshot?.runId || null, status: "blocked", promoted_symbols: [],
    rejected_symbols: [], first_blocker: null, formal_candidate_allowed: false, publish_allowed: false };
  const result = pool.slice();
  for (const key of Object.keys(pool)) if (!/^\d+$/.test(key)) result[key] = pool[key];
  result.fiveMinutePriorityEvidence = evidence;
  const finish = reason => { evidence.first_blocker = reason; return result; };
  if (!intradayWindow(now, tradeDate)) { evidence.status = "not_due"; return finish("outside_intraday_window"); }
  if (!snapshot?.ok || !receipt || !fiveMinuteAligned(receipt, snapshot)) return finish("five_minute_snapshot_mismatch");
  if (pool.length !== snapshot.symbols.size || pool.some(row => !snapshot.symbols.has(String(row.symbol)))) return finish("mother_pool_membership_changed_pending_5m");
  if (receipt.complete !== true || receipt.status !== "complete" || receipt.exit_code !== 0 || receipt.first_blocker) return finish("five_minute_receipt_not_verified");
  const stamp = Date.parse(receipt.verified_at);
  if (!Number.isFinite(stamp) || stamp > now || now - stamp > 600000) return finish("five_minute_receipt_stale");
  const requested = new Set(receipt.requested_symbols || []), strong = new Set(), duplicates = new Set();
  const seen = new Set();
  for (const bar of bars) { if (seen.has(bar.symbol)) duplicates.add(bar.symbol); seen.add(bar.symbol); }
  if (duplicates.size || seen.size !== requested.size || [...requested].some(symbol => !seen.has(symbol))
      || bars.some(bar => bar.trade_date !== tradeDate || bar.run_id !== receipt.run_id)) {
    return finish("five_minute_pinned_readback_incomplete");
  }
  const identity = { tradeDate, runId: receipt.run_id, asOfMs: now, maxStaleSeconds: 600 };
  for (const bar of bars) {
    if (duplicates.has(bar.symbol) || !snapshot.symbols.has(bar.symbol) || !requested.has(bar.symbol) ||
        !isEffectiveRow(bar, identity) || bar.trend_5m_status !== "CONFIRMED_STRONG_5M" ||
        bar.golden_cross_any_5m !== true || !SIGNALS.some(key => bar[key] === true)) {
      evidence.rejected_symbols.push(bar.symbol); continue;
    }
    strong.add(bar.symbol);
  }
  // Stable ordering preserves existing priorities among equally qualified rows.
  result.sort((a, b) => Number(strong.has(String(b.symbol))) - Number(strong.has(String(a.symbol))));
  evidence.promoted_symbols = result.filter(row => strong.has(String(row.symbol))).map(row => String(row.symbol));
  evidence.status = "evaluated";
  return result;
}
module.exports = { applyFiveMinutePriority, intradayWindow };

function verifyPriorityPublication(expected, actual) {
  const failed = [], evidence = expected?.fiveMinutePriorityEvidence;
  if (!evidence || evidence.status !== "evaluated") failed.push(evidence?.first_blocker || "priority_not_evaluated");
  if (evidence?.mother_pool_run_id !== expected?.motherPoolSnapshotRunId) failed.push("priority_snapshot_changed_before_publication");
  for (const key of ["tradeDate", "canonicalRunId", "motherPoolSnapshotRunId", "motherPoolSnapshotSequence",
    "daytradeMotherPoolSymbols", "daytradePrioritySymbols", "daytradeHotPoolSymbols", "daytradeFormalPrioritySymbols",
    "daytradeCandlePrioritySymbols", "fiveMinutePriorityEvidence"]) {
    if (expected?.[key] === undefined || JSON.stringify(expected[key]) !== JSON.stringify(actual?.[key])) failed.push(`readback_mismatch:${key}`);
  }
  const members = new Set(expected?.daytradeMotherPoolSymbols || []);
  for (const symbol of evidence?.promoted_symbols || []) {
    if (!members.has(symbol)) failed.push(`promoted_nonmember:${symbol}`);
    if (!(actual?.daytradeCandlePrioritySymbols || []).includes(symbol)) failed.push(`candle_priority_missing:${symbol}`);
  }
  return { contract: "daytrade_intraday_5m_priority_publication_receipt_v1", scope: "priority_artifact_readback_only",
    checked_at: new Date().toISOString(), trade_date: expected?.tradeDate || null,
    canonical_run_id: expected?.canonicalRunId || null, mother_pool_run_id: expected?.motherPoolSnapshotRunId || null,
    snapshot_sequence: expected?.motherPoolSnapshotSequence || null, five_minute_run_id: evidence?.run_id || null,
    promoted_symbols: evidence?.promoted_symbols || [], status: failed.length ? "blocked" : "complete", complete: !failed.length,
    failed_checks: failed, first_blocker: failed[0] || null, exit_code: failed.length ? 1 : 0,
    collector_consumption_verified: false, overall_intraday_complete: false };
}
module.exports.verifyPriorityPublication = verifyPriorityPublication;
