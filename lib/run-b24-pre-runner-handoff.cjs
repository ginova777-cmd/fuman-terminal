'use strict';
// Isolated lifecycle only. Preserve the original final refresh and whole-round result.
async function run({deadline,clock,refresh,prepare}){
 if(!Number.isFinite(deadline)||typeof clock!=='function')throw Error('EVENT_DEADLINE_REQUIRED');
 const stages=[];
 const stage=async(name,fn)=>{
  if(clock()>=deadline)throw Error('EVENT_HANDOFF_DEADLINE:'+name);
  const value=await fn();
  if(clock()>=deadline)throw Error('EVENT_HANDOFF_DEADLINE:'+name);
  stages.push({name,at:new Date(clock()).toISOString()});return value;
 };
 await stage('ORIGINAL_REFRESH',refresh);
 const jobs=await stage('CURRENT_ROUND_EVIDENCE',prepare);
 return {scope:'TEST_ONLY',stages,jobs,whole_round_acceptance:'NOT_EVALUATED'};
}
module.exports={run};
