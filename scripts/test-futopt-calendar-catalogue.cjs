'use strict';
const assert = require('node:assert/strict');
const { createCalendarCatalogueRetry } = require('../lib/futopt-calendar-catalogue.cjs');
const { refresh } = require('../lib/mother-pool-futures-catalogue');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

(async () => {
  const cases = [];
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-catalogue-'));
  // Calendar fixtures exercise the contract, not a production calendar resolver.
  const evidence = (date, state) => ({ verified: true, exchange: 'TAIFEX', session: 'REGULAR', date, state,
    verified_at: date + 'T00:00:00Z', valid_until: date + 'T15:59:59Z',
    evidence_ref: 'isolated-fixture', evidence_sha256: 'a'.repeat(64) });
  async function run(name, fn) { await fn(); cases.push(name); }
  try {
    for (const date of ['2026-10-09', '2026-10-10', '2026-10-11', '2027-01-01']) {
      await run('closed_' + date, async () => {
        let calls = 0, writes = 0;
        const attempt = createCalendarCatalogueRetry({ resolveSession: async () => evidence(date, 'CLOSED'),
          now: () => Date.parse(date + 'T02:00:00Z'), refresh: async () => { calls++; },
          readState: () => ({ error: 'OLD_PROVIDER_FAILURE' }), writeState: () => { writes++; } });
        const result = await attempt({ tradeDate: date, asOf: date + 'T02:00:00Z' });
        assert.equal(result.status, 'market_closed'); assert.equal(result.receipt.expected_trade_date, null);
        assert.equal(result.receipt.formal_ready, false); assert.equal(result.receipt.subscriptions_ready, false);
        assert.equal(calls, 0); assert.equal(writes, 0);
      });
    }
    const date = '2026-10-12', options = { runtime, tradeDate: date, asOf: date + 'T02:00:00Z', key: 'test' };
    for (const [name, mutation] of [
      ['missing', () => null], ['unverified', x => ({ ...x, verified: false })],
      ['twse', x => ({ ...x, exchange: 'TWSE' })], ['afterhours', x => ({ ...x, session: 'AFTERHOURS' })],
      ['wrong_date', x => ({ ...x, date: '2026-10-11' })], ['bad_hash', x => ({ ...x, evidence_sha256: '' })],
      ['expired', x => ({ ...x, valid_until: date + 'T01:00:00Z' })],
      ['future_observation', x => ({ ...x, verified_at: date + 'T03:00:00Z' })],
    ]) await run(name, async () => {
      const attempt = createCalendarCatalogueRetry({ resolveSession: async () => mutation(evidence(date, 'OPEN')),
        now: () => Date.parse(options.asOf), readState: () => null,
        writeState: () => assert.fail('write forbidden'), refresh: () => assert.fail('fetch forbidden') });
      assert.equal((await attempt(options)).receipt.error, 'FUTURES_CALENDAR_UNVERIFIED');
    });
    await run('resolver_failure', async () => {
      const attempt = createCalendarCatalogueRetry({ resolveSession: async () => { throw Error('secret'); },
        now: () => Date.parse(options.asOf) });
      assert.equal((await attempt(options)).receipt.error, 'FUTURES_CALENDAR_UNVERIFIED');
    });
    await run('open_stale_provider_and_backoff', async () => {
      let calls = 0, state = { expected_trade_date: '2026-10-11', failures: 99, next_retry_at: date + 'T03:00:00Z' };
      const attempt = createCalendarCatalogueRetry({ resolveSession: async () => evidence(date, 'OPEN'),
        now: () => Date.parse(options.asOf), refresh, readState: () => state, writeState: x => { state = x; } });
      const input = { ...options, fetchImpl: async () => { calls++; return { status: 200, json: async () => ({
        date: '2026-10-08', type: 'FUTURE', exchange: 'TAIFEX', session: 'REGULAR', data: [],
      }) }; } };
      assert.equal((await attempt(input)).receipt.error, 'FUTURES_CATALOGUE_PROVIDER_DATE_PENDING');
      assert.equal(state.failures, 1); assert.equal(state.provider_identity.date, '2026-10-08');
      assert.equal((await attempt(input)).status, 'backoff'); assert.equal(calls, 1);
      assert.equal(fs.existsSync(path.join(runtime, 'data/futures-catalogue', date + '.json')), false);
    });
    await run('emergency_closed_overrides_retry', async () => {
      const attempt = createCalendarCatalogueRetry({ resolveSession: async () => evidence(date, 'CLOSED'),
        now: () => Date.parse(options.asOf), readState: () => assert.fail('retry not applicable'),
        refresh: () => assert.fail('fetch forbidden') });
      assert.equal((await attempt(options)).status, 'market_closed');
    });
    await run('midnight_during_resolution', async () => {
      let clock = Date.parse(options.asOf);
      const attempt = createCalendarCatalogueRetry({ resolveSession: async () => {
        clock = Date.parse('2026-10-12T16:00:00Z'); return evidence(date, 'OPEN'); }, now: () => clock });
      assert.equal((await attempt(options)).receipt.error, 'FUTURES_CALENDAR_DAY_CHANGED');
    });
    await run('execution_date_not_relabelled', async () => {
      const attempt = createCalendarCatalogueRetry({ resolveSession: () => assert.fail('not called'),
        now: () => Date.parse(options.asOf) });
      assert.equal((await attempt({ ...options, tradeDate: '2026-10-08' })).receipt.error, 'FUTURES_CALENDAR_EXECUTION_DATE');
    });
    console.log(JSON.stringify({ status: 'OFFLINE_PASS', count: cases.length, cases,
      production_resolver_verified: false, formal_execution: false }));
  } finally { fs.rmSync(runtime, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
