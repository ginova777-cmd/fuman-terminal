"use strict";
function verifyMorningStage(handoff, persistence, tradeDate, now = Date.now()) {
  const failed = [];
  const check = (ok, code) => { if (!ok) failed.push(code); };
  const symbols = value => Array.isArray(value) ? value.map(String).sort() : null;
  for (const [label, receipt, contract] of [
    ["handoff", handoff, "opening-report-0830-mother-pool-handoff-ack-v2"],
    ["persistence", persistence, "opening-report-0830-mother-pool-persistence-ack-v1"],
  ]) {
    check(receipt?.contract === contract, `${label}_contract`);
    check(receipt?.trade_date === tradeDate, `${label}_trade_date`);
    check(receipt?.complete === true && receipt?.ok === true && receipt?.status === "complete"
      && receipt?.exitCode === 0 && !receipt?.first_blocker, `${label}_complete`);
    check(receipt?.db_readback_ok === true && Array.isArray(receipt?.missing_fields)
      && receipt.missing_fields.length === 0, `${label}_readback`);
    check(receipt?.formal_candidate_allowed === false && receipt?.forbidden_publish_guard === true
      && receipt?.formal_candidate_count === 0, `${label}_observation_only`);
    const rows = symbols(receipt?.db_readback_symbols);
    check(rows !== null && new Set(rows).size === rows.length && rows.every(s => /^\d{4}$/.test(s))
      && Number.isInteger(receipt?.received_symbols) && rows.length === receipt.received_symbols, `${label}_count`);
    const stamp = Date.parse(receipt?.checked_at);
    check(Number.isFinite(stamp) && stamp <= now, `${label}_time`);
  }
  check(Boolean(handoff?.report_run_id) && handoff.report_run_id === persistence?.report_run_id, "report_run_match");
  check(JSON.stringify(symbols(handoff?.db_readback_symbols)) === JSON.stringify(symbols(persistence?.db_readback_symbols)), "symbols_match");
  const handoffAt = Date.parse(handoff?.checked_at), persistenceAt = Date.parse(persistence?.checked_at);
  const refreshes = Array.isArray(persistence?.writer_refresh_timestamps) ? persistence.writer_refresh_timestamps.map(Date.parse) : [];
  check(persistence?.writer_refreshes_observed >= 2 && refreshes.length >= 2
    && new Set(refreshes).size === refreshes.length
    && refreshes.every(t => Number.isFinite(t) && t > handoffAt && t <= persistenceAt && t <= now), "two_post_handoff_refreshes");
  return { complete: failed.length === 0, failed_checks: failed, first_blocker: failed[0] || null,
    report_run_id: handoff?.report_run_id || null, symbols: symbols(handoff?.db_readback_symbols) || [] };
}
module.exports = { verifyMorningStage };
