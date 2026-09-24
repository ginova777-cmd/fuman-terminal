'use strict';
const {build}=require('./mother-pool-detector-candle-source');
const volume=require('./telegram-detectors/volume-detector.cjs');
const price=require('./telegram-detectors/price-detector.cjs');
const independent=require('./telegram-detectors/verify-natural-calculation.cjs');
const {inspectSnapshot}=require('./daytrade-mother-pool-snapshot');
function collect({candles,snapshot,asOf,readHistory=()=>null,maxMilliseconds=15000}){
 const tradeDate=snapshot?.trade_date;
 if(typeof tradeDate!=='string'||!inspectSnapshot(snapshot,tradeDate).ok
  ||snapshot.run_id!==snapshot.mother_pool_run_id||Date.parse(snapshot.effective_at)>Date.parse(asOf))
  throw Error('DETECTOR_SNAPSHOT_INVALID');
 const source=build({candles,tradeDate,canonicalRunId:snapshot.canonical_run_id,asOf});
 const details=[];
 const startedAt=Date.now();
 for(const symbol of snapshot.symbols){
  if(Number.isFinite(maxMilliseconds)&&Date.now()-startedAt>=maxMilliseconds){
   for(const pending of snapshot.symbols.slice(details.length)) details.push({symbol:pending,status:'DATA_GAP',reason:'SCORECARD_DEADLINE_EXCEEDED'});
   break;
  }
  // 20 preceding returns require 21 preceding closes, plus the trigger bar.
  // Keep the required calculation input, not an entire day's duplicate payload.
  const current=(source.groups.get(symbol)||[]).slice(-22),latest=current.at(-1);
  const gap=reason=>details.push({symbol,status:'DATA_GAP',reason});
  if(!latest){gap('NATURAL_CANDLES_MISSING');continue;}
  const age=(Date.parse(asOf)-Date.parse(latest.timestamp))/1000;
  if(age<60||age>120){gap('LATEST_CANDLE_NOT_FRESH');continue;}
  if(current.some((bar,i)=>i>0&&Date.parse(bar.timestamp)-Date.parse(current[i-1].timestamp)!==60000)){
   gap('NONCONTIGUOUS_ROLLING_CANDLES');continue;
  }
  if(source.rejected.some(x=>x.symbol===symbol)){gap('REJECTED_CANDLE_INPUT');continue;}
  let historical=null;
  try {
   const artifact=readHistory(symbol,tradeDate);
   if(artifact)historical=require('./mother-pool-history-input').selectHistory(artifact,{symbol,tradeDate,asOf,
    minute:new Date(Date.parse(latest.timestamp)+28800000).toISOString().slice(11,16)});
  }catch{gap('HISTORICAL_SOURCE_INVALID');continue;}
  const history=historical?.rows||[];
  const input={stock_id:symbol,trade_date:tradeDate,current,history,as_of:asOf};
  try{
   const v=volume.detect(input).rows.at(-1),p=price.detect(input).rows.at(-1);
   const failed=independent.verify({current,history,volume:v,price:p});
   details.push({symbol,status:failed.length?'DATA_GAP':'CALCULATION_EVIDENCE_ONLY',
    reason:failed.length?'INDEPENDENT_CALCULATION_FAILED':null,failed_checks:failed,
    current,history,history_provenance:historical?.provenance||null,volume:v,price:p,history_status:historical?'HISTORICAL_INPUT_VALIDATED':'HISTORICAL_SOURCE_NOT_CONNECTED',
    volume_admission:require('./mother-pool-anomaly-admission').admit(v,{ratioField:'primary_ratio'}),
    price_admission:require('./mother-pool-anomaly-admission').admit(p,{ratioField:'primary_price_spike_ratio',directionValid:p?.return_1m>0}),
    formal_event_allowed:false});
  }catch{gap('DETECTOR_CALCULATION_FAILED');}
 }
 return {contract:'mother_pool_price_volume_evidence_v1',trade_date:tradeDate,
  canonical_run_id:snapshot.canonical_run_id,mother_pool_run_id:snapshot.run_id,snapshot_sequence:snapshot.snapshot_sequence,
  as_of:asOf,requested:snapshot.symbols.length,details,source_rejections:source.rejected,
  complete:false,publish_allowed:false,creates_formal_candidate:false,creates_order:false};
}
module.exports={collect};
