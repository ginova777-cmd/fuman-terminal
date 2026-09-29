'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const keys=['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'];
function dependencies(id){
 if(!['A14','A19'].includes(id))throw Error('PREOPEN_CLOSURE_MODULE_INVALID');
 return Array.from({length:id==='A14'?13:18},(_,i)=>'A'+String(i+1).padStart(2,'0')).filter(x=>x!=='A10');
}
function inspect({moduleId,identity,references,asOf,runtime}){
 const dir=path.resolve(runtime,'data','scan-receipts','modules')+path.sep,checks={};
 for(const id of dependencies(moduleId)){
  try{
   const ref=references?.[id],file=path.resolve(ref?.file||'');
   if(!file.toLowerCase().startsWith(dir.toLowerCase())||!/^[a-f0-9]{64}$/.test(ref?.sha256||''))throw Error('PARENT_REFERENCE_INVALID');
   const bytes=fs.readFileSync(file);
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('PARENT_HASH_MISMATCH');
   const round=JSON.parse(bytes);
   if(round.module_id!==id||keys.some(k=>round[k]!==identity[k]))throw Error('PARENT_IDENTITY_MISMATCH');
   if(!Number.isFinite(Date.parse(round.captured_at))||Date.parse(round.captured_at)>Date.parse(asOf))throw Error('PARENT_TIME_INVALID');
   if(!require('./verify-mother-pool-module-round').createVerifier(id).validRound(round))throw Error('PARENT_VERIFIER_FAILED');
   checks[id]={status:'READY',sha256:ref.sha256,requested:round.requested,written:round.written,readback:round.readback};
  }catch(error){checks[id]={status:'DATA_GAP',reason:error.message};}
 }
 return checks;
}
function collect({moduleId,identity,symbols,references,asOf,runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime'}){
 if(!Number.isFinite(Date.parse(asOf))||!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error('PREOPEN_CLOSURE_SCOPE_INVALID');
 const checks=inspect({moduleId,identity,references,asOf,runtime}),failed=Object.keys(checks).filter(k=>checks[k].status!=='READY');
 return {...identity,module_id:moduleId,created_at:asOf,requested_symbols:[...symbols],source_evidence:{references:references||{}},rows:symbols.map(symbol=>({symbol,status:failed.length?'DATA_GAP':'READY',data_gap_reason:failed.length?failed.map(id=>id+':'+checks[id].reason).join('|'):null,dependencies:checks,source:'MotherPool.fixed_module_db_anon_readbacks',source_contract:'preopen_closure_fixed_readbacks_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,formal_candidate_allowed:false,publish_allowed:false}))};
}
function verify(rows,round){try{
 const plan=round.writer_write_set.plan,expected=collect({moduleId:round.module_id,identity:round,symbols:plan.requested_symbols,references:plan.source_evidence?.references,asOf:round.observed_at});
 return rows.length===expected.rows.length&&new Set(rows.map(r=>r.symbol)).size===rows.length&&expected.rows.every(e=>e.status==='READY'&&Object.entries(e).every(([k,v])=>isDeepStrictEqual(rows.find(r=>r.symbol===e.symbol)?.[k],v)));
}catch{return false;}}
module.exports={dependencies,inspect,collect,verify};
