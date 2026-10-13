'use strict';
const fs=require('node:fs'),path=require('node:path'),E=require('../lib/mother-pool-event-evidence.cjs');
const {identityFields,hash}=require('../lib/mother-pool-module-write-set');
// Test adapter for the full Writer process. All reads target its isolated HTTP facade.
async function prepare({writeSets,runtime,asOf,tradeConfig}){
 E.need(new URL(process.env.SUPABASE_URL).hostname==='offline.invalid','OFFLINE_HTTP_REQUIRED');
 const root=path.join(runtime,'event-evidence');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(runtime,'ISOLATED_ONLY'),'TEST_ONLY');
 const identity=writeSets.B24,epoch=tradeConfig.segmentBinding.epoch;
 E.need(identity,'ACTUAL_WRITER_B24_REQUIRED');
 const snapshotBytes=fs.readFileSync(path.join(runtime,'state/daytrade-mother-pool-snapshot-latest.json')),snapshotFile=path.join(root,E.digest(snapshotBytes)+'.json');fs.writeFileSync(snapshotFile,snapshotBytes);const snapshot=E.reference(snapshotFile);
 const sync=JSON.parse(fs.readFileSync(path.join(runtime,'state/daytrade-fast-supabase-sync.json')));
 const receipt=E.save(root,sync),proof=E.save(root,JSON.parse(fs.readFileSync(path.join(runtime,'state/candle-save-proofs',sync.candle_save_proof.sha256+'.json'))));
 const checkpoint=E.save(root,JSON.parse(fs.readFileSync(path.join(runtime,'state/daytrade-fast-candle-delta.json'))));
 const cache=JSON.parse(fs.readFileSync(path.join(runtime,'cache/intraday/fugle-daytrade-ws-candles-v2.json')));
 const rows=E.save(root,require('./sync-daytrade-websocket-supabase-fast.js').mapCandleCache(cache,identity.trade_date,Date.parse(asOf)));
 const state={scope:'TEST_ONLY',epoch,generation_id:identity.generation_id,snapshot_generation:identity.snapshot_generation,sources:{}};
 const sourceReferences={},writerProvenance={};
 for(const row of identity.plan.rows){
  const required=['B13','B22'];
  if(!required.every(id=>row.events.some(e=>e.module_id===id)))continue;
  for(const id of required){
   const w=writeSets[id],r=w.plan.rows.find(r=>r.symbol===row.symbol);E.need(r,'ACTUAL_PARENT_REQUIRED');
   const read=async role=>{
    const u=new URL(process.env.SUPABASE_URL+'/rest/v1/v_daytrade_module_readback_v2');u.searchParams.set('module_id','eq.'+id);u.searchParams.set('writer_run_id','eq.'+w.writer_run_id);
    const response=await fetch(u,{headers:{apikey:role==='anon'?process.env.SUPABASE_ANON_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(30000)});E.need(response.ok,'MODULE_READBACK_HTTP');
    const found=(await response.json()).filter(x=>x.symbol===row.symbol);E.need(found.length===1&&identityFields.every(k=>found[0][k]===w[k]),'READBACK_IDENTITY');
    const projected=Object.fromEntries(Object.keys(r).map(k=>[k,found[0][k]]));E.need(hash(projected)===hash(r),'READBACK_CONTENT');return E.save(root,[projected]);
   };
   const write_set=E.save(root,w),db=await read('service'),anon=await read('anon');
   const cp=E.save(root,{...Object.fromEntries(identityFields.map(k=>[k,w[k]])),scope:'TEST_ONLY',contract:'b24_event_checkpoint_v1',epoch,symbol:row.symbol,module_id:id,plan_hash:w.plan_hash,write_set_sha256:write_set.sha256});
   const p=E.save(root,{scope:'TEST_ONLY',contract:'b24_event_readback_proof_v1',checkpoint_sha256:cp.sha256,db_sha256:db.sha256,anon_sha256:anon.sha256,row_hash:hash(r),plan_hash:w.plan_hash,verified_at:new Date().toISOString()});
   sourceReferences[id+':'+row.symbol]={write_set,db,anon,checkpoint:cp,proof:p,revision:1};state.sources[id+':'+row.symbol]={revision:1,proof_sha256:p.sha256,gap:false};
  }
  const session=path.join(tradeConfig.segmentBinding.evidenceRoot,epoch,'000001'),batch=JSON.parse(fs.readFileSync(path.join(session,'batch-sealed.json'))),p=batch.proofs.find(p=>p.symbol===row.symbol);E.need(p,'SEGMENT_REQUIRED');
  const journal=fs.readFileSync(path.join(tradeConfig.root,p.trade_date,p.symbol+'.jsonl')),bytes=journal.subarray(p.start_offset,p.end_offset),file=path.join(root,p.sha256+'.jsonl');fs.writeFileSync(file,bytes);
  writerProvenance[row.symbol]={wrapper_run_id:sync.wrapper_run_id,snapshot,receipt,proof,checkpoint,rows,segments:{[row.symbol]:{proof:E.save(root,p),bytes:E.reference(file),connection_id:p.connection_id,start_offset:p.start_offset,window:tradeConfig.segmentBinding.window}}};
 }
 const currentFile=path.join(root,'current.json');fs.writeFileSync(currentFile,JSON.stringify(state));
 return {evidenceRoot:runtime,sourceReferences,writerProvenance,currentFile,receivedAt:asOf};
}
module.exports={prepare};
