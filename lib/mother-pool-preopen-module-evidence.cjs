'use strict';
const {isDeepStrictEqual}=require('node:util');
const history=require('./mother-pool-preopen-history');
const trial=require('./mother-pool-trial-trajectory');
const v=require('./mother-pool-preopen-v11.cjs');
const check=(ok,reason)=>{if(!ok)throw Error(reason)};
const slots=['08:45','08:50','08:55','08:59'];
function historyEvidence(plan){
 check(plan.module_id==='A07'&&plan.rows.length>0,'A07_PLAN_REQUIRED');
 const rows=plan.rows.map(row=>{
  check(row.raw_evidence?.symbol===row.symbol&&row.raw_evidence.tradeDate===plan.trade_date&&row.raw_evidence.asOf===plan.created_at,'A07_RAW_IDENTITY');
  return {symbol:row.symbol,...history.evaluateHistory(row.raw_evidence)};
 });
 return {rows,history_state:rows.every(r=>r.history_state==='HISTORY_READY')?'HISTORY_READY':'DATA_GAP',formal_ready:false};
}
function trialEvidence(plan){
 check(['A13','A17'].includes(plan.module_id)&&plan.rows.length>0,'TRIAL_PLAN_REQUIRED');
 const now=Date.parse(plan.created_at);check(Number.isFinite(now),'TRIAL_TIME_INVALID');
 const local=new Date(now+28800000).toISOString();check(local.slice(0,10)===plan.trade_date,'TRIAL_DATE_INVALID');
 const due=slots.filter(s=>s<=local.slice(11,16));
 const rows=plan.rows.map(row=>{
  const result=trial.evaluate(row.symbol,plan.trade_date,row.raw_trials,row.source_readback,plan.created_at);
  const failures=(result.data_gap_reason||'').split('|').filter(x=>x&&x!=='TRIAL_SLOTS_MISSING');
  // No due slot does not excuse malformed or misidentified data that did arrive.
  if(plan.module_id==='A13'&&(row.raw_trials||[]).some(x=>x?.payload?.trade_date!==plan.trade_date||x.payload.run_id!=='preopen_snapshot_history_v2:'+plan.trade_date.replaceAll('-','')||x.payload.generation_id!==row.symbol+':'+x.payload.observed_at||Date.parse(x.payload.observed_at)!==Date.parse(x.observed_at)))failures.push('TRIAL_RUN_IDENTITY_INVALID');
  const missing=due.filter(s=>result.missing_slots.includes(s));
  return {symbol:row.symbol,due_slots:due,missing_due_slots:missing,failed_checks:failures,
   state:failures.length?'BLOCKED':missing.length?'DATA_GAP':due.length<slots.length?'NOT_DUE':'PASS'};
 });
 return {rows,formal_ready:false};
}
function verify(id,plan,evidence){
 try{return isDeepStrictEqual(evidence,id==='A07'?historyEvidence(plan):trialEvidence(plan))}catch{return false}
}
// Never infer a successful round from exit 0 or an earlier pool-upsert receipt.
function terminalEvidence({identity,startedAt,completedAt,exitCode,status,verifier,refresh}){
 check(exitCode===0&&status==='SUCCESS','WRITER_TERMINAL_FAILED');
 check(Number.isFinite(Date.parse(startedAt))&&Date.parse(completedAt)>=Date.parse(startedAt),'TERMINAL_TIME');
 const keys=['trade_date','canonical_run_id','writer_run_id','generation_id','snapshot_generation','snapshot_sequence'];
 for(const evidence of [verifier,refresh]){
  check(evidence?.success===true&&keys.every(k=>identity[k]!==undefined&&identity[k]===evidence.identity?.[k]),'TERMINAL_IDENTITY_OR_PROOF');
  check(Date.parse(evidence.completed_at)>=Date.parse(startedAt)&&Date.parse(evidence.completed_at)<=Date.parse(completedAt),'TERMINAL_STALE_PROOF');
  check(evidence.hash===v.hash(evidence.payload),'TERMINAL_HASH');
 }
 const payload={status,started_at:startedAt,completed_at:completedAt,verifier_hash:verifier.hash,refresh_hash:refresh.hash};
 return {success:true,identity,completed_at:completedAt,payload,hash:v.hash(payload)};
}
module.exports={historyEvidence,trialEvidence,verify,terminalEvidence};
