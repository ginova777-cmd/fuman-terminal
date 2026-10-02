'use strict';
const fs=require('node:fs'),path=require('node:path');
const {verifyMorningStage}=require('./mother-pool-morning-ack');
function readOpeningObservation(runtime,date,minute){
 const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
 const stages=[['us_0820',516],['asia_0850',536]].filter(([,due])=>minute>=due).map(([stage])=>{
  const dir=path.join(runtime,'data','opening-report-stages',stage,'scan-receipts');
  const suffix=date.replace(/-/g,'')+'.json';
  const handoffPath=path.join(dir,'opening-report-0830-mother-pool-handoff-ack-'+suffix);
  const persistencePath=path.join(dir,'opening-report-0830-mother-pool-persistence-ack-'+suffix);
  return {stage,...verifyMorningStage(read(handoffPath),read(persistencePath),date),handoff_path:handoffPath,persistence_path:persistencePath};
 });
 const complete=stages.every(s=>s.complete);
 return {required:stages.length>0,bridgeOk:complete,ackOk:complete,stages,symbols:[...new Set(stages.flatMap(s=>s.symbols))]};
}
// Morning reports can prioritize observation; they never confer membership.
function evaluateOpeningObservation(evidence,writerSymbols,motherSymbols){
 const symbols=[...new Set((evidence?.symbols||[]).map(String))];
 const writer=new Set(writerSymbols||[]),mother=new Set(motherSymbols||[]);
 const missing=symbols.filter(s=>!writer.has(s));
 const due=evidence?.required===true;
 const verified=due&&evidence?.bridgeOk===true&&evidence?.ackOk===true&&missing.length===0;
 const failed=[];
 if(due&&evidence?.bridgeOk!==true)failed.push('opening_report_bridge_not_closed');
 if(due&&evidence?.ackOk!==true)failed.push('opening_report_handoff_ack_not_complete');
 if(due&&missing.length)failed.push('opening_report_ack_symbols_not_in_writer_manifest');
 return {contract:'mother_pool_opening_observation_v1',ok:verified,status:!due?'NOT_DUE':verified?'AVAILABLE':'UNAVAILABLE',required:false,evidence_due:due,affects_core_acceptance:false,
  allowed_action:verified?'apply_priority_observation_only':'disable_opening_observation_weight',
  priority_observation_allowed:verified,formal_candidate_allowed:false,publish_allowed:false,
  stages:evidence?.stages||[],handoff_ack_symbols:symbols.length,handoff_ack_missing_from_writer_manifest:missing,
  observation_symbols:verified?symbols:[],formal_member_symbols:symbols.filter(s=>mother.has(s)),watch_only_symbols:symbols.filter(s=>!mother.has(s)),
  failed_checks:failed,first_blocker:failed[0]||null};
}
module.exports={evaluateOpeningObservation,readOpeningObservation};
