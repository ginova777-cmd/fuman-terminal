'use strict';
const path=require('path');
async function prepare(){
 const detector=require('./run-daytrade-source-writer');
 const {isTwseTradingDay}=require('./twse-trading-day');
 const {selectSessions}=require('../lib/mother-pool-historical-sessions');
 const {newIdentity}=require('../lib/daytrade-writer-identity');
 const {readFugleWebSocketQuotes,readFugleWebSocketCandles}=require('../lib/fugle-websocket-quotes');
 const {buildWarmupPackage}=require('../lib/daytrade-memory-warmup-package');
 const now=new Date(),tradeDate=new Date(now.getTime()+28800000).toISOString().slice(0,10);
 const stateDir=path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','state');
 const today=await isTwseTradingDay(now,{stateDir,ignoreOverrides:true});
 if(today.date!==tradeDate||today.isTradingDay!==true||!['twse','cache'].includes(today.source)||today.error||today.override===true)throw Error('MEMORY_WARMUP_CALENDAR_NOT_VERIFIED');
 const historyCalendar=await selectSessions({tradeDate,resolveDay:date=>isTwseTradingDay(date,{stateDir,ignoreOverrides:true})});
 if(historyCalendar.status!=='SESSION_DATES_VERIFIED')throw Error('MEMORY_WARMUP_HISTORY_CALENDAR_NOT_VERIFIED');
 const identity=newIdentity('fugle_daytrade_source','memory-detector',tradeDate);
 const cache=readFugleWebSocketQuotes({maxAgeMs:120000});
 const warmup=await buildWarmupPackage({detector,tradeDate,identity,revision:identity.generation_id,calendar:{tradeDate,isTradingDay:true,source:today.source},historyCalendar,rawQuotes:[...cache.quotes.values()]});
 const universe=new Set(warmup.baseline.activeSymbols.map(r=>r.symbol));
 const {terminalSupabaseKey,terminalSupabaseUrl}=require('../lib/server-supabase-key');
 const runtimeDir=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime';
 const sourceOptions={root:path.resolve(__dirname,'..'),runtimeDir};
 const {loadHistory,createPageReader}=require('../lib/daytrade-memory-history');
 const baseline=await require('../lib/daytrade-memory-history-warmup').completeHistoryWarmup(warmup.baseline,()=>loadHistory({tradeDate,symbols:[...universe],calendar:historyCalendar,readPage:createPageReader({url:terminalSupabaseUrl(sourceOptions),key:terminalSupabaseKey(sourceOptions)})}));
 const currentQuotes=readFugleWebSocketQuotes({maxAgeMs:120000});
 const currentCandles=readFugleWebSocketCandles({maxAgeMs:8*3600000});
 return {...warmup,baseline,initialQuotes:[...currentQuotes.quotes.values()],initialCandles:[...currentCandles.candles.values()].filter(r=>r.tradeDate===tradeDate&&universe.has(String(r.symbol||r.code)))};
}
module.exports={prepare};
