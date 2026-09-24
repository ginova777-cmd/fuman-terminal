"use strict";

// Keep bulky candles/quotes in the source snapshot, not the scorecard row.
const FIELDS = Object.freeze([
  "trade_date", "canonical_run_id", "writer_run_id", "generation_id",
  "mother_pool_run_id", "snapshot_generation", "snapshot_sequence",
  "source_status", "gate_grade", "message", "active_symbols",
  "priority_symbols", "priority_pool_symbols", "fresh_quotes_120s",
  "fresh_quote_coverage_120s", "priority_fresh_quote_coverage_120s",
  "selected_symbols_fresh_ok", "scanner_can_run_opening",
  "scanner_can_run_quote_only", "daily_volume_status", "avg_volume5_eligible",
  "ready_ma20_continuous", "ready_ma35_continuous", "intraday_1m_stale_seconds",
  "today_1m_symbols", "today_1m_rows", "futopt_stock_mapped",
  "rate_limit_status", "last_429_at", "cooldown_until", "self_heal_count",
  "mother_pool_contract_version", "contract_version", "writer_lease_status",
  "writer_heartbeat_at", "writer_lease_expires_at", "source_authority",
  "reader_policy", "mother_pool_round_summary", "target_symbol_diagnostics",
]);

function boundedScorecardPayload(payload) {
  return Object.fromEntries(FIELDS
    .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => [key, payload[key]]));
}

module.exports = { boundedScorecardPayload };
