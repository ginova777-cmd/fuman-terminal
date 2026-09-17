'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8').replace(/\r\n/g,'\n');
const snapshot={run_id:'fixture',snapshot_sequence:1,trade_date:'2026-09-17',canonical_run_id:'fixture'};
let calls=[],ack={ok:true,run_id:'fixture',snapshot_sequence:1},failure=false,readFailure=false,readBlocked=false,receipts=[];
const ctx=vm.createContext({DRY_RUN:false,nowIso:()=> 'fixture',buildMotherPoolSnapshot:()=>snapshot,
 SUPABASE_READ_KEY:'anon-fixture',SUPABASE_SERVICE_KEY:'service-fixture',
 fs:{existsSync:()=>false},supabaseGetPaged:async()=>{if(readFailure)throw Error('view HTTP 503 secret-test-marker');return [];},require:id=>id.endsWith('/daytrade-mother-pool-snapshot')?{inspectSnapshot:()=>({ok:true})}:id.endsWith('/mother-pool-snapshot-readback')?{verifySnapshotReadback:()=>({complete:!readBlocked,status:'complete',exit_code:0,read_role:'anon',trade_date:snapshot.trade_date,canonical_run_id:snapshot.canonical_run_id,first_blocker:null,mother_pool_run_id:'fixture',snapshot_sequence:1,failed_checks:readBlocked?['member_count_mismatch']:[]})}:require(id),
 path:require('node:path'),MOTHER_POOL_SNAPSHOT_RECEIPT_DIR:'isolated',MOTHER_POOL_SNAPSHOT_FILE:'latest',
 compactDateKey:()=> '20260917',writeJsonAtomic:(file,value)=>{if(file.includes('snapshot-anon'))receipts.push(value);if(!file.includes('publication-intent')&&!file.includes('snapshot-anon'))calls.push(file);},
 publishMotherPoolSnapshotSupabase:async()=>{calls.push('DB');if(failure)throw Error('DB failure');return ack;}});
const start=source.indexOf('async function publishMotherPoolSnapshot(');assert.ok(start>=0);
vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),ctx);
async function main(){
 await ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture');
 assert.equal(calls[0],'DB');assert.equal(calls.at(-1),'latest');assert.equal(calls.length,3);
 calls=[];failure=true;
 await assert.rejects(()=>ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture'),/DB failure/);
 assert.deepEqual(calls,['DB']);failure=false;
 for(const invalid of [{},{ok:true,run_id:'other',snapshot_sequence:1},{ok:true,run_id:'fixture',snapshot_sequence:2}]){
  ack=invalid;calls=[];
  await assert.rejects(()=>ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture'),/DB_ACK_MISMATCH/);
  assert.deepEqual(calls,['DB']);
 }
 ack={ok:true,run_id:'fixture',snapshot_sequence:1};readFailure=true;calls=[];receipts=[];
 await assert.rejects(()=>ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture'),/READBACK_FAILED/);
 assert.deepEqual(calls,['DB']);assert.equal(receipts.length,2);
 assert.equal(receipts[0].complete,false);assert.equal(receipts[0].http_status,503);
 assert.ok(receipts[0].attempt_id);assert.equal(JSON.stringify(receipts).includes('secret-test-marker'),false);
 readFailure=false;readBlocked=true;calls=[];receipts=[];
 await assert.rejects(()=>ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture'),/READBACK_FAILED/);
 assert.deepEqual(calls,['DB']);assert.equal(receipts.length,2);
 assert.equal(receipts[0].complete,false);
 assert.deepEqual(receipts[0].failed_checks,['member_count_mismatch']);
 readBlocked=false;ctx.SUPABASE_READ_KEY=ctx.SUPABASE_SERVICE_KEY;calls=[];receipts=[];
 await assert.rejects(()=>ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture'),/READBACK_FAILED/);
 assert.deepEqual(calls,['DB']);assert.equal(receipts[0].complete,false);
 ctx.DRY_RUN=true;calls=[];await ctx.publishMotherPoolSnapshot([],[],'2026-09-17','fixture');
 assert.deepEqual(calls,[]);
 console.log('PASS actual Writer: DB before local publication, failure/mismatched ACK preserve local latest, dry run has no writes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
