"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('async function syncPreopenSnapshotHistory(');
const end=source.indexOf('async function captureFutoptPreopenBaseline(',start);
async function run(override){
 const writes=[];
 const ctx={PREOPEN_WRITER_CONTRACT:'test',APPLY:true,PREOPEN_CAPTURE_START_MINUTES:525,PREOPEN_CAPTURE_END_MINUTES:540,WINDOW_SECONDS:120,
 taipeiDate:()=> '2026-09-29',taipeiWeekday:()=> 'Tue',taipeiMinutes:()=>525,normalizeCode:String,isWebSocketQuote:()=>true,
 normalizeTimestamp:x=>x||'',taipeiDateFrom:x=>new Date(Date.parse(x)+28800000).toISOString().slice(0,10),
 taipeiClockMinutesFrom:x=>{const d=new Date(Date.parse(x)+28800000);return d.getUTCHours()*60+d.getUTCMinutes();},
 ageSeconds:x=>(Date.parse('2026-09-29T00:45:30Z')-Date.parse(x))/1000,
 nullableNumber:(x,positive)=>Number.isFinite(Number(x))&&x!=null&&(!positive||Number(x)>0)?Number(x):null,
 supabaseUpsert:async(table,rows)=>writes.push({table,rows})};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';globalThis.run=syncPreopenSnapshotHistory;',ctx);
 const quote={symbol:'2330',is_trial:true,trial_price:100,previous_close:99,trial_event_at:'2026-09-29T00:45:00Z',quote_seen_at:'2026-09-29T00:45:20Z',...override};
 const result=await ctx.run([{symbol:'2330'}],new Map([['2330',quote]]));return {result,writes};
}
(async()=>{
 const good=await run({});assert.equal(good.writes.length,2);assert.equal(good.writes[1].rows[0].observed_at,'2026-09-29T00:45:00Z');
 for(const change of [{trial_event_at:null},{trial_event_at:'2026-09-24T00:45:00Z'},{trial_event_at:'2026-09-29T00:46:00Z'},{is_trial:false}]){
  const bad=await run(change);assert.equal(bad.writes.length,0);assert.equal(bad.result.status,'degraded');
 }
 console.log('PASS actual Writer trial capture: native event only, no transport fallback, no old/future events');
})().catch(e=>{console.error(e);process.exitCode=1;});
