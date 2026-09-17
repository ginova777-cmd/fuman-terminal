'use strict';

function latestCandleEvidence(symbols, rows, nowMs) {
  if (!Number.isFinite(nowMs)) throw Error('INVALID_AUDIT_TIME');
  const tradeDate = new Date(nowMs + 8 * 3600000).toISOString().slice(0, 10);
  const requested = [...new Set(symbols.map(String))].sort();
  const latest = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const time = Date.parse(row.candle_time);
    if (!Number.isFinite(time)) continue;
    const previous = latest.get(String(row.symbol));
    if (!previous || time > Date.parse(previous.candle_time)) latest.set(String(row.symbol), row);
  }
  const items = requested.map(symbol => {
    const row = latest.get(symbol);
    if (!row) return { symbol, status: 'DATA_GAP', reason: 'NO_VALID_NATURAL_COMPLETED_CANDLE' };
    const start = Date.parse(row.candle_time);
    const age = (nowMs - start) / 1000;
    const complete = start + 60000 <= nowMs;
    const eventDate = new Date(start + 8 * 3600000).toISOString().slice(0, 10);
    const qualityReason = row.trade_date !== tradeDate || eventDate !== tradeDate ? 'CANDLE_TRADE_DATE_MISMATCH'
      : row.synthetic !== false ? 'CANDLE_NOT_PROVEN_NATURAL'
      : row.volume_strategy_usable !== true ? 'CANDLE_VOLUME_UNUSABLE'
      : start % 60000 !== 0 ? 'CANDLE_TIME_NOT_MINUTE_ALIGNED'
      : ['open','high','low','close'].some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] <= 0) ? 'CANDLE_OHLC_INVALID'
      : row.high < Math.max(row.open,row.close,row.low) || row.low > Math.min(row.open,row.close,row.high) ? 'CANDLE_OHLC_INCONSISTENT'
      : typeof row.volume !== 'number' || !Number.isFinite(row.volume) || row.volume < 0 ? 'CANDLE_VOLUME_INVALID' : null;
    const fresh = !qualityReason && complete && age >= 0 && age <= 120;
    return { symbol, status: fresh ? 'READY' : 'DATA_GAP', reason: qualityReason || (!complete ? 'CANDLE_NOT_COMPLETED' : fresh ? null : 'CANDLE_STALE'),
      trade_date: row.trade_date, bar_start: row.candle_time,
      bar_end: new Date(start + 60000).toISOString(), candle_age_seconds: age,
      source_seen_at: row.updated_at, synthetic: row.synthetic,
      volume_strategy_usable: row.volume_strategy_usable,
      open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
      source: row.source };
  });
  return { contract: 'daytrade_latest_candle_write_evidence_v1',
    checked_at: new Date(nowMs).toISOString(), freshness_reference: 'bar_start', freshness_limit_seconds: 120,
    requested_count: requested.length, ready_count: items.filter(row => row.status === 'READY').length,
    data_gap_count: items.filter(row => row.status === 'DATA_GAP').length,
    db_readback_verified: false, complete: false, items };
}
module.exports = { latestCandleEvidence };
