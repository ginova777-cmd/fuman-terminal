'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./run-daytrade-source-writer'), 'utf8');
const start = source.indexOf('  let fullMarketLatestCandles =');
const end = source.indexOf('  tickStage("strategy_priority_bridge:start")', start);
assert.ok(start > 0 && end > start);
assert.ok(source.includes('result.payload.full_market_latest_candles = fullMarketLatestCandles;'));
async function run(failure, skipped) {
  const context = { DRY_RUN:false,verifyEarlyB01Candles:async()=>({complete:false,status:'FIXTURE_READBACK'}), activeSymbols: [{symbol:'2330'}, {symbol:'2454'}], state:{}, nonFatalWriteErrors:[],
    normalizeCode:String, nowIso:()=> '2026-09-17T02:00:00Z', taipeiDateFrom:()=> '2026-09-17', tickStage:()=>{},
    syncWebSocketIntraday1mCandles:async(rows, state, options)=>{
      assert.equal(rows.length,2); assert.equal(options.latestOnly,true);
      if(failure) throw Error('fixture error');
      return {written:skipped?0:2,skipped,latest_candle_evidence:{requested_count:2,complete:false}};
    }};
  vm.createContext(context);
  return vm.runInContext(`(async()=>{${source.slice(start,end)};return fullMarketLatestCandles;})()`,context);
}
(async()=>{
  const success = await run(false,false);
  assert.equal(success.status,'WRITE_FINISHED_UNVERIFIED');
  assert.equal(success.readback_receipt.status,'FIXTURE_READBACK');
  assert.deepEqual(Array.from(success.requested_symbols),['2330','2454']);
  assert.equal(success.complete,false);assert.equal(success.db_readback_verified,false);
  assert.equal((await run(false,true)).status,'DATA_GAP');
  assert.equal((await run(true,false)).status,'WRITE_FAILED');
  console.log('PASS actual B01 early Writer scope/evidence: success, empty, failure; never claims readback');
})().catch(error=>{console.error(error);process.exitCode=1;});
