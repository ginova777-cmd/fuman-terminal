'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{isDeepStrictEqual}=require('util');
const {hash}=require('./mother-pool-module-write-set'),stages=require('./opening-report-stage-contract'),{verifyHandoff}=require('./mother-pool-morning-evidence');
const ids=['us_0820','asia_0850'];
function readSource(runtime,date){
 const result={};for(const stage of ids){const dir=path.join(stages.directory(runtime,stage),'scan-receipts'),day=date.replaceAll('-','');const entry={};
  try{entry.handoff=JSON.parse(fs.readFileSync(path.join(dir,`opening-report-0830-mother-pool-handoff-ack-${day}.json`),'utf8'));}catch{entry.handoff=null;}
  try{entry.persistence=JSON.parse(fs.readFileSync(path.join(dir,`opening-report-0830-mother-pool-persistence-ack-${day}.json`),'utf8'));const file=path.resolve(entry.persistence.persistence_readback_receipt||'');if(path.dirname(file)!==path.resolve(dir))throw Error('READBACK_PATH_OUTSIDE_STAGE');entry.readback=JSON.parse(fs.readFileSync(file,'utf8'));}catch{entry.readback=null;}
  entry.refresh_files=[];
  for(const e of Array.isArray(entry.persistence?.writer_refresh_evidence)?entry.persistence.writer_refresh_evidence:[])try{const file=path.resolve(e.evidence_path),root=path.resolve(runtime,'state','opening-report-writer-refreshes',date);if(path.dirname(file)!==root)throw Error('REFRESH_PATH_OUTSIDE_DATE');entry.refresh_files.push({text:fs.readFileSync(file,'utf8'),expected_sha256:e.evidence_sha256});}catch{entry.refresh_files.push({error:'REFRESH_FILE_UNREADABLE'});}
  result[stage]=entry;
 }return result;
}
function evaluate(moduleId,source,date,asOf,symbols){
 const failed=[],reports={};for(const stage of ids){const e=source?.[stage]||{},h=e.handoff,p=e.persistence;
  failed.push(...verifyHandoff(h,{tradeDate:date,stage,asOf}).map(x=>stage+':'+x));
  const accepted=Array.isArray(h?.accepted_symbols)?h.accepted_symbols:[];if(accepted.some(s=>!symbols.includes(s)))failed.push(stage+':HANDOFF_SYMBOL_OUTSIDE_POOL');
  reports[stage]={report_run_id:h?.report_run_id||null,accepted_symbols:accepted,refreshes:[]};
  if(moduleId==='A12'){
   if(p?.contract!=='opening-report-0830-mother-pool-persistence-ack-v1'||p.complete!==true||p.exitCode!==0||p.trade_date!==date||p.report_run_id!==h?.report_run_id||!Number.isFinite(Date.parse(p.checked_at))||Date.parse(p.checked_at)>Date.parse(asOf))failed.push(stage+':PERSISTENCE_RECEIPT_INVALID');
   failed.push(...verifyHandoff(e.readback,{tradeDate:date,stage,asOf:p?.checked_at}).map(x=>stage+':PERSISTENCE_'+x));
   if(e.readback?.report_run_id!==h?.report_run_id||!isDeepStrictEqual([...(e.readback?.accepted_symbols||[])].sort(),[...accepted].sort()))failed.push(stage+':PERSISTENCE_SET_OR_RUN_MISMATCH');
   const writers=new Set(),generations=new Set();
   for(const f of e.refresh_files||[])try{
    if(typeof f.text!=='string'||crypto.createHash('sha256').update(f.text).digest('hex')!==f.expected_sha256)throw Error('HASH');const r=JSON.parse(f.text),t=Date.parse(r.completed_at);
    if(r.contract!=='opening-report-writer-pool-refresh-v1'||r.trade_date!==date||r.operation!=='priority_pool_upsert_and_prune'||r.write_complete!==true||!r.writer_run_id||!r.generation_id||!Number.isFinite(t)||t<=Date.parse(h?.checked_at)||t>Date.parse(e.readback?.checked_at)||!Array.isArray(r.symbols)||new Set(r.symbols).size!==r.symbol_count||r.symbols.length!==r.symbol_count||accepted.some(s=>!r.symbols.includes(s)))throw Error('CONTENT');
    if(!writers.has(r.writer_run_id)&&!generations.has(r.generation_id)){writers.add(r.writer_run_id);generations.add(r.generation_id);reports[stage].refreshes.push({writer_run_id:r.writer_run_id,generation_id:r.generation_id,completed_at:r.completed_at});}
   }catch{failed.push(stage+':REFRESH_EVIDENCE_INVALID');}
   if(writers.size<2)failed.push(stage+':TWO_REFRESHES_REQUIRED');
  }
 }return {failed_checks:[...new Set(failed)],reports};
}
function collect({identity,symbols,asOf,runtime,sourceEvidence}){
 const source=sourceEvidence||readSource(runtime,identity.trade_date),digest=hash(source);
 return ['A11','A12'].map(moduleId=>{const result=evaluate(moduleId,source,identity.trade_date,asOf,symbols);return {...identity,module_id:moduleId,created_at:asOf,requested_symbols:[...symbols],source_evidence:source,rows:symbols.map(symbol=>({symbol,status:result.failed_checks.length?'DATA_GAP':'READY',data_gap_reason:result.failed_checks.join('|')||null,source:'opening-report-stages',source_contract:moduleId==='A11'?'preopen_a11_morning_handoff_receipt_v1':'preopen_a12_morning_persistence_receipt_v1',source_updated_at:asOf,event_time:asOf,source_hash:digest,morning_reports:result.reports,is_synthetic:false,replay:false,look_ahead:false,formal_candidate_allowed:false,publish_allowed:false}))};});
}
function verify(moduleId,rows,round){try{const expected=collect({identity:round,symbols:round.writer_write_set.plan.requested_symbols,asOf:round.observed_at,sourceEvidence:round.writer_write_set.plan.source_evidence}).find(x=>x.module_id===moduleId);return rows.length===expected.rows.length&&expected.rows.every(e=>e.status==='READY'&&rows.some(r=>r.symbol===e.symbol&&Object.entries(e).every(([k,v])=>isDeepStrictEqual(r[k],v))));}catch{return false;}}
module.exports={readSource,evaluate,collect,verify};
