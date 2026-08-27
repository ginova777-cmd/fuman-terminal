const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'ops', 'public-slot', 'DaytradeWebSocketFreshnessReadbackViews_20260827.sql'), 'utf8');
const writer = fs.readFileSync(path.join(root, 'scripts', 'run-daytrade-source-writer.js'), 'utf8');
const collector = fs.readFileSync(path.join(root, 'scripts', 'fugle-websocket-collector.js'), 'utf8');
const fields = ['trade_date', 'symbol', 'source_name', 'quote_seen_at', 'received_at', 'aggregate_last_updated', 'latest_candle_time', 'first_candle_time', 'last_candle_time', 'candle_count', 'data_gap', 'data_gap_reason', 'quote_age_seconds', 'intraday_1m_stale_seconds'];
const checks = {
  additive_view: /create or replace view public\.v_fugle_daytrade_source_health_readback/i.test(sql),
  anon_grant: /grant select on public\.v_fugle_daytrade_source_health_readback to anon, authenticated, service_role/i.test(sql),
  required_fields: fields.every((field) => new RegExp('\\b' + field + '\\b', 'i').test(sql)),
  formal_only_candles: /coalesce\(m\.synthetic, false\) is false/i.test(sql),
  missing_0901_gap: /missing_0901_candle/i.test(sql),
  stale_gap: /intraday_1m_stale_over_120s/i.test(sql),
  writer_received_timestamp: writer.includes('received_at: receivedAt'),
  writer_aggregate_timestamp: writer.includes('aggregate_last_updated: aggregateLastUpdated'),
  collector_preserves_aggregate: collector.includes("aggregateLastUpdated: quote.aggregateLastUpdated || previous.aggregateLastUpdated || ''"),
};
const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed_checks.length === 0, contract: 'daytrade_websocket_health_readback_contract_v1', view: 'v_fugle_daytrade_source_health_readback', checks, failed_checks, first_blocker: failed_checks[0] || null, read_only: true }, null, 2));
process.exitCode = failed_checks.length ? 1 : 0;
