'use strict';
const HISTORY='HISTORICAL_20D_SAME_MINUTE_MEDIAN';
const gap=reason=>({baseline:null,sample_count:0,status:'DATA_GAP',reason});
function select(detail,identity){
 const t=Date.parse(detail?.latest?.timestamp);
 if(!Number.isFinite(t))return {method:null,outside:gap('SIDE_MINUTE_MISSING'),inside:gap('SIDE_MINUTE_MISSING')};
 const stamp=new Date(t+28800000).toISOString(),minute=stamp.slice(11,16);
 if(stamp.slice(0,10)!==identity.trade_date||minute<'09:00'||minute>'13:29')return {method:null,outside:gap('SIDE_MINUTE_OUT_OF_SESSION'),inside:gap('SIDE_MINUTE_OUT_OF_SESSION')};
 if(minute>'09:20')return detail.rolling_baseline||{method:'ROLLING_20M_MEDIAN',outside:gap('ROLLING_BASELINE_MISSING'),inside:gap('ROLLING_BASELINE_MISSING')};
 const ref=detail.same_minute_historical_baselines;
 const envelope=ref?.contract==='mother_pool_a16_minute_reference_v1'&&ref.trade_date===identity.trade_date&&ref.canonical_run_id===identity.canonical_run_id&&ref.symbol===detail.symbol&&ref.minute===minute&&typeof ref.generation==='string'&&ref.generation.length>0&&Array.isArray(ref.rows);
 const pick=type=>{
  if(!envelope)return gap('A16_MINUTE_REFERENCE_MISSING_OR_MISMATCH');
  const matches=ref.rows.filter(r=>r.baseline_type===type);if(matches.length!==1)return gap('A16_DIRECTION_ROW_MISSING_OR_DUPLICATE');
  const r=matches[0],dates=r.source_trade_dates;
  if(r.symbol!==detail.symbol||r.trade_date!==identity.trade_date||r.canonical_run_id!==identity.canonical_run_id||r.minute!==minute||r.unit!=='RATIO'||r.is_synthetic!==false)return gap('A16_DIRECTION_IDENTITY_OR_UNIT');
  if(!Number.isInteger(r.sample_count)||r.sample_count<10||r.sample_count>20||!Array.isArray(dates)||dates.length!==r.sample_count||new Set(dates).size!==dates.length||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>=identity.trade_date))return gap('A16_SAMPLE_DATES_OR_COUNT');
  if(r.status!=='READY'||r.data_gap!==false||typeof r.baseline_value!=='number'||!Number.isFinite(r.baseline_value)||r.baseline_value<=0)return gap(r.reason||'A16_BASELINE_NOT_READY');
  return {baseline:r.baseline_value,sample_count:r.sample_count,status:'READY',source_trade_dates:[...dates],generation:ref.generation};
 };
 return {method:HISTORY,outside:pick('OUTSIDE_STRENGTH'),inside:pick('INSIDE_STRENGTH')};
}
module.exports={select,HISTORY};
