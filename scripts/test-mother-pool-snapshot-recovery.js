'use strict';
const assert=require('node:assert/strict');
const {publishWithRecovery}=require('../lib/mother-pool-snapshot-publication');
async function main(){
 const valid={complete:true,status:'complete',exit_code:0,read_role:'anon',trade_date:'2026-09-17',canonical_run_id:'canonical',
  failed_checks:[],first_blocker:null,mother_pool_run_id:'one',generation:'one',snapshot_sequence:1};
 for(const patch of [{generation:'wrong'},{generation:undefined},{read_role:'service_role'},{trade_date:'2026-09-16'},{canonical_run_id:'other'},{exit_code:1},{failed_checks:['missing']},{first_blocker:'missing'},{status:'blocked'}]) {
  let committed=false;
  await assert.rejects(()=>publishWithRecovery({tradeDate:valid.trade_date,canonicalRunId:'canonical',loadIntent:()=>null,saveIntent:()=>{},
   build:()=>({trade_date:valid.trade_date,canonical_run_id:'canonical',run_id:'one',generation:'one',snapshot_sequence:1}),validate:()=>true,
   send:()=>({ok:true,run_id:'one',generation:'one',snapshot_sequence:1}),readback:()=>({...valid,...patch}),commit:()=>{committed=true;}}),/READBACK_FAILED/);
  assert.equal(committed,false);
 }
 for(const fault of ['rpc_after_commit','local_disk','ack_intent']) {
  let intent=null,latest=null,failed=false;const db=new Map(),sent=[];
  const snapshot={trade_date:'2026-09-17',canonical_run_id:'canonical',run_id:'one',generation:'one',snapshot_sequence:1};
  const options={tradeDate:snapshot.trade_date,canonicalRunId:'canonical',validate:()=>true,
   loadIntent:()=>intent,saveIntent:v=>{if(fault==='ack_intent'&&v.status==='acknowledged'&&!failed){failed=true;throw Error(fault);}intent=structuredClone(v);},
   build:()=>latest||snapshot,
   send:s=>{const old=db.get(s.run_id);if(old)assert.deepEqual(old,s);db.set(s.run_id,structuredClone(s));sent.push(structuredClone(s));
    if(fault==='rpc_after_commit'&&!failed){failed=true;throw Error(fault);}return {ok:true,run_id:s.run_id,snapshot_sequence:s.snapshot_sequence};},
   readback:s=>({complete:true,status:'complete',exit_code:0,read_role:'anon',trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,
    failed_checks:[],first_blocker:null,mother_pool_run_id:s.run_id,generation:s.generation,snapshot_sequence:s.snapshot_sequence}),
   commit:s=>{if(fault==='local_disk'&&!failed){failed=true;throw Error(fault);}latest=structuredClone(s);}};
  await assert.rejects(()=>publishWithRecovery(options),new RegExp(fault));
  assert.equal(intent.status,'pending');
  await publishWithRecovery(options);
  assert.equal(intent.status,'acknowledged');assert.deepEqual(latest,snapshot);
  assert.ok(sent.every(s=>JSON.stringify(s)===JSON.stringify(snapshot)));
  intent.snapshot.trade_date='2026-09-16';
  await assert.rejects(()=>publishWithRecovery(options),/INTENT_INVALID/);
  console.log('PASS recovery '+fault+' and cross-date rejection');
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
