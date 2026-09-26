"use strict";
const STAGES=['us_0820','asia_0850'];
function readiness(date, evidence, isAlive=()=>true) {
  const rows=STAGES.map(stage=>{
    const {final,wrapper}=evidence[stage]||{};
    if(!wrapper)return {stage,status:'waiting',reason:'wrapper_missing'};
    if(wrapper.trade_date!==date)return {stage,status:'blocked',reason:'wrapper_date_mismatch'};
    if(wrapper.status==='running')return wrapper.process_id&&!isAlive(wrapper.process_id)?{stage,status:'blocked',reason:'stage_process_missing'}:{stage,status:'waiting',reason:'stage_running'};
    if(wrapper.status==='skipped')return {stage,status:'skipped',reason:wrapper.reason_code};
    if(wrapper.complete!==true||wrapper.exitCode!==0)return {stage,status:'blocked',reason:wrapper.first_blocker||wrapper.reason_code||'wrapper_incomplete'};
    if(!final||final.date!==date||final.stage!==stage||!final.run_id||final.run_id!==wrapper.run_id||final.complete!==true||final.exitCode!==0)return {stage,status:'blocked',reason:'final_identity_or_completion_mismatch'};
    return {stage,status:'ready',run_id:final.run_id};
  });
  const ready=rows.every(r=>r.status==='ready');
  return {ready,status:ready?'ready':rows.some(r=>r.status==='blocked')?'blocked':rows.every(r=>r.status==='skipped')?'skipped':'waiting',stages:rows};
}
module.exports={readiness};
