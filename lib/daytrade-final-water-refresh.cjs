'use strict';
// Only real acknowledged writes can refresh the fast-sync receipt. Exceptions
// propagate to the existing Writer failure/backoff path; there is no retry here.
async function refresh({ apply, dryRun, tradeDate, run }) {
  if (!apply || dryRun) return { status: 'SKIPPED_READ_ONLY' };
  const deadline = Number(process.env.FUMAN_DAYTRADE_WRITER_DEADLINE_MS) || Date.now() + 300000;
  // Owned by this invocation only. Durable ACK state remains on disk; restarting
  // the Writer creates a fresh context and independently checks saved content.
  const drainContext = {};
  const nextBatch = () => { if (Date.now() >= deadline) throw Error("FINAL_CANDLE_DRAIN_DEADLINE"); return run({deadline, drainContext}); };
  let result = await nextBatch();
  // Drain distinct deferred batches, never retry a failed request. The Writer
  // process retains its existing outer deadline. Require strict progress.
  let pending = Number(result?.candle_pending_after);
  const maximumPasses = Math.max(1, Number(result?.candle_rows) || 1);
  for (let pass = 1; pending > 0 && pass < maximumPasses; pass++) {
    if (result?.ok !== true) throw Error('FINAL_WATER_REFRESH_NOT_ACKNOWLEDGED');
    result = await nextBatch();
    const next = Number(result?.candle_pending_after);
    if (!Number.isInteger(next) || next < 0 || next >= pending) throw Error('FINAL_CANDLE_DRAIN_NO_PROGRESS');
    pending = next;
  }
  if (!result || result.ok !== true || result.mode !== 'apply' || result.trade_date !== tradeDate
    || !Number.isInteger(result.quotes_written) || result.quotes_written < 1
    || !Number.isInteger(result.candles_written) || result.candles_written < 0
    || result.candle_pending_after !== 0 || result.final_content_readback_verified !== true) {
    throw Error('FINAL_WATER_REFRESH_NOT_ACKNOWLEDGED');
  }
  return { status: 'WRITTEN_PENDING_VERIFICATION', trade_date: result.trade_date,
    quotes_written: result.quotes_written, candles_written: result.candles_written,
    candle_deferred: result.candle_deferred, complete: false };
}
module.exports = { refresh };
