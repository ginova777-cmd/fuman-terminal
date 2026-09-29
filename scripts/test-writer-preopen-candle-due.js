'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replace(/\r\n/g,'\n');
const start=text.indexOf('async function syncWebSocketIntraday1mCandles('),end=text.indexOf('\n}\n',start)+2;
assert(start>=0&&end>start);
(async()=>{
 for(const hm of ['06:00:00','08:59:59','09:00:00']){
  let reads=0;const instant=Date.parse('2026-09-29T'+hm+'+08:00');
  class Clock extends Date {static now(){return instant;}}
  const context={Date:Clock,require:id=>id==='../lib/daytrade-fast-candle-row'?{mapNaturalCandle:()=>null}:id==='../lib/daytrade-latest-candle-evidence'?{latestCandleEvidence:()=>({complete:false})}:require(id),
   nowIso:()=>new Date(instant).toISOString(),taipeiDateFrom:t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+28800000).toISOString().slice(0,10):null,
   readJson:()=>{reads++;return {};},FUGLE_WS_STATUS_FILE:'isolated',PRIORITY_SYMBOLS_FILE:'isolated',normalizeCode:String,
   readFugleWebSocketCandles:()=>{reads++;return {candles:new Map()};},WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS:90000};
  vm.createContext(context);vm.runInContext(text.slice(start,end),context);
  const result=await context.syncWebSocketIntraday1mCandles([{symbol:'2330'}],{}, {latestOnly:true});
  assert.equal(result.written,0);assert.equal(result.skipped,true);
  if(hm<'09:00:00'){assert.equal(result.status,'NOT_DUE');assert.equal(reads,0);assert.equal(result.latest_candle_evidence,undefined);assert.equal(result.complete,false);}
  else{assert(reads>0);assert.equal(result.reason,'no_today_mother_pool_candles');assert(result.latest_candle_evidence);assert.notEqual(result.status,'NOT_DUE');}
 }
 console.log('PASS actual Writer candle sync: preopen NOT_DUE without readback evidence; 09:00 missing bars remain a gap');
})().catch(e=>{console.error(e);process.exitCode=1;});

