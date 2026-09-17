'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('  const sideAsOf = nowIso();');
const end=source.indexOf('  await writeStatusAndScorecard(result);',start);
assert.ok(start>0&&end>start);
for(const [minute,failure,expected] of [[540,false,'SOURCE'],[809,false,'SOURCE'],[810,false,'NOT_DUE'],[539,false,'NOT_DUE'],[600,true,'blocked']]){
 let calls=0;
 const context={result:{payload:{}},nowIso:()=> '2026-09-17T02:00:00Z',taipeiClockMinutesFrom:()=>minute,
  path:require('node:path'),MOTHER_POOL_SNAPSHOT_FILE:'isolated/state/latest.json',readJson:()=>({run_id:'fixture'}),
  require:()=>({collect:options=>{calls++;assert.equal(options.snapshot.run_id,'fixture');assert.equal(options.runtimeRoot,'isolated');
   assert.ok(options.deadlineMs<=Date.now()+5000);if(failure)throw Error('fixture');return {status:'SOURCE',complete:false};}})};
 vm.runInNewContext(source.slice(start,end),context);
 assert.equal(context.result.payload.mother_pool_minute_side_evidence.status,expected);
 assert.equal(calls,minute>=540&&minute<810?1:0);
}
const receiptStart=source.indexOf('  const turnover = result.payload.intraday_turnover_ranking;');
const receiptEnd=source.indexOf('\n}\n\nasync function writeEnrichmentPendingHeartbeat',receiptStart);
assert.ok(receiptStart>0&&receiptEnd>receiptStart);
async function check(failRead){
 const batch={contract:'mother_pool_minute_side_batch_v1',trade_date:'2026-09-17',canonical_run_id:'fugle_daytrade_source:20260917:canonical',
  mother_pool_run_id:'fixture',snapshot_sequence:1,as_of:'2026-09-17T02:00:00Z',requested:1,evaluated:1,source_ready:0,
  details:[{symbol:'2330',status:'DATA_GAP',reason:'NATIVE_JOURNAL_MISSING'}],complete:false,baseline_verified:false,publish_allowed:false,creates_order:false};
 const receipts=[];let reads=0;
 const context={result:{payload:{mother_pool_minute_side_evidence:batch}},path:require('node:path'),require,
  SUPABASE_READ_KEY:'anon-fixture',SUPABASE_SERVICE_KEY:'service-fixture',SOURCE_NAME:'fixture',tradeDate:'2026-09-17',
  nowIso:()=>batch.as_of,runtimePath:(...parts)=>parts.join('/'),writeJsonAtomic:(file,value)=>receipts.push({file,value}),
  supabaseGetPaged:async(resource,query,options)=>{reads++;assert.equal(options.service,false);if(failRead)throw Error('fixture');
   return [{payload:{mother_pool_minute_side_evidence:structuredClone(batch)}}];}};
 await vm.runInNewContext(`(async()=>{${source.slice(receiptStart,receiptEnd)}})()`,context);
 assert.equal(reads,1);assert.equal(receipts.length,2);
 assert.equal(receipts[0].value.readback_verified,!failRead);assert.equal(receipts[0].value.complete,false);
 assert.equal(receipts[0].value.attempt_id,receipts[1].value.attempt_id);
 assert.notEqual(receipts[0].file,receipts[1].file);
}
(async()=>{await check(false);await check(true);console.log('PASS actual Writer minute-side window, collection failure, independent verifier, anon readback failure and attempt receipts');})()
 .catch(error=>{console.error(error);process.exitCode=1;});
