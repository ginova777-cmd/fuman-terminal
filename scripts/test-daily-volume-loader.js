'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const a=s.indexOf('async function fetchDailyVolumeAvg()'),b=s.indexOf('function taipeiDateDaysAgo',a);
const calls=[],logs=[];
// Deliberately no global tickStage: the real loader is outside tick() scope.
const c={console:{log:x=>logs.push(JSON.parse(x))},taipeiDate:()=> '2026-09-29',DEEP_SCAN_POOL_MAX_SYMBOLS:60,
 supabaseGetPaged:async(resource,query,options)=>{calls.push(options);return[{symbol:resource,trade_date:'2026-09-29'}]},
 dailyVolumeRowsToMap:rows=>new Map(rows.map(r=>[r.symbol,r])),fetchRecentThreeDayAverageVolume:async()=>({bySymbol:new Map([['2330',{avg_volume3:100}]]),source:'history'})};
vm.createContext(c);vm.runInContext(s.slice(a,b)+';globalThis.run=fetchDailyVolumeAvg;',c);
c.run().then(result=>{assert.equal(result.size,3);assert.equal(result.readErrors.length,0);assert.equal(calls.length,2);assert(calls.every(o=>o.pageSize===500));assert(logs.some(x=>x.stage==='daily_volume:recent_three_day:complete'));console.log('PASS real loader scope, both sources, historical merge, 500 pages and stage tracing');}).catch(e=>{console.error(e);process.exitCode=1});
