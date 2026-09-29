'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),journal=require('../lib/daytrade-source-status-journal'),cp=require('../lib/mother-pool-module-input-checkpoint'),{inspect}=require('../lib/mother-pool-module-recovery-preflight');
(async()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'module-preflight-'));try{
 const identity={trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1},at='2026-09-29T00:00:00Z';
 const ref=cp.save({directory,identity,observedAt:at,inputs:[{...identity,module_id:'A01',rows:[]},{module_id:'B09',build:()=>{}}]});
 const row={source_name:'fugle_daytrade_source',trade_date:identity.trade_date,updated_at:at,payload:{...identity,mother_pool_snapshot_sequence:1,module_input_checkpoint:ref}};
 const sourceIntent=journal.prepare(directory,row);let reads=0;const guard=async()=>{},readSource=async()=>{reads++;return [structuredClone(row)]};
 const r=await inspect({sourceIntent,identity,guard,readSource});assert.equal(r.complete,false);assert.equal(r.observed_at,at);assert.deepEqual(r.deferred_modules,['B09']);assert.equal(reads,1);
 await assert.rejects(inspect({sourceIntent,identity,guard:async()=>{throw Error('blocked')},readSource}),/blocked/);assert.equal(reads,1);
 await assert.rejects(inspect({sourceIntent,identity,guard,readSource:async()=>[]}),/ROW_COUNT/);
 await assert.rejects(inspect({sourceIntent,identity,guard,readSource:async()=>[{...row,payload:{...row.payload,writer_run_id:'other'}}]}),/MISMATCH/);
 await assert.rejects(inspect({sourceIntent,identity:{...identity,snapshot_generation:'other'},guard,readSource}),/CHECKPOINT_MISMATCH/);
 console.log('PASS same-batch recovery preflight: exact source content, snapshot binding, guard, absence and replacement rejection');
}finally{fs.rmSync(directory,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
