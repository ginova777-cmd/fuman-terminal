'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const keys=['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'];
function dependencies(id){
 if(!['A14','A19'].includes(id))throw Error('PREOPEN_CLOSURE_MODULE_INVALID');
 return Array.from({length:id==='A14'?13:18},(_,i)=>'A'+String(i+1).padStart(2,'0')).filter(x=>x!=='A10');
}
function inspect({moduleId,identity,symbols,references,asOf,runtime,stageInputCheckpoint}){
 const dir=path.resolve(runtime,'data','scan-receipts','modules')+path.sep,checks={};
 for(const id of dependencies(moduleId)){
  try{
   if(id==='A13'&&moduleId==='A14'&&new Date(Date.parse(asOf)+28800000).toISOString().slice(11,16)<'08:59'){
    const checkpointRoot=path.resolve(runtime,'data','module-input-checkpoints',identity.trade_date)+path.sep;
    if(!path.resolve(stageInputCheckpoint?.file||'').toLowerCase().startsWith(checkpointRoot.toLowerCase()))throw Error('STAGE_CHECKPOINT_REQUIRED');
    const document=require('./mother-pool-module-input-checkpoint').load(stageInputCheckpoint,identity);
    const plan=document.inputs.find(p=>p.module_id==='A13');
    if(!plan||Date.parse(plan.created_at)>Date.parse(asOf)||plan.requested_symbols.length!==symbols.length||!symbols.every(s=>plan.requested_symbols.includes(s)))throw Error('STAGE_TRIAL_SCOPE');
    if(plan.rows.length!==symbols.length||new Set(plan.rows.map(r=>r.symbol)).size!==symbols.length)throw Error('STAGE_TRIAL_SCOPE');
    for(const row of plan.rows){
     if(!symbols.includes(row.symbol))throw Error('STAGE_TRIAL_SCOPE');
     const rebuilt=require('./mother-pool-natural-trial').collect({identity,symbols:[row.symbol],history:{rows:row.raw_trials,readback:row.source_readback},asOf});
     const due=rebuilt.rows[0].due_evidence;
     if(due.state!=='NOT_DUE'||due.failed_checks.length||due.missing_due_slots.length)throw Error('STAGE_TRIAL_SOURCE_INVALID');
    }
    checks[id]={status:'READY',scope:'DUE_SLOTS_ONLY',final_complete:false,checkpoint_sha256:stageInputCheckpoint.content_sha256};continue;
   }
   const ref=references?.[id],file=path.resolve(ref?.file||'');
   if(!file.toLowerCase().startsWith(dir.toLowerCase())||!/^[a-f0-9]{64}$/.test(ref?.sha256||''))throw Error('PARENT_REFERENCE_INVALID');
   const bytes=fs.readFileSync(file);
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('PARENT_HASH_MISMATCH');
   const round=require('./daytrade-shared-evidence.cjs').read(file,runtime);
   if(round.module_id!==id||keys.some(k=>round[k]!==identity[k]))throw Error('PARENT_IDENTITY_MISMATCH');
   if(!Number.isFinite(Date.parse(round.captured_at))||Date.parse(round.captured_at)>Date.parse(asOf))throw Error('PARENT_TIME_INVALID');
   if(!require('./verify-mother-pool-module-round').createVerifier(id).validRound(round))throw Error('PARENT_VERIFIER_FAILED');
   const observed=Date.parse(round.observed_at),committed=Date.parse(round.writer_write_set.ack.committed_at);
   // observed_at is the producer plan time; capture happens after the committed readback.
   if(!Number.isFinite(committed)||observed>committed||committed>Date.parse(round.captured_at))throw Error('PARENT_TIME_INVALID');
   const requested=round.writer_write_set.plan.requested_symbols;
   if(!Array.isArray(symbols)||requested.length!==symbols.length||!symbols.every(s=>requested.includes(s)))throw Error('PARENT_SYMBOL_SET_MISMATCH');
   checks[id]={status:'READY',sha256:ref.sha256,requested:round.requested,written:round.written,readback:round.readback};
  }catch(error){checks[id]={status:'DATA_GAP',reason:error.message};}
 }
 return checks;
}
function collect({moduleId,identity,symbols,references,asOf,stageInputCheckpoint,runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime'}){
 if(!Number.isFinite(Date.parse(asOf))||!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error('PREOPEN_CLOSURE_SCOPE_INVALID');
 const checks=inspect({moduleId,identity,symbols,references,asOf,runtime,stageInputCheckpoint}),failed=Object.keys(checks).filter(k=>checks[k].status!=='READY');
 const stageOnly=moduleId==='A14'&&new Date(Date.parse(asOf)+28800000).toISOString().slice(11,16)<'08:59';
 return {...identity,module_id:moduleId,created_at:asOf,requested_symbols:[...symbols],source_evidence:{references:references||{},...(stageOnly?{stage_input_checkpoint:stageInputCheckpoint||null}:{})},rows:symbols.map(symbol=>({symbol,status:failed.length?'DATA_GAP':stageOnly?'NOT_DUE':'READY',...(stageOnly?{readiness_scope:'PREOPEN_STAGE_ONLY',final_complete:false}:{}),data_gap_reason:failed.length?failed.map(id=>id+':'+checks[id].reason).join('|'):null,dependencies:checks,source:'MotherPool.fixed_module_db_anon_readbacks',source_contract:'preopen_closure_fixed_readbacks_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,formal_candidate_allowed:false,publish_allowed:false}))};
}
function verify(rows,round){try{
 const plan=round.writer_write_set.plan,expected=collect({moduleId:round.module_id,identity:round,symbols:plan.requested_symbols,references:plan.source_evidence?.references,asOf:round.observed_at});
 return rows.length===expected.rows.length&&new Set(rows.map(r=>r.symbol)).size===rows.length&&expected.rows.every(e=>e.status==='READY'&&Object.entries(e).every(([k,v])=>isDeepStrictEqual(rows.find(r=>r.symbol===e.symbol)?.[k],v)));
}catch{return false;}}
module.exports={dependencies,inspect,collect,verify};
