'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('async function syncWebSocketIntraday1mCandles(');
const fn=source.slice(start,source.indexOf('async function syncWebSocketFutoptQuotes()',start));
const today='2026-09-17',now='2026-09-17T04:01:30Z';
const bar=(symbol,time)=>({symbol,source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',tradeDate:today,candleTime:time,candleSeenAt:'2026-09-17T04:01:00Z',open:100,high:102,low:99,close:101,volume:10,synthetic:false,volumeStrategyUsable:true});
let saved=0,writes=[],clock=Date.parse(now),failWrite=false;
const context={require,Date:class extends Date {static now(){return clock;}},process,
  nowIso:()=>now,taipeiDateFrom:x=>String(x).slice(0,10),normalizeCode:x=>String(x||''),
  normalizeTimestamp:x=>x,numberValue:Number,readJson:()=>({tradeDate:today,daytradeMotherPoolSymbols:['9999']}),
  FUGLE_WS_STATUS_FILE:'isolated-status',PRIORITY_SYMBOLS_FILE:'unused',WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS:1,INTRADAY_MIRROR_BARS_PER_SYMBOL:60,SLOW_TABLE_BATCH_SIZE:100,DRY_RUN:false,
  readFugleWebSocketCandles:()=>({payload:{updatedAt:now},candles:new Map([
    ['a',bar('2330','2026-09-17T03:59:00Z')],['b',bar('2330','2026-09-17T04:00:00Z')],
    ['c',bar('2317','2026-09-17T04:00:00Z')],['d',bar('9999','2026-09-17T04:00:00Z')],
    ['e',{...bar('2454','2026-09-17T04:00:00Z'),synthetic:true}]])}),
  supabaseUpsert:async(table,rows)=>{clock+=250;if(failWrite)throw Error('ISOLATED_DB_FAILURE');writes.push(...rows);},writeWriterState:()=>saved++};
vm.createContext(context);vm.runInContext(fn+';this.flush=syncWebSocketIntraday1mCandles;',context);
(async()=>{
 const state={};const result=await context.flush([{symbol:'2330'},{symbol:'2317'},{symbol:'2454'}],state,{latestOnly:true});
 assert.equal(result.written,2);assert.deepEqual(writes.map(r=>r.symbol).sort(),['2317','2330']);
 assert.ok(writes.every(r=>r.candle_time==='2026-09-17T04:00:00.000Z'));
 assert.equal(saved,0);assert.deepEqual(state,{});assert.equal(result.seedAttempts,0);
 assert.equal(result.timing.db_write_elapsed_ms,250);
 assert.equal(result.timing.cache_selection_elapsed_ms,0);
 assert.equal(Date.parse(result.timing.db_write_completed_at)-Date.parse(result.timing.db_write_started_at),250);
 assert.equal(result.latest_candle_evidence.checked_at,result.timing.db_write_completed_at);
 assert.equal(result.timing.cache_artifact_updated_at,now);
 const priorState={daytradeMotherPoolCandleMirror:{tradeDate:today,symbols:{'2330':{seeded:false,lastCandleTime:'2026-09-17T03:58:00Z'}}}};
 const before=JSON.stringify(priorState),writesBefore=writes.length;
 failWrite=true;
 await assert.rejects(()=>context.flush([{symbol:'2330'}],priorState),/ISOLATED_DB_FAILURE/);
 assert.equal(JSON.stringify(priorState),before);
 assert.equal(saved,0);assert.equal(writes.length,writesBefore);
 const tick=source.slice(source.indexOf('async function tick()'));
 assert.ok(tick.indexOf('full_market_latest_candles:start')<tick.indexOf('strategy_priority_bridge:start'));
 assert.ok(tick.indexOf('writer_lease:complete')<tick.indexOf('full_market_latest_candles:start'));
 console.log('PASS early flush: full universe, natural latest, timing measured, failed DB preserves checkpoint, lease before write');
})().catch(e=>{console.error(e);process.exitCode=1;});
