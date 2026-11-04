'use strict';
const {datesFromCalendar}=require('./mother-pool-daily-volume-baseline');
const dateOf=t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+28800000).toISOString().slice(0,10):null;
function evaluate(symbol,tradeDate,evidence,readAt,asOf){
 const failed=[];let sourceDate=null;
 try{sourceDate=datesFromCalendar(evidence?.calendar,tradeDate,1).at(-1);}catch{failed.push('PREVIOUS_SESSION_UNPROVEN');}
 if(evidence?.symbol!==symbol||evidence?.trade_date!==tradeDate||evidence?.source!=='strategy4_daily_ohlcv_view'||evidence?.volume_unit!=='LOTS')failed.push('VOLUME_SOURCE_IDENTITY_OR_UNIT');
 if(dateOf(readAt)!==tradeDate||!Number.isFinite(Date.parse(asOf))||Date.parse(readAt)>Date.parse(asOf))failed.push('VOLUME_READ_TIME_INVALID');
 const rows=(Array.isArray(evidence?.rows)?evidence.rows:[]).filter(r=>r.symbol===symbol&&r.trade_date===sourceDate),r=rows[0];
 if(rows.length!==1)failed.push('VOLUME_MISSING_OR_DUPLICATE');
 if(!r||typeof r.volume_lots!=='number'||!Number.isFinite(r.volume_lots)||r.volume_lots<0||r.synthetic===true||r.is_synthetic===true||r.replay===true||r.look_ahead===true)failed.push('VOLUME_INVALID');
 return {symbol,source_date:sourceDate,threshold_lots:2000,volume_lots:failed.length?null:r.volume_lots,status:failed.length?'UNKNOWN':r.volume_lots<2000?'EXCLUDED_LOW_VOLUME':'ELIGIBLE',failed_checks:failed};
}
function select({symbols,tradeDate,dailyVolumeMap,asOf}){
 const evidence=symbols.map(symbol=>{const v=dailyVolumeMap.get(symbol);return {...evaluate(symbol,tradeDate,v?.daily_volume_evidence,v?.daily_ohlcv_read_at,asOf),raw_daily_evidence:v?.daily_volume_evidence||null,read_at:v?.daily_ohlcv_read_at||null};});
 return {contract:'preopen_previous_session_2000_lots_v1',trade_date:tradeDate,observed_at:asOf,input_symbols:[...symbols],requested_symbols:evidence.filter(r=>r.status!=='EXCLUDED_LOW_VOLUME').map(r=>r.symbol),excluded_symbols:evidence.filter(r=>r.status==='EXCLUDED_LOW_VOLUME').map(r=>r.symbol),unknown_symbols:evidence.filter(r=>r.status==='UNKNOWN').map(r=>r.symbol),evidence};
}
module.exports={evaluate,select};
