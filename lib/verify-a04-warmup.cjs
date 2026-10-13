'use strict';
const {isDeepStrictEqual}=require('node:util');
const {inspect}=require('./a04-source-evidence.cjs');
const DECISION='MP-A04-OWNER-DECISION-20261013';
// Independent arithmetic: no producer evaluator or producer decision builder import.
function recompute(row,identity,asOf,trustedBinding){
 const raw=row.raw_daily_evidence,source=inspect({symbol:row.symbol,tradeDate:identity.trade_date,raw,proof:row.raw_source_evidence,readAt:row.history_read_at,asOf},trustedBinding);
 const rows=Array.isArray(raw?.rows)?raw.rows:[],dates=source.dates;
 const volumeDays=[],priceDays=[];
 for(let i=5;i<dates.length;i++){
  const d=dates[i],baseline=dates.slice(i-5,i),select=day=>{const a=rows.filter(r=>r.symbol===row.symbol&&r.trade_date===day);return a.length===1?a[0]:null;};
  const current=select(d),prior=select(dates[i-1]),samples=[...baseline,d].map(select);
  const natural=r=>r&&!['synthetic','is_synthetic','replay','look_ahead'].some(k=>r[k]===true);
  const volumeOk=raw.volume_unit==='LOTS'&&samples.every(r=>natural(r)&&typeof r.volume_lots==='number'&&Number.isFinite(r.volume_lots)&&r.volume_lots>=0);
  const avg=volumeOk?samples.slice(0,5).reduce((n,r)=>n+r.volume_lots,0)/5:null;
  const goodVolume=volumeOk&&avg>0,ratio=goodVolume?current.volume_lots/avg:null;
  const goodPrice=[current,prior].every(r=>natural(r)&&typeof r.close==='number'&&Number.isFinite(r.close)&&r.close>0);
  volumeDays.push({date:d,ok:goodVolume,ratio,avg,baseline,volume:current?.volume_lots});
  priceDays.push({date:d,ok:goodPrice,pct:goodPrice?(current.close/prior.close-1)*100:null,hit:goodPrice?current.close>=prior.close*1.07:null,previous:dates[i-1],close:current?.close,previousClose:prior?.close});
 }
 const volumeOk=source.ok&&volumeDays.length===10&&volumeDays.every(d=>d.ok);
 const priceOk=source.ok&&priceDays.length===10&&priceDays.every(d=>d.ok);
 const conditions={
  volume_2x:{state:volumeOk?'VERIFIED':'DATA_GAP',matched_dates:volumeOk?volumeDays.filter(d=>d.ratio>=2).map(d=>d.date):[]},
  volume_2_5x:{state:volumeOk?'VERIFIED':'DATA_GAP',matched_dates:volumeOk?volumeDays.filter(d=>d.ratio>=2.5).map(d=>d.date):[]},
  close_return_7pct:{state:priceOk?'VERIFIED':'DATA_GAP',matched_dates:priceOk?priceDays.filter(d=>d.hit).map(d=>d.date):[]},
  limit_up:{state:'UNKNOWN',matched_dates:[],reason:'HISTORICAL_PRICE_RULE_CONTRACT_REQUIRED'},
  near_limit_up:{state:'UNKNOWN',matched_dates:[],reason:'HISTORICAL_PRICE_RULE_CONTRACT_REQUIRED',max_legal_ticks:2},
 };
 const hits=Object.entries(conditions).flatMap(([condition,c])=>c.state==='VERIFIED'?c.matched_dates.map(trade_date=>({condition,trade_date})):[]);
 const expected={owner_decision:DECISION,conditions,hits,warmup_eligible:hits.length>0,
  warmup_state:hits.length?'WARMUP_ELIGIBLE':Object.values(conditions).some(c=>c.state==='DATA_GAP')?'DATA_GAP':'NO_VERIFIED_HIT',
  module_complete:false,complete:false,formal_candidate_allowed:false,publish_allowed:false,
  source_hash:source.source_hash,source_proof_hash:source.proof_hash,binding_sha256:source.binding_sha256};
 const failures=[...source.failed_checks];
 if(!isDeepStrictEqual(row.a04_warmup,expected))failures.push('A04_WARMUP_RECOMPUTE_MISMATCH');
 if(row.source!=='strategy4_daily_ohlcv_view'||row.source_contract!=='preopen_a04_volume_price_receipt_v1'||row.event_time!==asOf
  ||row.status!=='DATA_GAP'||row.complete===true||row.module_complete===true||row.formal_candidate_allowed!==false||row.publish_allowed!==false
  ||row.price_evidence?.limit_up!==null||row.price_evidence?.near_limit_up!==null
  ||row.is_synthetic!==false||row.replay!==false||row.look_ahead!==false)failures.push('A04_SCOPE_OR_IDENTITY_INVALID');
 // Check producer's per-day numbers as well as the independently rebuilt OR decision.
 if(volumeOk){const ps=row.volume_evidence?.days;if(!Array.isArray(ps)||ps.length!==10)failures.push('A04_VOLUME_DAY_SET');for(const d of volumeDays){const a=ps?.filter(x=>x.source_date===d.date)||[],p=a[0];if(a.length!==1||!p||p.status!=='READY'||p.volume_lots!==d.volume||p.volume_ratio!==d.ratio||p.avg_volume5!==d.avg||!isDeepStrictEqual(p.baseline_dates,d.baseline)||p.volume_2x_flag!==(d.ratio>=2)||p.volume_2_5x_flag!==(d.ratio>=2.5))failures.push('A04_VOLUME_FORMULA_MISMATCH');}}
 if(priceOk){const ps=row.price_evidence?.close_return?.days;if(!Array.isArray(ps)||ps.length!==10)failures.push('A04_CLOSE_DAY_SET');for(const d of priceDays){const a=ps?.filter(x=>x.source_date===d.date)||[],p=a[0];if(a.length!==1||!p||p.status!=='READY'||p.close!==d.close||p.previous_close!==d.previousClose||p.return_pct!==d.pct||p.previous_completed_date!==d.previous||p.return_7pct_flag!==d.hit)failures.push('A04_CLOSE_FORMULA_MISMATCH');}}
 return {valid:failures.length===0,warmup_eligible:failures.length===0&&hits.length>0,module_complete:false,complete:false,failed_checks:[...new Set(failures)],expected};
}
function verifyRow(row,identity,asOf,trustedBinding){
 try{return recompute(row,identity,asOf,trustedBinding);}catch{return {valid:false,warmup_eligible:false,module_complete:false,complete:false,failed_checks:['A04_RECOMPUTE_INVALID'],expected:{warmup_state:'DATA_GAP'}};}
}
function select(plan,{identity,asOf,trustedBinding}={}){
 const failed=[],check=(ok,code)=>{if(!ok)failed.push(code);};
 const keys=['trade_date','canonical_run_id','writer_run_id','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence'];
 check(plan?.module_id==='A04'&&identity?.trade_date&&keys.every(k=>identity[k]!=null&&plan[k]===identity[k])&&plan.created_at===asOf,'A04_PLAN_IDENTITY');
 const rows=Array.isArray(plan?.rows)?plan.rows:[],requested=plan?.requested_symbols;
 check(Array.isArray(requested)&&requested.length===rows.length&&new Set(requested).size===requested.length
  &&requested.every(s=>/^\d{4}$/.test(s)&&rows.filter(r=>r?.symbol===s).length===1),'A04_PLAN_SET');
 if(failed.length)return {symbols:[],candidates:[],failed_checks:failed,module_complete:false,complete:false};
 const verified=rows.map(row=>({row,result:verifyRow(row,identity,asOf,trustedBinding)}));
 return {owner_decision:DECISION,symbols:verified.filter(x=>x.result.warmup_eligible).map(x=>x.row.symbol),
  candidates:verified.filter(x=>x.result.warmup_eligible).map(x=>({symbol:x.row.symbol,hits:x.result.expected.hits,source_hash:x.result.expected.source_hash,source_proof_hash:x.result.expected.source_proof_hash,scope:'WARMUP_ONLY',formal_candidate_allowed:false,publish_allowed:false})),
  rejected:verified.filter(x=>!x.result.warmup_eligible).map(x=>({symbol:x.row.symbol,failed_checks:x.result.failed_checks,state:x.result.expected.warmup_state})),
  failed_checks:[],module_complete:false,complete:false};
}
// Full-module validation remains unavailable until the missing price contract exists.
function moduleComplete(){return false;}
module.exports={recompute:verifyRow,select,moduleComplete};
