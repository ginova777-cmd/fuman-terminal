'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('  const sideAsOf = nowIso();');
const end=source.indexOf('    // Persist native one-minute side rows',start);
assert.ok(start>0&&end>start);
for(const [minute,failure,expected] of [[540,false,'SOURCE'],[809,false,'SOURCE'],[810,false,'NOT_DUE'],[539,false,'NOT_DUE'],[600,true,'blocked']]){
 let calls=0;
 const context={result:{payload:{}},sideSnapshot:{run_id:'fixture'},nowIso:()=> '2026-09-17T02:00:00Z',taipeiClockMinutesFrom:()=>minute,
  path:require('node:path'),MOTHER_POOL_SNAPSHOT_FILE:'isolated/state/latest.json',readJson:()=>({run_id:'fixture'}),
  require:()=>({collect:options=>{calls++;assert.equal(options.snapshot.run_id,'fixture');assert.equal(options.runtimeRoot,'isolated');
   assert.ok(options.deadlineMs<=Date.now()+5000);if(failure)throw Error('fixture');return {status:'SOURCE',complete:false};}})};
 const offStart=source.indexOf('  } else {\n    result.payload.mother_pool_price_volume_evidence={status:',end);
 const offEnd=source.indexOf('  // Bind the independent',offStart);
 vm.runInNewContext(source.slice(start,end)+source.slice(offStart,offEnd),context);
 assert.equal(context.result.payload.mother_pool_minute_side_evidence.status,expected);
 assert.equal(calls,minute>=540&&minute<810?1:0);
}

const {persistMinuteSideRoundEvidence}=require('../lib/mother-pool-minute-side-persistence');
const fixture=require('./fixtures/minute-side-r4-plan.json').rounds[0];
(async()=>{
 let saved=false,acknowledged=false;
 await persistMinuteSideRoundEvidence(fixture.result,{snapshot:fixture.snapshot,savePlan:async()=>{saved=true;},persist:async plan=>{assert(saved);await new Promise(r=>setTimeout(r,5));acknowledged=true;return {written_symbols:plan.source_rows.map(r=>r.symbol),round_symbols:plan.requested_symbols};},saveEvidence:async()=>assert(acknowledged)});
 await assert.rejects(persistMinuteSideRoundEvidence(fixture.result,{snapshot:fixture.snapshot,savePlan:async()=>{},persist:async()=>{throw Error('write failure');},saveEvidence:async()=>assert.fail()}),/write failure/);
 assert.ok(source.includes("await require('../lib/mother-pool-minute-side-persistence').persistMinuteSideRoundEvidence"));
 console.log('PASS Writer invokes shared awaited persistence; isolated adapter completion and failure tested');
})().catch(e=>{console.error(e);process.exitCode=1;});
