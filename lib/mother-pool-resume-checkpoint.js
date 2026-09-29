'use strict';
const {inspect}=require('./mother-pool-module-recovery-preflight');
const {resumeInput}=require('./mother-pool-resume-module-input');
// Caller owns the formal Writer lease. Recovery uses only frozen inputs and
// never claims full acceptance from write acknowledgements.
async function resumeCheckpoint(options){
 const {assertLease,guard,adapterFor,saveProgress,loadDeferred}=options;
 await assertLease();
 const original=await inspect(options);
 const progress={mode:'same_batch_module_recovery',identity:original.identity,
  observed_at:original.observed_at,source_ack:original.source_ack,
  written_modules:[],deferred_modules:original.deferred_modules,
  complete:false,requires_independent_verification:true,first_blocker:null};
 await saveProgress(structuredClone(progress));
 const pending=[...original.inputs,...original.deferred_modules.map(module_id=>({module_id,deferred:true}))];
 for(let input of pending){
  try{
   await assertLease();await guard();
   if(input.deferred){const id=input.module_id;input=loadDeferred?await loadDeferred(id,original.identity):null;if(!input){progress.deferred_gaps={...progress.deferred_gaps,[id]:'ORIGINAL_DEFERRED_PLAN_MISSING'};await saveProgress(structuredClone(progress));continue;}}
   const saved=await resumeInput(input,await adapterFor(input));
   progress.written_modules.push(saved);
   progress.deferred_modules=progress.deferred_modules.filter(id=>id!==input.module_id);
  }catch(error){
   progress.first_blocker={module_id:input?.module_id||'unknown',error:String(error.message||error)};
   await saveProgress(structuredClone(progress));
   return progress;
  }
  await saveProgress(structuredClone(progress));
 }
 return progress;
}
module.exports={resumeCheckpoint};
