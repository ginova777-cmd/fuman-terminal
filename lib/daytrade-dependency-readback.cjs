'use strict';
const {createVerifier}=require('./verify-mother-pool-module-round');
const {identityFields}=require('./mother-pool-module-write-set');
function verifyParent({moduleId,artifact,identity,asOf,previous=false}){
 if(!artifact||artifact.module_id!==moduleId)throw Error('PARENT_READBACK_MISSING:'+moduleId);
 const time=Date.parse(artifact.observed_at),end=Date.parse(asOf);
 if(!Number.isFinite(time)||!Number.isFinite(end)||time>end||end-time>300000)throw Error('PARENT_READBACK_STALE:'+moduleId);
 if(previous){
  if(artifact.trade_date!==identity.trade_date||artifact.canonical_run_id!==identity.canonical_run_id||artifact.writer_run_id===identity.writer_run_id||time>=end)throw Error('PARENT_PREVIOUS_ROUND_INVALID:'+moduleId);
 }else if(identityFields.some(k=>artifact[k]!==identity[k]))throw Error('PARENT_CURRENT_ROUND_MISMATCH:'+moduleId);
 if(!createVerifier(moduleId).validRound(artifact))throw Error('PARENT_INDEPENDENT_READBACK_FAILED:'+moduleId);
 return artifact.writer_write_set;
}
async function guard({moduleId,identity,asOf,readParent,build}){
 const parents=moduleId==='B04'?[['B02',true]]:moduleId==='B09'?[['B04',false],['B08',false]]:[];
 const verified={};
 for(const [id,previous] of parents)verified[id]=verifyParent({moduleId:id,artifact:await readParent(id,{previous}),identity,asOf,previous});
 return build(verified);
}
module.exports={verifyParent,guard};
