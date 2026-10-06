'use strict';
// Runs inside the existing Writer only. No process, lease or schedule creation.
// All operations are awaited; overdue rounds are never queued for catch-up.
async function runWindow({run,canPublish,prepareRound,deadline,periodMs=15000,maxRounds=20,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onFailure=async()=>{},previousValidUntil=null,operationBudgetMs=60000}){
 if(!Number.isInteger(operationBudgetMs)||operationBudgetMs<60000||operationBudgetMs>90000||typeof run!=='function'||typeof canPublish!=='function'||!Number.isFinite(deadline)||!Number.isInteger(periodMs)||periodMs<1000||periodMs>20000||!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>100)throw Error('CADENCE_CONFIG_INVALID');
 const rounds=[];let until=Date.parse(previousValidUntil),stop='ROUND_LIMIT';
 for(let i=0;i<maxRounds;i++){
  // Capture, quote write and proof readback are bounded separately; reserve a
  // full 60-second operation budget rather than interrupt a live write midway.
  if(deadline-now()<operationBudgetMs){stop='TIME_BUDGET';break;}
  const started=now();let result;
  try{
   if(prepareRound&&await prepareRound()!==true){stop='WRITER_GUARD';break;}
   if(await canPublish()!==true){stop='WRITER_GUARD';break;}
   if(deadline-now()<operationBudgetMs){stop='TIME_BUDGET';break;}
   result=await run();
  }catch(error){await onFailure(error);rounds.push({started_at:new Date(started).toISOString(),status:'FAILED',error_name:error.name||'Error'});stop='PUBLICATION_FAILED';break;}
  const ended=now(),proof=result?.shared_water_acceptance;
  const current=proof?.publication_status==='COMMITTED'&&proof.readback_verified===true&&Date.parse(proof.checked_at)<=ended&&ended<Date.parse(proof.valid_until);
  const gap=Number.isFinite(until)?Math.max(0,ended-until):null;
  rounds.push({started_at:new Date(started).toISOString(),finished_at:new Date(ended).toISOString(),verification_run_id:proof?.verification_run_id||null,publication_current:current,water_gate_pass:current&&proof.water_gate_pass===true,evidence_gap_ms:gap});
  if(!current){stop='PUBLICATION_NOT_CURRENT';break;}
  until=Date.parse(proof.valid_until);
  if(i+1===maxRounds)break;
  const wait=Math.max(0,periodMs-(ended-started));
  if(wait){if(deadline-now()<wait+operationBudgetMs){stop='TIME_BUDGET';break;}await sleep(wait);}
 }
 return {contract:'mother-shared-water-cadence-v1',rounds,stop_reason:stop,continuous_verified:false,natural_acceptance:false};
}
module.exports={runWindow};
