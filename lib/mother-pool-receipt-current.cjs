'use strict';
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {verifyHashEvidence} = require('./mother-pool-receipt-binding');
function isCurrent(receipt, snapshotRaw, tradeDate) {
  try {
    const s = JSON.parse(snapshotRaw), b = receipt.snapshot_binding;
    if (receipt.closed_loop_ok !== true || receipt.complete !== true || receipt.trade_date !== tradeDate || !b) return false;
    if (s.complete !== true || s.trade_date !== tradeDate || s.canonical_run_id !== `fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`) return false;
    for (const k of ['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence']) if (s[k] == null || s[k] !== b[k]) return false;
    if (receipt.canonical_run_id !== s.canonical_run_id || b.snapshot_sha256 !== createHash('sha256').update(snapshotRaw).digest('hex')) return false;
    return verifyHashEvidence(b).ok === true;
  } catch { return false; }
}
if (require.main === module) {
  try { process.exitCode = isCurrent(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')), fs.readFileSync(process.argv[3],'utf8'), process.argv[4]) ? 0 : 1; }
  catch { process.exitCode = 1; }
}
module.exports = {isCurrent};
