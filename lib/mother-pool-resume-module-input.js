'use strict';
const {persistModuleRound}=require('./persist-mother-pool-module-round');
const {verify}=require('./daytrade-module-write-ack');
// The caller holds the Writer lease/lock and passes original checkpoint inputs.
// This resumes one immutable input; it never regenerates source evidence.
async function resumeInput(input,adapter){
 return persistModuleRound(input,{
  savePlan:async document=>{
   // savePlan in persistModuleRound comes before persist; inspection must not
   // create an attempt marker, otherwise an unattempted write looks uncertain.
   await adapter.validatePlan(document);
  },
  persist:async body=>{
   const document=JSON.parse(body.p_document),state=await adapter.readCommitted(document);
   if(!Array.isArray(state.rounds)||!Array.isArray(state.rows))throw Error('RECOVERY_READ_STATE_INVALID');
   if(state.rounds.length||state.rows.length)return verify(document,state.rounds,state.rows);
   if(await adapter.hasAttempt(document))throw Error('RECOVERY_PREVIOUS_ATTEMPT_UNCONFIRMED');
   await adapter.saveAttempt(document);
   try{return await adapter.persist(body);}
   catch(error){
    if(!['AbortError','TimeoutError'].includes(error.name))throw error;
    const after=await adapter.readCommitted(document);
    return verify(document,after.rounds,after.rows);
   }
  },
  saveEvidence:adapter.saveEvidence,
 });
}
module.exports={resumeInput};
