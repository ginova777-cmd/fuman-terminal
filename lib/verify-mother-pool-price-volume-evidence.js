'use strict';
const {verify:recompute}=require('./telegram-detectors/verify-natural-calculation.cjs');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function verify(actual,expected,{role,dbReadback}={}){
 const failed=[];
 if(role!=='anon'||dbReadback!==true)failed.push('ANON_READBACK_REQUIRED');
 if(!actual||stable(actual)!==stable(expected))failed.push('SAME_BATCH_MISMATCH');
 const b=actual||{},rows=Array.isArray(b.details)?b.details:[];
 const now=Date.parse(b.as_of),date=t=>Number.isFinite(t)?new Date(t+28800000).toISOString().slice(0,10):null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(b.trade_date||'')||date(now)!==b.trade_date
  ||b.canonical_run_id!==`fugle_daytrade_source:${String(b.trade_date).replaceAll('-','')}:canonical`
  ||typeof b.mother_pool_run_id!=='string'||!b.mother_pool_run_id||!Number.isInteger(b.snapshot_sequence)||b.snapshot_sequence<1)
  failed.push('IDENTITY_INVALID');
 if(b.contract!=='mother_pool_price_volume_evidence_v1'||!Array.isArray(b.details)
  ||rows.length!==b.requested||new Set(rows.map(x=>x?.symbol)).size!==rows.length)failed.push('BATCH_INVALID');
 if(b.complete!==false||b.publish_allowed!==false||b.creates_order!==false||b.creates_formal_candidate!==false)failed.push('PUBLICATION_GUARD_INVALID');
 for(const row of rows){
  if(!row||!/^\d{4}$/.test(row.symbol||'')){failed.push('ROW_INVALID');continue;}
  if(row.status==='DATA_GAP'){if(!row.reason)failed.push('GAP_REASON_MISSING');continue;}
  if(row.status!=='CALCULATION_EVIDENCE_ONLY'||row.formal_event_allowed!==false
   ||!['HISTORICAL_SOURCE_NOT_CONNECTED','HISTORICAL_INPUT_VALIDATED'].includes(row.history_status))failed.push('EVIDENCE_GUARD_INVALID:'+row.symbol);
  const history=Array.isArray(row.history)?row.history:[];
  if(row.history_status==='HISTORICAL_SOURCE_NOT_CONNECTED'&&history.length)failed.push('UNPROVEN_HISTORY:'+row.symbol);
  if(row.history_status==='HISTORICAL_SOURCE_NOT_CONNECTED')for(const admission of [row.volume_admission,row.price_admission]) {
   if(admission?.allowed!==false||!Array.isArray(admission.reasons)||!admission.reasons.includes('INSUFFICIENT_SAMPLE'))
    failed.push('HISTORICAL_ADMISSION_GUARD_INVALID:'+row.symbol);
  }
  try{
   if(row.history_status==='HISTORICAL_INPUT_VALIDATED'){
    const proof=row.history_provenance,seen=new Set();
    if(!proof||!Array.isArray(proof.session_dates)||proof.session_dates.length!==20||new Set(proof.session_dates).size!==20
     ||proof.session_dates.some(d=>d>=b.trade_date)||!Number.isFinite(Date.parse(proof.fetched_at))||Date.parse(proof.fetched_at)>now
     ||!['raw_sha256','calendar_sha256'].every(k=>/^[a-f0-9]{64}$/.test(proof[k]||'')))throw Error('history proof');
    for(const candle of history){
     const t=Date.parse(candle.timestamp);
     if(candle.stock_id!==row.symbol||!proof.session_dates.includes(candle.trade_date)||date(t)!==candle.trade_date
      ||!Number.isFinite(t)||t%60000||seen.has(t)||t+60000>Date.parse(proof.fetched_at)
      ||candle.available_at!==proof.fetched_at||!['Fugle.historical.candles.1.TSE_OTC','Fugle.historical.candles.1.TIB'].includes(candle.source)
      ||(candle.source==='Fugle.historical.candles.1.TIB'&&(candle.market!=='TIB'||candle.exchange!=='TWSE'))
      ||candle.is_synthetic!==false||candle.complete!==true||candle.volume_raw_unit!=='LOTS'
      ||typeof candle.volume_raw!=='number'||!Number.isFinite(candle.volume_raw)||candle.volume_raw<0
      ||!['open','high','low','close'].every(k=>typeof candle[k]==='number'&&Number.isFinite(candle[k])&&candle[k]>0)
      ||candle.high<Math.max(candle.open,candle.close,candle.low)||candle.low>Math.min(candle.open,candle.close,candle.high))throw Error('history row');
     seen.add(t);
    }
    for(const [calculated,admission,field,direction] of [[row.volume,row.volume_admission,'primary_ratio',true],[row.price,row.price_admission,'primary_price_spike_ratio',row.price?.return_1m>0]]){
     const allowed=calculated?.same_minute_sample_count>=10&&calculated.same_minute_baseline>0&&calculated.primary_baseline>0
      &&['SAME_MINUTE_HISTORICAL','ROLLING_20M_MEDIAN'].includes(calculated.primary_baseline_method)
      &&Number.isFinite(calculated[field])&&calculated[field]>=3&&calculated.data_gap===false&&calculated.baseline_zero!==true&&direction;
     if(admission?.allowed!==allowed)throw Error('history admission');
    }
   }
   if(!Array.isArray(row.current)||!row.current.length||!row.volume||!row.price)throw Error('missing');
   let previous=-Infinity;
   for(const candle of row.current){
    const t=Date.parse(candle?.timestamp),available=Date.parse(candle?.available_at);
    if(!candle||candle.stock_id!==row.symbol||candle.trade_date!==b.trade_date||date(t)!==b.trade_date
     ||!Number.isFinite(t)||t%60000!==0||t<=previous||(Number.isFinite(previous)&&t-previous!==60000)||t+60000>now
     ||!Number.isFinite(available)||available<t||available>now||candle.complete!==true||candle.is_synthetic!==false
     ||candle.source!=='Fugle.websocket.candles.TSE_OTC'||candle.volume_raw_unit!=='LOTS'
     ||typeof candle.volume_raw!=='number'||!Number.isFinite(candle.volume_raw)||candle.volume_raw<0
     ||!['open','high','low','close'].every(k=>typeof candle[k]==='number'&&Number.isFinite(candle[k])&&candle[k]>0)
     ||candle.high<Math.max(candle.open,candle.close,candle.low)||candle.low>Math.min(candle.open,candle.close,candle.high))
     failed.push('CANDLE_SOURCE_INVALID:'+row.symbol);
    previous=t;
   }
   if((now-previous)/1000<60||(now-previous)/1000>120)failed.push('LATEST_CANDLE_FRESHNESS:'+row.symbol);
   for(const calculated of [row.volume,row.price])if(calculated.stock_id!==row.symbol||calculated.trade_date!==b.trade_date
    ||calculated.timestamp!==row.current.at(-1).timestamp)failed.push('CALCULATION_IDENTITY_INVALID:'+row.symbol);
   failed.push(...recompute({current:row.current,history,volume:row.volume,price:row.price}).map(x=>row.symbol+':'+x));
  }catch{failed.push('CALCULATION_INPUT_INVALID:'+row.symbol);}
 }
 return {contract:'mother_pool_price_volume_readback_v1',trade_date:b.trade_date,mother_pool_run_id:b.mother_pool_run_id,
  snapshot_sequence:b.snapshot_sequence,as_of:b.as_of,read_role:role,readback_verified:failed.length===0,
  complete:false,status:failed.length?'blocked':'CALCULATION_READBACK_VERIFIED',failed_checks:failed,
  first_blocker:failed[0]||null,exit_code:failed.length?1:0};
}
module.exports={verify};
