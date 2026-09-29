'use strict';
const {createHash}=require('node:crypto');
const KEYS=['strategy2','strategy3','strategy4','strategy5','institution'];
const clean=v=>typeof v==='string'?v.trim():'';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function bind(task,payload,row,sourceDate,symbol=String(row.code||row.symbol||row.ticker||'')){
 const evidence={strategy_key:task.key,symbol,payload_run_id:clean(payload.runId||payload.run_id||payload.transport?.runId),row_run_id:clean(row.runId||row.run_id),source_trade_date:sourceDate};
 const gaps=[];
 if(!KEYS.includes(task.key))gaps.push('SOURCE_STRATEGY_NOT_ALLOWED');
 if(!evidence.payload_run_id)gaps.push('SOURCE_RUN_MISSING');
 if(evidence.row_run_id&&evidence.row_run_id!==evidence.payload_run_id)gaps.push('SOURCE_RUN_MISMATCH');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))gaps.push('SOURCE_DATE_MISSING');
 if(!/^\d{4}$/.test(symbol))gaps.push('SOURCE_SYMBOL_INVALID');
 return {source_binding_contract:'scorecard_source_binding_v1',source_binding_status:gaps.length?'DATA_GAP':'BOUND',source_binding_gaps:gaps,
  source_strategy_key:task.key,source_run_id:evidence.payload_run_id||null,source_trade_date:sourceDate,
  source_binding_evidence:evidence,source_binding_hash:digest(evidence)};
}
function inspect({payload,expectedSourceDate,asOf}){
 const failed=[],rows=[],reports=Array.isArray(payload?.sourceReports)?payload.sourceReports:[],records=Array.isArray(payload?.records)?payload.records:[];
 if(payload?.contract!=='scorecard88-terminal-canonical-collector-v1'||payload.ok!==true||payload.latestDate!==expectedSourceDate)failed.push('SCORECARD_SNAPSHOT_NOT_READY');
 const stamp=Date.parse(payload?.updatedAt),now=Date.parse(asOf);
 if(!Number.isFinite(stamp)||!Number.isFinite(now)||stamp>now)failed.push('SCORECARD_SOURCE_TIME_INVALID');
 const evidence=[];
 for(const key of KEYS){
  const matches=reports.filter(r=>r.key===key),report=matches[0];
  if(matches.length!==1||report?.ok!==true||report.complete!==true||report.status!=='PASS'||!report.runId||report.tradeDate!==expectedSourceDate||report.desktopStatus!=='PASS'||report.mobileStatus!=='PASS'||report.desktopRunId!==report.runId||report.mobileRunId!==report.runId||report.fallbackUsed===true||report.firstBlocker||report.blocking_reason)failed.push(key+':SOURCE_REPORT_NOT_COMPLETE');
  const selected=records.filter(r=>r.source_strategy_key===key&&r.source_trade_date===expectedSourceDate);
  const count=report?.resultCount??report?.count;
  if(!Number.isInteger(count)||count<0||count!==selected.length)failed.push(key+':SOURCE_RECORD_COUNT_MISMATCH');
  for(const record of selected){
   const e=record.source_binding_evidence;
   if(record.source_binding_contract!=='scorecard_source_binding_v1'||record.source_binding_status!=='BOUND'||!Array.isArray(record.source_binding_gaps)||record.source_binding_gaps.length||!e||e.strategy_key!==key||e.symbol!==record.ticker||e.source_trade_date!==expectedSourceDate||e.payload_run_id!==report?.runId||(e.row_run_id&&e.row_run_id!==e.payload_run_id)||record.source_run_id!==report?.runId||record.source_binding_hash!==digest(e)||record.record_date!==expectedSourceDate||!/^\d{4}$/.test(String(record.ticker)))failed.push(key+':SOURCE_RECORD_BINDING_INVALID');
   rows.push(record);
  }
  evidence.push({strategy_key:key,source_run_id:report?.runId||null,expected_count:count??null,readback_count:selected.length});
 }
 // Old rows are not retroactively assigned today's run by position or ticker.
 if(records.some(r=>r.record_date===expectedSourceDate&&KEYS.includes(String(r.rule_key||'').split(':')[0])&&!r.source_binding_contract))failed.push('UNBOUND_SOURCE_RECORDS');
 const failures=[...new Set(failed)];
 return {contract:'mother_pool_scorecard_warmup_source_v1',status:failures.length?'BLOCKED':'READY',source_trade_date:expectedSourceDate,
  source_updated_at:payload?.updatedAt||null,symbols:failures.length?[]:[...new Set(rows.map(r=>r.ticker))].sort(),source_count:rows.length,
  sources:evidence,failed_checks:failures,first_blocker:failures[0]||null,source_hash:digest(payload||null),raw_payload:payload||null};
}
module.exports={KEYS,bind,inspect};
