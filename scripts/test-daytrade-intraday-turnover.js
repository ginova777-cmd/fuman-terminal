const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateTurnover, rankTurnover, nativeVolume } = require('../lib/daytrade-intraday-turnover');
const { verify } = require('./verify-daytrade-intraday-turnover');
const { normalizeFugleAggregate, normalizeFugleTrade, mergeFugleQuoteState } = require('../lib/fugle-websocket-quotes');
const now = '2026-09-16T02:00:00Z';
const master = { stock_master_source: 'MOPS_OPEN_DATA_TWSE_TPEX', official_present: true,
  stock_master_source_date: '2026-09-16', stock_master_synced_at: '2026-09-15T22:00:00Z', official_issued_common_shares: 100000000 };
const volume = { value: 2000, unit: 'lots', event_at: now, source: 'fixture-native', is_synthetic: false };
const base = { symbol: '2330', master, volume, tradeDate: '2026-09-16', now };
const checks = [];
function test(name, fn) { fn(); checks.push(name); console.log('PASS ' + name); }
test('2000 lots / 100m shares = 2 percent', () => assert.equal(evaluateTurnover(base).turnover_pct, 2));
test('shares and lots equivalent', () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, value: 2000000, unit: 'shares' } }).turnover_pct, 2));
test('large lot volume never divided by magnitude', () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, value: 200000 } }).turnover_pct, 200));
for (const value of [null, '', -1, Infinity, true]) test('invalid volume ' + String(value), () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, value } }).turnover_pct, null));
test('native zero stays zero', () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, value: 0 } }).turnover_pct, 0));
test('capital cannot substitute shares', () => assert.equal(evaluateTurnover({ ...base, master: { ...master, official_issued_common_shares: null, capital: 100000000 } }).turnover_pct, null));
test('previous issue date accepted when official master synchronized today', () => assert.equal(evaluateTurnover({ ...base, master: { ...master, stock_master_source_date: '2026-09-15' } }).turnover_pct, 2));
test('old master sync rejected', () => assert.equal(evaluateTurnover({ ...base, master: { ...master, stock_master_synced_at: '2026-09-14T22:00:00Z' } }).turnover_pct, null));
for (const event_at of ['2026-09-15T02:00:00Z', '2026-09-16T02:00:01Z', '2026-09-16T01:57:59Z', null]) test('event guard ' + event_at, () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, event_at } }).turnover_pct, null));
test('unknown unit rejected', () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, unit: '?' } }).turnover_pct, null));
test('synthetic rejected', () => assert.equal(evaluateTurnover({ ...base, volume: { ...volume, is_synthetic: true } }).turnover_pct, null));
test('rank desc with stable symbol tie and isolated gaps', () => {
  const a = evaluateTurnover(base);
  const b = evaluateTurnover({ ...base, symbol: '2303', volume: { ...volume, value: 3000 } });
  const gap = evaluateTurnover({ ...base, symbol: '9999', volume: {} });
  const r = rankTurnover([a, gap, b], { tradeDate: base.tradeDate, canonicalRunId: 'fixture', now });
  assert.deepEqual(r.rows.map(row => [row.symbol, row.rank]), [['2303', 1], ['2330', 2]]);
  assert.equal(r.data_gap_count, 1);
});
test('aggregate event time and cumulative value survive sparse trades', () => {
  const aggregate = normalizeFugleAggregate({ data: { symbol: '2330', market: 'TSE', previousClose: 100, closePrice: 101,
    total: { tradeVolume: 2000, time: Date.parse(now) * 1000 } } });
  const trade = normalizeFugleTrade({ data: { symbol: '2330', price: 101, volume: 7, time: Date.parse(now) * 1000 } });
  assert.equal(mergeFugleQuoteState(aggregate, trade).turnoverVolumeEvidence.value, 2000);
  assert.equal(mergeFugleQuoteState(aggregate, trade).turnoverVolumeEvidence.event_at, now.replace('00Z', '00.000Z'));
});
test('missing aggregate value is not zero or trade size', () => assert.equal(nativeVolume({ market: 'TSE', volume: 10 }, 'fixture').value, null));
test('Writer connects historical preopen versus intraday rank and publishes evidence', () => {
  const writer = fs.readFileSync(path.join(__dirname, 'run-daytrade-source-writer.js'), 'utf8');
  assert.match(writer, /intradayTurnoverActive\s*\? new Map\(intradayTurnoverRanking.rows/);
  assert.match(writer, /: rankMap\(rankingCandidates, \(row\) => row.metrics.turnoverRate3To5d/);
  assert.match(writer, /intraday_turnover_ranking: priorityRows.intradayTurnoverRanking/);
  assert.doesNotMatch(writer, /firstNumber\(row.issued_shares, row.capital\)/);
});
test('independent verifier rejects tampered arithmetic and mixed counts', () => {
  const r = rankTurnover([evaluateTurnover(base)], { tradeDate: base.tradeDate, canonicalRunId: 'fugle_daytrade_source:20260916:canonical', now });
  assert.equal(verify(r).complete, true);
  r.rows[0].turnover_pct = 200;
  assert.equal(verify(r).complete, false);
  r.rows[0].turnover_pct = 2; r.requested_count = 2;
  assert.equal(verify(r).complete, false);
});
const receipt = { contract: 'daytrade_intraday_turnover_isolated_v1', scope: 'isolated_fixtures_and_static_wiring',
  status: 'complete', complete: true, checks, failed_checks: [], first_blocker: null,
  production_deployed: false, natural_batch_verified: false, checked_at: new Date().toISOString() };
const output = path.join(__dirname, '..', 'outputs', 'daytrade-intraday-turnover-isolated-receipt.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(`${checks.length} checks passed; ${output}`);
