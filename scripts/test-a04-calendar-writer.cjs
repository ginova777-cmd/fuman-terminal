'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./test-a04-calendar-history.cjs');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const code=source.slice(source.indexOf('async function syncMarketCalendarEvidence()'),source.indexOf('async function tick('));
async function run({sourceFailure=false,dbFailure=false}={}){
 const f=fixture();let saved=null,saves=0;const normal=[];
 const stamp=Date.parse('2026-10-13T00:45:00Z');class Clock extends Date{constructor(...a){super(...(a.length?a:[stamp]));}static now(){return stamp;}}
 const context={Date:Clock,process:{env:{}},a04CalendarHistory:null,SUPABASE_URL:'https://offline.invalid',requireSupabaseKey:()=> 'TEST',
  console:{log(){},error(){}},runtimePath:(...x)=>x.join('/'),readJson:()=>saved,
  writeJsonAtomic:(_,x)=>{saved=x;saves++;},supabaseUpsert:async(_,rows)=>normal.push(rows.length),
  require:name=>{
   if(name.includes('daytrade-calendar-publication'))return{buildCalendarPublication:async()=>[{trade_date:'2026-10-13'}]};
   if(name.includes('a04-calendar-io'))return{createCalendarIO:()=>({readDays:f.options.readDays,writeRows:async rows=>{if(dbFailure)throw Error('DB_FAILURE');await f.options.writeRows(rows);}})};
   if(name.includes('twse-trading-day'))return{isTwseTradingDay:async date=>{if(sourceFailure)throw Error('SOURCE_GAP');return f.options.resolveDay(date);}};
   if(name.includes('a04-calendar-history'))return require('../lib/a04-calendar-history.cjs');
   throw Error('Unexpected dependency '+name);
  }};
 vm.createContext(context);vm.runInContext(code+';globalThis.run=syncMarketCalendarEvidence;',context);
 await context.run();await context.run();assert.deepEqual(normal,[1,1]);
 if(sourceFailure||dbFailure){assert.equal(saved,null);assert.equal(context.a04CalendarHistory.status,'BLOCKED');}
 else{assert.equal(saves,1);assert.equal(f.writes.length,1);assert.equal(context.a04CalendarHistory.session_dates.length,15);assert.equal(context.a04CalendarHistory.status,'SESSION_DATES_VERIFIED');}
}
(async()=>{await run();await run({sourceFailure:true});await run({dbFailure:true});
 const shared={calendar:{status:'SESSION_DATES_VERIFIED'},rows:[]},value={historical_daily_evidence:shared,a04_daily_evidence:shared};
 const context={Date,taipeiDate:()=> '2026-10-13',recentThreeDayVolumeCache:{tradeDate:'2026-10-13',loadedAt:Date.now(),bySymbol:new Map([['2330',value]])},a04CalendarHistory:{status:'BLOCKED',checks:[]}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function fetchRecentThreeDayAverageVolume()'),source.indexOf('async function fetchDailyVolumeAvg()'))+';globalThis.run=fetchRecentThreeDayAverageVolume;',context);
 await context.run();assert.equal(value.a04_daily_evidence.calendar.status,'BLOCKED');assert.equal(value.historical_daily_evidence,shared);
 console.log('PASS Writer wiring: 15 verified sessions, cache reuse, source/DB failure BLOCKED without success cache; OHLCV cache cannot mask calendar rejection');})().catch(e=>{console.error(e);process.exitCode=1;});
