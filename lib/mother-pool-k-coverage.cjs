'use strict';
function validThreshold(value){
 if(!['number','string'].includes(typeof value)||String(value).trim()==='')return null;
 const n=Number(value);return Number.isFinite(n)&&n>0&&n<=1?n:null;
}
function resolveThreshold(envValue,configValue){return validThreshold(envValue)??validThreshold(configValue)??0.90;}
function assess(rows,{tradeDate,checkedAt,intraday,threshold=0.90}){
 threshold=resolveThreshold(threshold);
 const seen=new Set(),results=[],identityErrors=[];const now=Date.parse(checkedAt);
 for(const row of rows){
  const symbol=String(row.symbol||'');if(!symbol||seen.has(symbol)){identityErrors.push('INVALID_OR_DUPLICATE_SYMBOL');continue;}seen.add(symbol);
  const p=row.payload||{},gap=p.motherPoolMetrics?.dataGap||{},time=gap.last_candle_time||p.last_candle_time||'',stamp=Date.parse(time);
  const date=Number.isFinite(stamp)?new Date(stamp+28800000).toISOString().slice(0,10):null;
  const reasons=[];
  if(intraday){
   if(p.mother_pool_k_quality_ready!==true)reasons.push(p.data_gap_reason&&p.data_gap_reason!=='OK'?p.data_gap_reason:'K_QUALITY_OR_WINDOW_INCOMPLETE');
   if(date!==tradeDate)reasons.push('K_DATE_MISMATCH_OR_MISSING');
   if(!Number.isFinite(now)||!Number.isFinite(stamp)||stamp+60000>now)reasons.push('COMPLETED_K_NOT_CONFIRMED');
  }
  results.push({symbol,status:!intraday?'NOT_DUE':reasons.length?'DATA_GAP':'READY',reasons,latest_candle_time:time||null,candle_count:p.candle_count??null});
 }
 const requested=seen.size,valid=results.filter(r=>r.status==='READY').length,required=Math.ceil(requested*threshold);
 const pass=intraday&&requested>0&&!identityErrors.length&&valid>=required;
 return {contract:'mother-pool-k-coverage-v1',trade_date:tradeDate,checked_at:checkedAt,scope:'published_mother_pool_fixed_members',threshold,requested_count:requested,required_count:required,valid_count:valid,coverage:requested?valid/requested:null,
  status:!intraday?'NOT_DUE':pass?'PASS':'BLOCKED',passed:pass,identity_errors:identityErrors,
  eligible_symbols:results.filter(r=>r.status==='READY').map(r=>r.symbol),missing_symbols:results.filter(r=>r.status==='DATA_GAP').map(r=>r.symbol),rows:results,
  other_gates_unchanged:true,individual_missing_symbols_blocked:true};
}
module.exports={assess,resolveThreshold};
