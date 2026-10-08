'use strict';
// Execute the unmodified original Writer candle stage only. No top-level Writer
// is evaluated; injected filesystem/cache/time and DB sink are all isolated.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.resolve(__dirname,'../../scripts/run-daytrade-source-writer.js');
const text=fs.readFileSync(file,'utf8');
const start=text.indexOf('async function syncWebSocketIntraday1mCandles('),end=text.indexOf('\nasync function syncWebSocketFutoptQuotes()',start);
if(start<0||end<start)throw Error('WRITER_ORACLE_BOUNDARY_CHANGED');
const body=text.slice(start,end),sourceHash=require('../../lib/mother-change-evidence.cjs').sha(body);
async function originalCandleStage(raw,{tradeDate,nowMs,cacheUpdatedAt,allowedSymbols},state={},latestOnly=false){
 const writes=[],requireOriginal=createRequire(file);const Clock=class extends Date{constructor(...a){super(...(a.length?a:[nowMs]));}static now(){return nowMs;}};
 const context={Date:Clock,Map,Set,Number,String,Math,Array,process:{env:{}},WINDOW_SECONDS:120,WEBSOCKET_CANDLE_HISTORY_MAX_AGE_MS:Infinity,FUGLE_WS_STATUS_FILE:'status',PRIORITY_SYMBOLS_FILE:'priority',INTRADAY_MIRROR_BARS_PER_SYMBOL:20,DRY_RUN:false,SUPABASE_URL:'OFFLINE',SLOW_TABLE_BATCH_SIZE:100,
 require:n=>n==='../lib/daytrade-writer-candle-delta.cjs'?{sync:async({rows})=>{writes.push(...rows);return {written:rows.length,unchanged:0};}}:requireOriginal(n),
 readJson:n=>n==='status'?{subscribedSymbolList:[...allowedSymbols]}:{tradeDate,updatedAt:cacheUpdatedAt,daytradeMotherPoolSymbols:[]},normalizeCode:x=>String(x),normalizeTimestamp:x=>new Date(x).toISOString(),numberValue:x=>Number(x),taipeiDateFrom:x=>new Date(Date.parse(x)+28800000).toISOString().slice(0,10),nowIso:()=>new Date(nowMs).toISOString(),readFugleWebSocketCandles:()=>({candles:new Map(raw.map((r,i)=>[i,r])),payload:{updatedAt:cacheUpdatedAt}}),runtimePath:()=>'/OFFLINE_NOT_USED',writeWriterState:()=>{},supabaseUpsert:()=>{throw Error('UNEXPECTED_DB_CALL');}};
 vm.createContext(context);vm.runInContext(body+';this.run=syncWebSocketIntraday1mCandles;',context,{timeout:5000});
 const receipt=await context.run([...allowedSymbols].map(symbol=>({symbol})),state,{latestOnly});
 return {rows:JSON.parse(JSON.stringify(writes)),receipt:JSON.parse(JSON.stringify(receipt)),source_hash:sourceHash};
}
module.exports={originalCandleStage,sourceHash};
