'use strict';
const {datesFromCalendar}=require('./mother-pool-daily-volume-baseline');
function evaluate({symbol,tradeDate,evidence}){
 const gaps=[];let dates=[];
 try{dates=datesFromCalendar(evidence?.calendar,tradeDate,15);}catch{gaps.push('FIFTEEN_COMPLETED_SESSIONS_REQUIRED');}
 if(evidence?.symbol!==symbol||evidence?.trade_date!==tradeDate||evidence?.source!=='strategy4_daily_ohlcv_view'||evidence?.volume_unit!=='LOTS')gaps.push('HISTORY_IDENTITY_INVALID');
 const rows=Array.isArray(evidence?.rows)?evidence.rows:[],days=[];
 for(let index=5;index<dates.length;index++){
  const date=dates[index],baselineDates=dates.slice(index-5,index),needed=[...baselineDates,date],selected=[];const failed=[];
  for(const d of needed){const matches=rows.filter(r=>r.symbol===symbol&&r.trade_date===d);if(matches.length!==1){failed.push('MISSING_OR_DUPLICATE:'+d);continue;}const r=matches[0];if(typeof r.volume_lots!=='number'||!Number.isFinite(r.volume_lots)||r.volume_lots<0||['synthetic','is_synthetic','replay','look_ahead'].some(k=>r[k]===true)){failed.push('INVALID_VOLUME:'+d);continue;}selected.push(r);}
  const denominator=failed.length?null:selected.slice(0,5).reduce((n,r)=>n+r.volume_lots,0)/5;
  if(denominator===0)failed.push('ZERO_BASELINE');
  const volume=selected.find(r=>r.trade_date===date)?.volume_lots??null,ratio=failed.length?null:volume/denominator;
  days.push({source_date:date,baseline_dates:baselineDates,volume_lots:volume,avg_volume5:denominator,volume_ratio:ratio,threshold:2.5,matched:ratio===null?null:ratio>=2.5,status:failed.length?'DATA_GAP':'READY',failed_checks:failed});
 }
 if(days.length!==10||days.some(d=>d.status!=='READY'))gaps.push('TEN_DAY_VOLUME_EVIDENCE_INCOMPLETE');
 return {contract:'mother_pool_recent_ten_day_volume_v1',symbol,trade_date:tradeDate,volume_unit:'LOTS',days,matched_dates:days.filter(d=>d.matched===true).map(d=>d.source_date),status:gaps.length?'DATA_GAP':'READY',failed_checks:gaps};
}
module.exports={evaluate};
