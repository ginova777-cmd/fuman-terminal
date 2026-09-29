'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('../lib/mother-pool-module-input-checkpoint'),journal=require('../lib/daytrade-source-status-journal');
const {resumeCheckpoint}=require('../lib/mother-pool-resume-checkpoint');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'module-chain-'));
 try{
 const identity={trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1},at='2026-09-29T00:00:00Z';
 const inputs=['A01','A02'].map(module_id=>({...identity,module_id,created_at:at,requested_symbols:['2330'],rows:[{symbol:'2330',status:'DATA_GAP',data_gap_reason:'missing history',source:'isolated test',source_contract:'test',source_updated_at:at,is_synthetic:false,replay:false,look_ahead:false}]}));
 const ref=cp.save({directory,identity,observedAt:at,inputs:[...inputs,{module_id:'B09',build(){throw Error('never regenerate');}}]});
 const row={source_name:'fugle_daytrade_source',trade_date:identity.trade_date,updated_at:at,payload:{...identity,mother_pool_snapshot_sequence:1,module_input_checkpoint:ref}};
 const sourceIntent=journal.prepare(directory,row);
 for(const mode of ['ok','source-mismatch','lease-lost','partial','deferred-saved']){
 let leases=0,writes=0;const progress=[];
 const options={sourceIntent,identity,loadDeferred:async id=>mode==='deferred-saved'?{...inputs[0],module_id:id}:null,guard:async()=>{},assertLease:async()=>{if(++leases===3&&mode==='lease-lost')throw Error('LEASE_LOST');},readSource:async()=>mode==='source-mismatch'?[]:[row],saveProgress:async p=>progress.push(p),adapterFor:async input=>{
 let document;return {validatePlan:async d=>{document=d;},readCommitted:async()=>({rounds:[],rows:[]}),hasAttempt:async()=>mode==='partial'&&input.module_id==='A02',saveAttempt:async()=>{},persist:async()=>{writes++;return {committed:true,...identity,module_id:input.module_id,plan_hash:document.plan_hash,written_symbols:['2330']};},saveEvidence:async()=>{}};
 }};
 if(mode==='source-mismatch'){await assert.rejects(resumeCheckpoint(options),/ROW_COUNT/);assert.equal(writes,0);assert.equal(progress.length,0);continue;}
 const result=await resumeCheckpoint(options);assert.equal(result.complete,false);assert.equal(result.requires_independent_verification,true);assert.deepEqual(result.deferred_modules,mode==='deferred-saved'?[]:['B09']);if(mode==='ok')assert.equal(result.deferred_gaps.B09,'ORIGINAL_DEFERRED_PLAN_MISSING');
 assert.equal(writes,mode==='deferred-saved'?3:mode==='ok'?2:1);assert.equal(result.written_modules.length,writes);
 assert(result.written_modules.every(m=>m.plan.rows[0].status==='DATA_GAP'));
 if(!['ok','deferred-saved'].includes(mode))assert.equal(result.first_blocker.module_id,'A02');
 assert.equal(progress[0].written_modules.length,0); // saved progress must not mutate later
 }
 console.log('PASS checkpoint chain: source ACK precedes writes, lease loss/uncertainty stop, original gaps and deferred modules retained, no false COMPLETE');
 }finally{const root=path.resolve(directory);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('module-chain-'));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
