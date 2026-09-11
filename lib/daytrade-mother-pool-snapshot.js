"use strict";
const fs = require("fs"), path = require("path");
const canonicalRunId = date => `fugle_daytrade_source:${date.replace(/-/g, "")}:canonical`;
function inspectSnapshot(snapshot, tradeDate) {
  const failedChecks = [], raw = snapshot || {};
  const list = Array.isArray(raw.symbols) ? raw.symbols.map(String) : [];
  const symbols = new Set(list), removed = new Set(raw.removed_symbols || []);
  const membership = new Map((raw.symbol_membership || []).map(row => [String(row.symbol), row]));
  const runId = String(raw.mother_pool_run_id || "");
  if (raw.contract !== "daytrade_mother_pool_snapshot_v1" || raw.contract_version !== "4.1.0") failedChecks.push("mother_pool_snapshot_contract_mismatch");
  if (raw.trade_date !== tradeDate || raw.canonical_run_id !== canonicalRunId(tradeDate)) failedChecks.push("mother_pool_snapshot_trade_date_or_canonical_mismatch");
  if (raw.complete !== true || raw.status !== "complete" || raw.exit_code !== 0 || raw.first_blocker) failedChecks.push("mother_pool_snapshot_not_complete");
  if (!runId || !Number.isInteger(raw.snapshot_sequence) || raw.snapshot_sequence < 1 || !raw.snapshot_type || !Number.isFinite(Date.parse(raw.effective_at)) || Date.parse(raw.effective_at)>Date.now()) failedChecks.push("mother_pool_snapshot_identity_missing_or_invalid");
  if (!list.length || symbols.size !== list.length || raw.symbol_count !== symbols.size || list.some(s => !/^\d{4}$/.test(s))) failedChecks.push("mother_pool_snapshot_symbol_count_mismatch");
  for (const symbol of symbols) {
    const row = membership.get(symbol);
    if (!row || row.mother_pool_run_id !== runId || row.mother_pool_snapshot_sequence !== raw.snapshot_sequence || !row.membership_effective_at || !["ACTIVE", "PENDING_DOWNSTREAM_WARMUP", "REMOVED"].includes(row.membership_status)) failedChecks.push("mother_pool_snapshot_membership_identity_invalid");
  }
  return {ok:failedChecks.length===0, snapshot:raw, runId, symbols, removed, membership, failedChecks:[...new Set(failedChecks)]};
}
function readMotherPoolSnapshot(tradeDate) {
  const root = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
  let snapshot;try {snapshot=JSON.parse(fs.readFileSync(path.join(root,"state/daytrade-mother-pool-snapshot-latest.json"),"utf8").replace(/^\uFEFF/,""));}catch{}
  return inspectSnapshot(snapshot,tradeDate);
}
function snapshotIdentity(value) {
  const s=value.snapshot||value;
  return {mother_pool_run_id:s.mother_pool_run_id,snapshot_sequence:s.snapshot_sequence,snapshot_type:s.snapshot_type,effective_at:s.effective_at,trade_date:s.trade_date,canonical_run_id:s.canonical_run_id};
}
function fiveMinuteAligned(receipt, snapshot) {
  const expected=snapshotIdentity(snapshot), actual=receipt?.diagnostic_summary?.mother_pool_snapshot;
  return !!actual && Object.entries(expected).every(([key,value])=>value!=null && actual[key]===value) && receipt.trade_date===expected.trade_date && Date.parse(receipt.verified_at)>=Date.parse(expected.effective_at);
}
module.exports={inspectSnapshot,readMotherPoolSnapshot,snapshotIdentity,fiveMinuteAligned};
