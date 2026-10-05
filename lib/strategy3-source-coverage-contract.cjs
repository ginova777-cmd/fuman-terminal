'use strict';
// Coverage evidence only: this never grants entry or changes an existing Gate.
function build(payload) {
  function metric(scope, total, fresh, threshold) {
    const valid = Number.isInteger(total) && total > 0 && Number.isInteger(fresh) && fresh >= 0 && fresh <= total;
    const ratio = valid ? fresh / total : null;
    return { scope, requested_count: valid ? total : null, fresh_count: valid ? fresh : null,
      coverage: ratio, threshold, window_seconds: 120,
      status: !valid ? 'UNKNOWN' : ratio >= threshold ? 'PASS' : 'BLOCKED',
      first_blocker: !valid ? 'COVERAGE_COUNTS_INVALID' : ratio < threshold ? 'PRIORITY_QUOTE_COVERAGE_BELOW_095' : null };
  }
  return { contract: 'source_quote_coverage_scopes_v1',
    trade_date: payload.trade_date || null, writer_run_id: payload.writer_run_id || null,
    generation_id: payload.generation_id || null,
    strategy3_priority: metric('full_priority_pool', payload.priority_pool_symbols, payload.priority_fresh_quotes_120s, 0.95),
    producer_formal_subset: { scope: 'formal_priority_subset', requested_count: payload.formal_daytrade_priority_symbols ?? null,
      fresh_count: payload.formal_deep_scan_fresh_quotes_120s ?? null,
      reported_coverage: payload.formal_deep_scan_fresh_quote_coverage_120s ?? null,
      configured_threshold: payload.priority_fresh_quote_coverage_target_120s ?? null },
    source_grade_scope: 'producer_formal_subset',
    quote_asof_policy: 'source_status.updated_at is publication time; per-symbol event times remain authoritative',
    other_gates_verified: false, formal_entry_authorization: false };
}
module.exports = {build};
