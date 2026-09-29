'use strict';
const {datesFromCalendar}=require('./mother-pool-daily-volume-baseline');
const {hash}=require('./mother-pool-module-write-set');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
function evaluate(symbol,tradeDate,evidence,observedAt,asOf){
 const gaps=[];let date=null,raw=null;
 try{date=datesFromCalendar(evidence?.calendar,tradeDate).at(-1);}catch{gaps.push('PREVIOUS_SESSION_UNPROVEN');}
 if(evidence?.source!=='strategy4_daily_ohlcv_view'||evidence?.symbol!==symbol||evidence?.trade_date!==tradeDate)gaps.push('DAILY_SOURCE_IDENTITY_INVALID');
 const matches=Array.isArray(evidence?.rows)?evidence.rows.filter(r=>r.symbol===symbol&&r.trade_date===date):[];
 if(matches.length!==1)gaps.push('PREVIOUS_OHLC_MISSING_OR_DUPLICATE');else raw=matches[0];
 const observed=Date.parse(observedAt),now=Date.parse(asOf);
 if(!Number.isFinite(observed)||!Number.isFinite(now)||observed>now||new Date(observed+28800000).toISOString().slice(0,10)!==tradeDate)gaps.push('DAILY_READ_TIME_INVALID');
 if(!raw||['open','high','low','close'].some(k=>typeof raw[k]!=='number'||!Number.isFinite(raw[k])||raw[k]<=0)||raw.high<raw.low||raw.open<raw.low||raw.open>raw.high||raw.close<raw.low||raw.close>raw.high||raw.synthetic===true||raw.is_synthetic===true)gaps.push('PREVIOUS_OHLC_INVALID');
 const ready=!gaps.length;
 return {source_date:date,prev_open:ready?raw.open:null,prev_high:ready?raw.high:null,prev_low:ready?raw.low:null,prev_close:ready?raw.close:null,
  prev_range:ready?raw.high-raw.low:null,prev_range_pct:ready?(raw.high-raw.low)/raw.close*100:null,prev_vwap:null,prev_vwap_status:'SOURCE_NOT_PROVIDED',
  formula_version:'previous_completed_ohlc_range_v1',status:ready?'READY':'DATA_GAP',data_gap_reason:gaps.length?gaps.join('|'):null};
}
function collect({identity,symbols,dailyVolumeMap,asOf,lockDirectory}){
 const rows=symbols.map(symbol=>{
  const value=dailyVolumeMap.get(symbol),evidence=value?.daily_volume_evidence||null,observedAt=value?.daily_ohlcv_read_at||null;
  return {symbol,...evaluate(symbol,identity.trade_date,evidence,observedAt,asOf),source:'strategy4_daily_ohlcv_view',source_contract:'preopen_a15_prev_ohlc_receipt_v1',
   source_updated_at:observedAt||asOf,source_observed_at:observedAt,event_time:asOf,locked_at:asOf,raw_daily_evidence:evidence,
   source_hash:hash(stable(evidence)),is_synthetic:false,replay:false,look_ahead:false};
 });
 const plan={...identity,module_id:'A15',created_at:asOf,requested_symbols:[...symbols],rows};
 return lockDirectory?require('./mother-pool-previous-ohlc-lock').apply(plan,lockDirectory):plan;
}
function verify(row,r){try{
 const expected=evaluate(row.symbol,r.trade_date,row.raw_daily_evidence,row.source_observed_at,r.observed_at);
 return expected.status==='READY'&&require('./mother-pool-previous-ohlc-lock').valid(row.source_lock,row,r,r.observed_at)&&row.locked_at===row.source_lock.locked_at&&row.source==='strategy4_daily_ohlcv_view'&&row.source_contract==='preopen_a15_prev_ohlc_receipt_v1'&&row.source_updated_at===row.source_observed_at&&row.event_time===r.observed_at&&row.source_hash===hash(stable(row.raw_daily_evidence))&&Object.entries(expected).every(([key,value])=>row[key]===value);
}catch{return false;}}
module.exports={collect,evaluate,verify};
