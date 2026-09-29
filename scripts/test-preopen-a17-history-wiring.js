"use strict";
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),preopen=require('../lib/preopen-a15-a19');
const src=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=src.indexOf('async function buildPreopenA15A19Evidence('),end=src.indexOf('function buildB19B24Evidence(',start);
const slots=['08:45','08:50','08:55','08:59'];
const history=slots.map(slot=>({symbol:'2330',trade_date:'2026-09-29',observed_at:`2026-09-29T${slot}:00+08:00`,trial_price:100,is_trial:true,payload:{trial_event_at:`2026-09-29T${slot}:00+08:00`,source:'fugle_daytrade_source_writer:preopen_websocket',writer_contract:'preopen_snapshot_history_v2',trial_event_time_source:'provider_trial_event'}}));
async function run(records,minutes=540,fail=false){
 const calls=[];const c={preopenA15A19:preopen,nowIso:()=> '2026-09-29T01:00:00Z',taipeiMinutes:()=>minutes,PREOPEN_CAPTURE_START_MINUTES:525,PREOPEN_WRITER_CONTRACT:'preopen_snapshot_history_v2',SOURCE_NAME:'fugle_daytrade_source',runtimePath:()=>'',a16Writer:{readReferences:()=>[]},supabaseGetPaged:async(t,q,o)=>{calls.push({t,q,o});if(fail)throw Error('read failed');return records}};
 vm.createContext(c);vm.runInContext(src.slice(start,end)+';globalThis.run=buildPreopenA15A19Evidence;',c);
 return {value:await c.run([{symbol:'2330'}],new Map(),'2026-09-29'),calls};
}
(async()=>{
 const good=await run(history);assert.equal(good.value.a17.complete,true);assert.equal(good.calls[0].o.pageSize,500);assert.equal(good.calls[0].o.requireExactCount,true);assert.match(good.calls[0].q,/trade_date=eq.2026-09-29/);assert.match(good.calls[0].q,/observed_at=lte/);
 assert.equal((await run(history.slice(1))).value.a17.complete,false);
 const legacy=history.map(r=>({...r,payload:{...r.payload,trial_event_time_source:undefined}}));assert.equal((await run(legacy)).value.a17.complete,false);
 const early=await run(history,524);assert.equal(early.calls.length,0);assert.equal(early.value.a17.complete,false);
 const failed=await run([],540,true);assert.equal(failed.value.a17.complete,false);assert.equal(failed.value.a17.source_readback.status,'BLOCKED');
 console.log('PASS actual A17 history wiring: bounded exact pages, four slots, missing/legacy/read failure, pre-slot no query');
})().catch(e=>{console.error(e);process.exitCode=1;});
