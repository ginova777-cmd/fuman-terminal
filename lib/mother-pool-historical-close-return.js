'use strict';
const {datesFromCalendar}=require('./mother-pool-daily-volume-baseline');
function evaluate({symbol,tradeDate,evidence}) {
 let dates=[];const failed=[];
 try{dates=datesFromCalendar(evidence?.calendar,tradeDate,15);}catch{failed.push('FIFTEEN_COMPLETED_SESSIONS_REQUIRED');}
 if(evidence?.symbol!==symbol||evidence?.trade_date!==tradeDate||evidence?.source!=='strategy4_daily_ohlcv_view')failed.push('HISTORY_IDENTITY_INVALID');
 const rows=Array.isArray(evidence?.rows)?evidence.rows:[],days=[];
 for(let n=5;n<dates.length;n++) {
  const date=dates[n],previousDate=dates[n-1],issues=[];
  const select=d=>{const found=rows.filter(r=>r.symbol===symbol&&r.trade_date===d);if(found.length!==1){issues.push('MISSING_OR_DUPLICATE:'+d);return null;}const r=found[0];if(typeof r.close!=='number'||!Number.isFinite(r.close)||r.close<=0||['synthetic','is_synthetic','replay','look_ahead'].some(k=>r[k]===true)){issues.push('INVALID_CLOSE:'+d);return null;}return r.close;};
  const close=select(date),previousClose=select(previousDate),pct=issues.length?null:(close/previousClose-1)*100;
  days.push({source_date:date,previous_completed_date:previousDate,close,previous_close:previousClose,return_pct:pct,return_7pct_flag:pct===null?null:close>=previousClose*1.07,status:issues.length?'DATA_GAP':'READY',failed_checks:issues});
 }
 if(days.length!==10||days.some(d=>d.status!=='READY'))failed.push('TEN_DAY_CLOSE_RETURN_INCOMPLETE');
 return {contract:'mother_pool_historical_close_return_v1',symbol,trade_date:tradeDate,formula:'(close / previous_completed_close - 1) * 100',days,matched_dates:days.filter(d=>d.return_7pct_flag===true).map(d=>d.source_date),status:failed.length?'DATA_GAP':'READY',failed_checks:failed};
}
module.exports={evaluate};
