'use strict';
// Only real acknowledged writes can refresh the fast-sync receipt. Exceptions
// propagate to the existing Writer failure/backoff path; there is no retry here.
async function refresh({ apply, dryRun, tradeDate, run }) {
  if (!apply || dryRun) return { status: 'SKIPPED_READ_ONLY' };
  const result = await run();
  if (!result || result.ok !== true || result.mode !== 'apply' || result.trade_date !== tradeDate
    || !Number.isInteger(result.quotes_written) || result.quotes_written < 1
    || !Number.isInteger(result.candles_written) || result.candles_written < 0) {
    throw Error('FINAL_WATER_REFRESH_NOT_ACKNOWLEDGED');
  }
  return { status: 'WRITTEN_PENDING_VERIFICATION', trade_date: result.trade_date,
    quotes_written: result.quotes_written, candles_written: result.candles_written,
    candle_deferred: result.candle_deferred, quote_write_completed_at: result.quote_write_completed_at,
    shared_water_acceptance: result.shared_water_acceptance || null, complete: false };
}
module.exports = { refresh };
