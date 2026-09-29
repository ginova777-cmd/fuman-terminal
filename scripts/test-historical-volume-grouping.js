'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const date='2026-09-29',calendar={trade_date:date,status:'SESSION_DATES_VERIFIED',checks:Array.from({length:20},(_,i)=>({date:new Date(Date.parse(date+'T00:00:00Z')-(i+1)*86400000).toISOString().slice(0,10),isTradingDay:true,source:'cache'}))};
const baseline=require('../lib/mother-pool-daily-volume-baseline');
const dates=baseline.datesFromCalendar(calendar,date,15),rows=[];
for(let i=0;i<2000;i++)for(const d of dates)rows.push({symbol:String(1000+i),trade_date:d,volume_lots:i+1,open:10,high:12,low:9,close:11});
// Duplicates and invalid values must remain gaps after grouping.
rows.push({...rows.find(r=>r.symbol==='1001'&&r.trade_date===dates[14])});
rows.find(r=>r.symbol==='1002'&&r.trade_date===dates[14]).volume_lots=-1;
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8'),a=source.indexOf('async function fetchRecentThreeDayAverageVolume()'),b=source.indexOf('\nasync function fetchDailyVolumeAvg()',a);
async function evaluate(code){let calls=0;const sandbox={recentThreeDayVolumeCache:{},taipeiDate:()=>date,statePath:()=>'',nowIso:()=>date+'T00:00:00Z',normalizeCode:x=>String(x),supabaseGetPaged:async()=>{calls++;return rows;},require:n=>n==='../lib/mother-pool-historical-sessions'?{selectSessions:async()=>calendar}:require(n),Date,Map,Set};
vm.createContext(sandbox);const t=performance.now();const result=await vm.runInContext(code+'\nfetchRecentThreeDayAverageVolume()',sandbox);return {value:JSON.parse(JSON.stringify([...result.bySymbol])),calls,ms:performance.now()-t};}
(async()=>{const actual=await evaluate(source.slice(a,b));assert.equal(actual.calls,1);assert.equal(actual.value.length,2000);const map=new Map(actual.value);assert.equal(map.get('1000').avg_volume5,1);assert.equal(map.get('2999').avg_volume3,2000);assert.equal(map.get('1001').daily_volume_evidence.status,'DATA_GAP');assert.equal(map.get('1001').avg_volume3,null);assert.equal(map.get('1002').daily_volume_evidence.status,'DATA_GAP');
const oldPath=process.argv.find(s=>s.startsWith('--compare='))?.slice(10);if(oldPath){const before=await evaluate(fs.readFileSync(oldPath,'utf8'));assert.deepEqual(actual.value,before.value);console.log(JSON.stringify({equivalent:true,rows:rows.length,symbols:2000,before_ms:Math.round(before.ms),after_ms:Math.round(actual.ms)}));}
console.log('PASS actual historical loader: complete universe retained, exact baselines and gaps preserved');})().catch(e=>{console.error(e);process.exitCode=1;});
