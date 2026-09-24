'use strict';
const compact = v => String(v || '').replace(/\D/g, '').slice(0, 8);
function inspect({ run, rows, runId, sourceDate }) {
  const count = run?.result_count ?? run?.resultCount ?? run?.payload?.result_count ?? run?.payload?.resultCount;
  const failures = [];
  if (!Number.isInteger(count) || count < 0) failures.push('SOURCE_RESULT_COUNT_UNPROVEN');
  if (!Array.isArray(rows)) failures.push('SOURCE_RESULT_ROWS_INVALID');
  else {
    if (rows.length !== count) failures.push('SOURCE_RESULT_COUNT_MISMATCH');
    if (rows.some(row => row.run_id !== runId)) failures.push('SOURCE_ROW_RUN_MISMATCH');
    if (rows.some(row => compact(row.trade_date || row.scan_date) !== compact(sourceDate))) failures.push('SOURCE_ROW_DATE_MISMATCH');
    if (rows.some(row => !/^\d{4}$/.test(String(row.code || row.symbol || '')))) failures.push('SOURCE_ROW_SYMBOL_INVALID');
    if (rows.some(row => row.complete === false || row.synthetic === true || row.is_synthetic === true || row.look_ahead === true)) failures.push('SOURCE_ROW_NOT_VALID');
  }
  return { ok: failures.length === 0, expected_count: count ?? null, readback_count: Array.isArray(rows) ? rows.length : null, failed_checks: failures, first_blocker: failures[0] || null };
}
module.exports = { inspect };
