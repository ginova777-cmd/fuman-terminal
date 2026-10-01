'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(require.resolve('./run-daytrade-source-writer'), 'utf8');
const start = source.indexOf('function readRuntimePrioritySeeds(activeSymbols) {');
const end = source.indexOf('\nfunction buildPriorityPool(', start);
assert(start > 0 && end > start);
const date = '2026-09-18', canonical = 'fugle_daytrade_source:20260918:canonical';
const group = symbols => ({ status: 'ready', symbols, runId: 'prior-run', scanDate: '20260917', handoff: { ok: true, failed_checks: [], handoff_trade_date: date, source_run_id: 'prior-run', strategy_source_date: '2026-09-17', previous_completed_trade_date: '2026-09-17', checked_at: '2026-09-18T00:00:00Z' } });
const defaults = () => ({ strategy2: group(['1101']), strategy3: group(['2330']), strategy4: group(['2317']), strategy5: group(['2454']), institution: group(['2881']), ranking: group(['3105']) });
function execute(groups = defaults(), extra = {}) {
  const payload = { tradeDate: date, canonicalRunId: canonical, priorityBridge: { tradeDate: date, groups }, ...extra };
  const context = { require, nowIso:()=>date+'T01:00:00Z',
    taipeiDate: () => date, canonicalDaytradeRunId: () => canonical,
    PRIORITY_SYMBOLS_FILE: 'priority', STRATEGY_PRIORITY_BRIDGE_CACHE_FILE: 'cache', INDUSTRY_SIGNAL_FAST_INJECT_FILE: 'industry',
    readJson: key => key === 'priority' ? payload : {}, objectPayload: x => x && typeof x === 'object' ? x : {},
    sameDayArtifact: (x, day) => x?.tradeDate === day, compactDateKey: x => String(x).replace(/\D/g, '').slice(0, 8),
    normalizeCode: x => /^\d{4}$/.test(String(x)) ? String(x) : '', numberValue: x => Number(x) || 0,
    readOpeningReport0830PrioritySeeds: () => ({ symbols: [] })
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return JSON.parse(JSON.stringify(context.readRuntimePrioritySeeds(['1101', '2330', '2317', '2454', '2881', '3105', '9999'].map(symbol => ({ symbol })))));
}
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
test('all six formal sources enter actual Writer union', () => assert.deepEqual(execute().symbols.map(r => r.symbol).sort(), ['1101','2317','2330','2454','2881','3105']));
test('unverified legacy strategy arrays cannot override bridge', () => assert(!execute(defaults(), { strategy3:['9999'], strategy4:['9999'], strategy5:['9999'], institution:['9999'] }).symbols.some(r => r.symbol === '9999')));
test('Strategy1 is never a direct seed', () => assert(!execute(defaults(), { strategy1:['9999'] }).symbols.some(r => r.symbol === '9999')));
for (const [name, alter] of [
  ['missing handoff', g => delete g.handoff],
  ['blocked handoff', g => g.handoff.ok = false],
  ['failed checks', g => g.handoff.failed_checks = ['FAILED']],
  ['wrong execution date', g => g.handoff.handoff_trade_date = '2026-09-17'],
  ['wrong run', g => g.runId = 'other'],
  ['stale source day', g => g.handoff.strategy_source_date = '2026-09-16'],
  ['row date mismatch', g => g.scanDate = '20260916'],
  ['future validation', g => g.handoff.checked_at = '2099-01-01T00:00:00Z']
]) test(name + ' cannot seed', () => { const groups = defaults(); alter(groups.strategy2); assert(!execute(groups).symbols.some(r => r.symbol === '1101')); });
test('duplicates retained in audit but only score once', () => { const groups=defaults(); groups.strategy2.symbols=['1101','1101','8888']; const r=execute(groups); assert.equal(r.symbols.find(x=>x.symbol==='1101').score,80); assert.deepEqual(r.sourceAudit.strategy2,{source_count:3,deduplicated_count:2,accepted_count:1,duplicate_symbols:['1101'],rejected_symbols:['8888']}); });
test('union deduplicates shared stocks and retains both source flags', () => { const groups=defaults(); groups.strategy2.symbols=['2330']; const r=execute(groups); assert.deepEqual(r.symbols.find(x=>x.symbol==='2330').sources,['strategy2','strategy3']); assert.equal(r.symbols.filter(x=>x.symbol==='2330').length,1); });
test('legacy slash88 array cannot seed', () => assert(!execute(defaults(), {slash88:['9999']}).symbols.some(r=>r.symbol==='9999')));
test('validated scorecard adapter seeds slash88', () => {const r=execute(defaults(),{priorityBridge:{tradeDate:date,groups:defaults(),scorecardSource:{status:'READY',symbols:['9999']}}});assert.deepEqual(r.symbols.find(x=>x.symbol==='9999').sources,['slash88']);});
test('blocked scorecard adapter cannot seed', () => assert(!execute(defaults(),{priorityBridge:{tradeDate:date,groups:defaults(),scorecardSource:{status:'BLOCKED',symbols:['9999']}}}).symbols.some(r=>r.symbol==='9999')));


test('legacy unverified futures arrays cannot seed',()=>assert(!execute(defaults(),{stockFutureSymbols:['9999']}).symbols.some(r=>r.symbol==='9999')));

test('official code-mapped futures enter actual Writer union',()=>{
 const {FUGLE,TAIFEX}=require('../lib/mother-pool-futures-catalogue'),{hash}=require('../lib/mother-pool-module-write-set');
 const raw_fugle={date,type:'FUTURE',exchange:'TAIFEX',session:'REGULAR',data:[{symbol:'CDFL6',contractType:'S',endDate:'2026-12-16'},{symbol:'TXFL6',contractType:'I',endDate:'2026-12-16'}]},raw_taifex_html='證券代號 股票期貨<tr>'+['CD','公司','2330','台積電','●','','','◎','','','','2000','',''].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
 const futuresSource={contract:'mother_pool_futures_catalogue_v1',trade_date:date,run_id:'fixture-catalogue',observed_at:date+'T00:00:00Z',fugle_url:FUGLE,taifex_url:TAIFEX,raw_fugle,raw_taifex_html,source_hash:hash({fugle:raw_fugle,taifex:raw_taifex_html})};
 const result=execute(defaults(),{priorityBridge:{tradeDate:date,groups:defaults(),futuresSource}});
 assert(result.symbols.find(r=>r.symbol==='2330').sources.includes('stock_future'));
 assert.equal(result.sourceAudit.stock_future.accepted_count,1);
});
console.log(JSON.stringify({checks,scope:'isolated_actual_Writer_seed_function',production_complete:false}));
