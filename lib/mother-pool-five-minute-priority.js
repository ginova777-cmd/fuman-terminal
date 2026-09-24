'use strict';
const {collect:technical}=require('./mother-pool-five-minute-producer');
const {verify:verifyTechnical}=require('./verify-mother-pool-five-minute');
const CONTRACT='preopen_a10_five_minute_priority_receipt_v1';
function collect(input){
 const plan=technical(input);
 // This order is a warmup recommendation only. It never admits candidates.
 const ordered=[...plan.rows].sort((a,b)=>Number(b.bonus_eligible)-Number(a.bonus_eligible)||plan.requested_symbols.indexOf(a.symbol)-plan.requested_symbols.indexOf(b.symbol));
 return {...plan,module_id:'A10',rows:plan.rows.map(row=>({...row,source_contract:CONTRACT,
  warmup_rank:ordered.findIndex(x=>x.symbol===row.symbol)+1,priority_only:true,publish_allowed:false,
  priority_reason:row.status==='READY'?row.quality_status:'DATA_GAP_5M'}))};
}
function verify(rows,r){try{
 const plan=r.writer_write_set.plan,symbols=plan.requested_symbols,snapshot=plan.source_evidence.snapshot;
 if(!require('./daytrade-mother-pool-snapshot').inspectSnapshot(snapshot,r.trade_date).ok||symbols.length!==snapshot.symbols.length||symbols.some(s=>!snapshot.symbols.includes(s))||rows.length!==symbols.length||new Set(rows.map(x=>x.symbol)).size!==symbols.length||rows.some(x=>!symbols.includes(x.symbol)))return false;
 if(snapshot.canonical_run_id!==r.canonical_run_id||Date.parse(snapshot.effective_at)>Date.parse(r.observed_at))return false;
 for(const row of rows){
  if(row.source_contract!==CONTRACT||row.source!=='fugle_stock_intraday_candles_timeframe_5'||row.source_updated_at!==plan.source_evidence.receipt.verified_at||row.event_time!==row.bar_end||row.is_synthetic!==false||row.replay!==false||row.look_ahead!==false||row.priority_only!==true||row.publish_allowed!==false||row.formal_candidate_allowed!==false||row.data_gap_reason!==null||row.priority_reason!==row.quality_status||!verifyTechnical(row,r))return false;
 }
 const ordered=[...rows].sort((a,b)=>Number(b.bonus_eligible)-Number(a.bonus_eligible)||symbols.indexOf(a.symbol)-symbols.indexOf(b.symbol));
 return ordered.every((x,i)=>x.warmup_rank===i+1);
}catch{return false;}}
function apply(pool,input,now=Date.now()){
 const legacy=require('./daytrade-five-minute-priority');
 const inspected=require('./daytrade-mother-pool-snapshot').inspectSnapshot(input.snapshot,input.identity.trade_date);
 const blocked=reason=>{const result=legacy.applyFiveMinutePriority(pool,[],null,inspected,now);result.fiveMinutePriorityEvidence.first_blocker=reason;return result;};
 try{
  const plan=collect(input),round={...input.identity,observed_at:input.asOf,writer_write_set:{plan}};
  if(Date.parse(input.asOf)!==now||!verify(plan.rows,round))return blocked('five_minute_independent_formula_rejected');
  const result=legacy.applyFiveMinutePriority(pool,plan.rows.map(r=>r.source_history.at(-1)),input.receipt,inspected,now);
  result.fiveMinutePriorityEvidence.a10_formula_verified=result.fiveMinutePriorityEvidence.status==='evaluated';
  result.fiveMinutePriorityEvidence.source_history_rows=input.history.length;
  result.fiveMinutePriorityEvidence.source_history_hash=require('./mother-pool-module-write-set').hash(input.history);
  result.fiveMinutePriorityEvidence.priority_contract=CONTRACT;
  return result;
 }catch{return blocked('five_minute_independent_source_invalid');}
}
module.exports={collect,verify,apply,CONTRACT};
