const assert = require('assert');
const { verifiedHistoricalCloseout } = require('../lib/daytrade-offsession-closeout');
const tradeDate = '2026-09-11';
const fixture = {
  currentDate: '2026-09-12',
  receipt: { trade_date: tradeDate, ok: true, complete: true, status: 'complete', last_attempt: { first_blocker: 'outside_trading_window' } },
  runner: { trade_date: tradeDate, ok: true, complete: true, status: 'complete', exit_code: 0, canonical_run_id: 'fugle_daytrade_source:20260911:canonical' },
  outbox: { trade_date: tradeDate, updated_at: '2026-09-11T09:33:55Z', events: [] },
};
assert(verifiedHistoricalCloseout(fixture));
for (const mutate of [
  f => { f.currentDate = tradeDate; },
  f => { f.currentDate = '2026-09-10'; },
  f => { f.outbox.events = [{ symbol: '2330' }]; },
  f => { f.runner.trade_date = '2026-09-10'; },
  f => { f.runner.canonical_run_id = 'wrong'; },
  f => { f.runner.complete = false; },
  f => { f.receipt.last_attempt.first_blocker = 'source_missing'; },
  f => { f.outbox.updated_at = '2026-09-11T02:00:00Z'; },
  f => { f.outbox.updated_at = '2026-09-12T09:00:00Z'; },
]) {
  const f = structuredClone(fixture); mutate(f);
  assert.strictEqual(verifiedHistoricalCloseout(f), false);
}
console.log('PASS historical closeout; reject current/future, pending events, date/run mismatch, incomplete, non-closeout and in-session evidence');
