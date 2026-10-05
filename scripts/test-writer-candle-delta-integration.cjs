'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('async function syncWebSocketIntraday1mCandles('),end=source.indexOf('async function syncWebSocketFutoptQuotes(',start);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'writer-integration-'));let fail=false,writes=0,stateWrites=0;
const bar={symbol:'2383',code:'2383',market:'TSE',tradeDate:'2026-10-05',candleTime:'2026-10-05T09:00:00+08:00',candleSeenAt:'2026-10-05T09:01:01+08:00',open:100,high:102,low:99,close:101,volume:30,source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',restRepairRow:false,intradayOddLot:false,synthetic:false,volumeStrategyUsable:true,payload:{}};
const now=Date.parse('2026-10-05T10:00:00+08:00');class Clock extends Date{static now(){return now;}}
const ctx={require,Date:Clock,process:{env:{}},normalizeCode:x=>String(x||''),numberValue:x=>Number(x)||0,normalizeTimestamp:x=>new Date(x).toISOString(),taipeiDateFrom:x=>Number.isFinite(Date.parse(x))?new Date(Date.parse(x)+28800000).toISOString().slice(0,10):"",nowIso:()=>new Date(now).toISOString(),FUGLE_WS_STATUS_FILE:'status',PRIORITY_SYMBOLS_FILE:'priority',WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS:Infinity,readJson:()=>({}),readFugleWebSocketCandles:()=>({candles:new Map([['bar',bar]]),payload:{updatedAt:new Date(now).toISOString()}}),INTRADAY_MIRROR_BARS_PER_SYMBOL:200,SLOW_TABLE_BATCH_SIZE:100,DRY_RUN:false,SUPABASE_URL:'isolated-test',runtimePath:(...p)=>path.join(dir,...p),supabaseUpsert:async(table,rows)=>{if(fail)throw Error('DB_FAIL');writes+=rows.length;},writeWriterState:()=>{stateWrites++;}};
const sync=vm.runInNewContext(source.slice(start,end)+';syncWebSocketIntraday1mCandles',ctx);
(async()=>{const state={};let r=await sync([{symbol:'2383'}],state);assert.equal(r.written,1);assert.equal(state.daytradeMotherPoolCandleMirror.symbols['2383'].seeded,false);
r=await sync([{symbol:'2383'}],state);assert.equal(r.written,0);assert.equal(r.unchanged,1);assert.equal(writes,1);assert.equal(r.notReadySymbols,1);
bar.volume=31;r=await sync([{symbol:'2383'}],state);assert.equal(r.written,1);
bar.volume=32;fail=true;const before=stateWrites;await assert.rejects(sync([{symbol:'2383'}],state));assert.equal(stateWrites,before);fail=false;r=await sync([{symbol:'2383'}],state);assert.equal(r.written,1);
console.log('PASS: actual Writer function skips repeated unseeded bars, retains insufficient warmup, writes revisions, retries failed writes.');})().catch(e=>{console.error(e);process.exitCode=1});
