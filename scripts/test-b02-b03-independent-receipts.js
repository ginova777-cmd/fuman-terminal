'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('  const turnover = result.payload.intraday_turnover_ranking;');
const end=source.indexOf('\n}\n\nasync function writeEnrichmentPendingHeartbeat',start);
assert.ok(start>0&&end>start);
async function run(turnover, failTurnover=false, failRead=false, failPersist=false, blockedVerdict=false){
 const receipts=[],volume={run_id:'volume-test',canonical_run_id:'canonical-test'};let reads=0;
 const context={path:require('node:path'),result:{payload:{volume_value_ranking:volume,intraday_turnover_ranking:turnover}},
  SUPABASE_READ_KEY:'anon-fixture',SUPABASE_SERVICE_KEY:'owner-fixture',SOURCE_NAME:'fixture',tradeDate:'2026-09-17',
  nowIso:()=> '2026-09-17T02:00:00Z',runtimePath:(...parts)=>parts.join('/'),writeJsonAtomic:(file,value)=>{if(failPersist&&file.includes('volume-value'))throw Error('disk fixture');receipts.push({file,value});},
  supabaseGetPaged:async()=>{reads++;if(failRead)throw Error('fixture');return [{payload:{volume_value_ranking:volume,intraday_turnover_ranking:turnover}}];},
  require:id=>id.includes('volume-value')?{verify:()=>({complete:true,exit_code:0})}:{verifyDelivery:()=>{if(failTurnover)throw Error('B03_FIXTURE_FAILURE');return {complete:!blockedVerdict,exit_code:blockedVerdict?1:0};}}};
 let error=null;vm.createContext(context);try{await vm.runInContext(`(async()=>{${source.slice(start,end)}})()`,context);}catch(e){error=e.message;}
 return {receipts,reads,error};
}
(async()=>{
 const absent=await run(null);assert.equal(absent.reads,1);assert.equal(absent.receipts.length,2);assert.equal(absent.receipts[0].value.complete,true);
 assert.ok(absent.receipts[0].file.endsWith('/volume-value/volume-test.json'));
 assert.deepEqual(absent.receipts[0].value,absent.receipts[1].value);
 const broken=await run({run_id:'turnover',rows:[],data_gaps:[],requested_count:0},true);
 assert.equal(broken.reads,1);assert.equal(broken.receipts.filter(x=>x.file.includes('volume-value')).length,2);
 assert.equal(broken.receipts.find(x=>x.file.includes('volume-value')).value.complete,true);
 assert.equal(broken.receipts.find(x=>x.file.includes('intraday-turnover')).value.complete,false);
 const failed=await run(null,false,true);assert.equal(failed.receipts[0].value.complete,false);
 const fixture={run_id:'turnover',rows:[],data_gaps:[],requested_count:0};
 const disk=await run(fixture,false,false,true);assert.match(disk.error,/RANKING_RECEIPT_PERSIST_FAILED/);assert.equal(disk.receipts.length,2);
 const blocked=await run(fixture,false,false,false,true);assert.equal(blocked.error,null);assert.equal(blocked.receipts.find(x=>x.file.includes('intraday-turnover')).value.natural_production_readback_verified,false);
 console.log('PASS actual Writer B02 independent of missing/failing B03; one shared anon read; no receipt overwrite');
})().catch(error=>{console.error(error);process.exitCode=1;});
