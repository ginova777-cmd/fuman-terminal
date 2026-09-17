"use strict";
const fs = require("fs"), path = require("path");
const canonicalRunId = date => `fugle_daytrade_source:${date.replace(/-/g, "")}:canonical`;
function inspectSnapshot(snapshot, tradeDate) {
  const failedChecks = [], raw = snapshot && typeof snapshot==='object' && !Array.isArray(snapshot) ? snapshot : {};
  const validDate = typeof tradeDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(tradeDate) && Number.isFinite(Date.parse(tradeDate)) && new Date(tradeDate).toISOString().slice(0,10)===tradeDate;
  const list = Array.isArray(raw.symbols) ? raw.symbols : [];
  const removedList = Array.isArray(raw.removed_symbols) ? raw.removed_symbols : [];
  const symbols = new Set(list), removed = new Set(removedList);
  if (!Array.isArray(raw.removed_symbols) || removed.size!==removedList.length || removedList.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))) failedChecks.push('mother_pool_snapshot_removed_list_invalid');
  const memberRows = Array.isArray(raw.symbol_membership) ? raw.symbol_membership : [];
  const membership = new Map(memberRows.filter(row=>row && typeof row==='object' && !Array.isArray(row) && typeof row.symbol==='string' && /^\d{4}$/.test(row.symbol)).map(row => [row.symbol, row]));
  if (!Array.isArray(raw.symbol_membership) || membership.size !== memberRows.length) failedChecks.push('mother_pool_snapshot_duplicate_or_invalid_membership');
  const runId = String(raw.mother_pool_run_id || "");
  if (raw.contract !== "daytrade_mother_pool_snapshot_v1" || raw.contract_version !== "4.1.0") failedChecks.push("mother_pool_snapshot_contract_mismatch");
  if (!validDate || raw.trade_date !== tradeDate || raw.canonical_run_id !== canonicalRunId(tradeDate)) failedChecks.push("mother_pool_snapshot_trade_date_or_canonical_mismatch");
  if (raw.complete !== true || raw.status !== "complete" || raw.exit_code !== 0 || raw.first_blocker) failedChecks.push("mother_pool_snapshot_not_complete");
  if (!runId || !Number.isInteger(raw.snapshot_sequence) || raw.snapshot_sequence < 1 || !raw.snapshot_type || !Number.isFinite(Date.parse(raw.effective_at)) || Date.parse(raw.effective_at)>Date.now()) failedChecks.push("mother_pool_snapshot_identity_missing_or_invalid");
  if (!Array.isArray(raw.symbols) || symbols.size !== list.length || raw.symbol_count !== symbols.size || list.some(s => typeof s!=='string'||!/^\d{4}$/.test(s))) failedChecks.push("mother_pool_snapshot_symbol_count_mismatch");
  for (const symbol of symbols) {
    const row = membership.get(symbol);
    if (!row || row.mother_pool_run_id !== runId || row.mother_pool_snapshot_sequence !== raw.snapshot_sequence || !row.membership_effective_at || !["ACTIVE", "PENDING_DOWNSTREAM_WARMUP"].includes(row.membership_status) || removed.has(symbol)) failedChecks.push("mother_pool_snapshot_membership_identity_invalid");
  }
  for (const [symbol,row] of membership) {
    if (!symbols.has(symbol) && (row.membership_status !== 'REMOVED' || !removed.has(symbol))) failedChecks.push('mother_pool_snapshot_unlisted_membership');
    if (row.mother_pool_run_id !== runId || row.mother_pool_snapshot_sequence !== raw.snapshot_sequence) failedChecks.push('mother_pool_snapshot_membership_identity_invalid');
  }
  for (const symbol of removed) if (membership.get(String(symbol))?.membership_status !== 'REMOVED' || symbols.has(String(symbol))) failedChecks.push('mother_pool_snapshot_removed_membership_invalid');
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
