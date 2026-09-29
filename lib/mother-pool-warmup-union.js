'use strict';
const {isDeepStrictEqual}=require('node:util');
const {hash}=require('./mother-pool-module-write-set');
const {SOURCE_REGISTRY}=require('./terminal-strategy-morning-handoff');
const distinct=values=>[...new Set(values)].sort();
function evaluate(bridge,date,asOf){
 const failures=[],sources={},flags={};
 const expected=bridge?.previousSourceDate,stamp=Date.parse(bridge?.updatedAt);
 if(bridge?.tradeDate!==date||!/^\d{4}-\d{2}-\d{2}$/.test(expected||'')||expected>=date)failures.push('A03_SOURCE_DATE_UNPROVEN');
 if(!Number.isFinite(stamp)||stamp>Date.parse(asOf))failures.push('A03_SOURCE_TIME_INVALID');
 if(Object.keys(bridge?.groups||{}).some(key=>!Object.hasOwn(SOURCE_REGISTRY,key)))failures.push('A03_UNAPPROVED_SOURCE');
 for(const [key,definition] of Object.entries(SOURCE_REGISTRY)){
  let symbols=[],count=null,runId=null,sourceDate=null,gaps=[];
  if(!definition.producer){gaps.push('SOURCE_ADAPTER_NOT_REGISTERED');}
  else if(key==='scorecard88'){
   const checked=require('./mother-pool-scorecard-source').inspect({payload:bridge?.scorecardSource?.raw_payload,expectedSourceDate:expected,asOf});
   gaps.push(...checked.failed_checks);symbols=checked.symbols;count=checked.source_count;sourceDate=checked.source_trade_date;
   runId=checked.sources;
  }else{
   const group=bridge?.groups?.[key],handoff=group?.handoff;
   runId=group?.runId||null;sourceDate=group?.scanDate||null;
   const receipt=require('./terminal-strategy-morning-handoff').sourceFields(group?.sourceReceipt);
   if(!receipt.complete||receipt.runId!==runId||receipt.sourceDate!==expected||!Number.isFinite(receipt.checkedAt)||receipt.checkedAt>Date.parse(asOf))gaps.push('SOURCE_RECEIPT_INVALID');
   if(group?.status!=='ready'||!runId||sourceDate!==expected||handoff?.handoff_trade_date!==date||handoff?.strategy_source_date!==expected||handoff?.source_run_id!==runId||handoff?.ok!==true||!Array.isArray(handoff?.failed_checks)||handoff.failed_checks.length)gaps.push('SOURCE_HANDOFF_INVALID');
   const checked=require('./mother-pool-strategy-bridge-rows').inspect({run:group?.sourceReceipt,rows:group?.sourceRows,runId,sourceDate});
   gaps.push(...checked.failed_checks);count=checked.expected_count;
   symbols=distinct((Array.isArray(group?.sourceRows)?group.sourceRows:[]).map(row=>String(row.code||row.symbol||'')).filter(s=>/^\d{4}$/.test(s)));
   if(!isDeepStrictEqual(distinct(group?.symbols||[]),symbols))gaps.push('SOURCE_SYMBOL_SET_MISMATCH');
  }
  sources[key]={source_date:sourceDate,run_id:runId,source_count:count,deduplicated_count:symbols.length,symbols,failed_checks:distinct(gaps)};
  failures.push(...gaps.map(gap=>key+':'+gap));
  if(!gaps.length)for(const symbol of symbols)(flags[symbol]||=[]).push(key);
 }
 return {sources,flags,union: Object.keys(flags).sort(),failed_checks:distinct(failures)};
}
function collect({identity,symbols,bridge,asOf}){
 const source=bridge||null,result=evaluate(source,identity.trade_date,asOf),requested=distinct([...symbols,...result.union]);
 return {...identity,module_id:'A03',created_at:asOf,requested_symbols:requested,source_evidence:{bridge:source,source_summary:result.sources,union_symbols:result.union},rows:requested.map(symbol=>({symbol,status:result.failed_checks.length?'DATA_GAP':'READY',data_gap_reason:result.failed_checks.join('|')||null,source:'terminal-strategy-priority-bridge',source_contract:'preopen_a03_warmup_union_receipt_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,source_hash:hash(source),source_flags:result.flags[symbol]||[],in_warmup_union:result.union.includes(symbol),union_count:result.union.length,dedupe_key:identity.trade_date+':'+symbol,formal_candidate_allowed:false}))};
}
function verify(rows,round){try{
 const plan=round.writer_write_set.plan,expected=collect({identity:round,symbols:plan.requested_symbols,bridge:plan.source_evidence.bridge,asOf:plan.created_at});
 return rows.length===expected.rows.length&&expected.rows.every(e=>e.status==='READY'&&rows.some(row=>row.symbol===e.symbol&&Object.entries(e).every(([key,value])=>isDeepStrictEqual(row[key],value))));
 }catch{return false;}}
module.exports={evaluate,collect,verify};
