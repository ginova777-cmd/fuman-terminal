'use strict';
const {admit}=require('./mother-pool-anomaly-admission');
const independent=require('./telegram-detectors/verify-natural-calculation.cjs');
function collect({identity,symbols,evidence,asOf}){
 if(evidence?.trade_date!==identity.trade_date||evidence.canonical_run_id!==identity.canonical_run_id||evidence.mother_pool_run_id!==identity.mother_pool_run_id||evidence.snapshot_sequence!==identity.snapshot_sequence)throw Error('ANOMALY_SOURCE_IDENTITY');
 const details=new Map((evidence.details||[]).map(d=>[d.symbol,d]));
 const plans={B12:[],B13:[],B19:[]};
 for(const symbol of symbols){
  const d=details.get(symbol),v=d?.volume,p=d?.price;
  let failures=d?.failed_checks||[];
  try{if(!d?.current?.length)throw Error('SOURCE_BARS_MISSING');failures=[...failures,...independent.verify({current:d.current,history:d.history||[],volume:v,price:p})];}catch(e){failures=[...failures,e.message];}
  for(const module_id of Object.keys(plans)){
   const detector=module_id==='B12'?v:p,method=detector?.primary_baseline_method;
   const samples=method==='SAME_MINUTE_HISTORICAL'?detector?.same_minute_sample_count:detector?.rolling20_sample_count;
   const baseline=detector?.primary_baseline;
   const value=module_id==='B12'?detector?.volume_shares:detector?.return_1m;
   const ready=failures.length===0&&detector?.data_gap===false&&Number.isFinite(value)&&Number.isFinite(baseline)&&baseline>0&&
    ['SAME_MINUTE_HISTORICAL','ROLLING_20M_MEDIAN'].includes(method)&&Number.isInteger(samples)&&samples>=(method==='SAME_MINUTE_HISTORICAL'?10:20);
   const direction=module_id==='B12'||(module_id==='B13'?value>0:value<0);
   const ratio=ready&&direction?(module_id==='B12'?value:Math.abs(value))/baseline:null;
   const admission=admit({...detector,primary_ratio:ratio},{ratioField:'primary_ratio',directionValid:direction});
   const latest=d?.current?.at(-1);
   plans[module_id].push({symbol,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:(failures.length?failures.join('|'):d?.reason||'BASELINE_OR_SOURCE_INCOMPLETE'),
    source:'Fugle.websocket.candles.TSE_OTC',source_contract:module_id==='B12'?'intraday_volume_spike_detector_v1':module_id==='B13'?'intraday_price_spike_up_detector_v1':'intraday_price_spike_down_v1',
    source_updated_at:latest?.available_at||asOf,event_time:detector?.timestamp||null,is_synthetic:false,replay:false,look_ahead:false,
    baseline_method:method||null,baseline_value:baseline??null,sample_count:samples??null,latest_volume:v?.volume_shares??null,volume_unit:'SHARES',
    return_1m:p?.return_1m??null,ratio,price_spike_ratio:ratio,event_detected:ready&&admission.allowed,admission,
    current:d?.current||[],history:d?.history||[],history_provenance:d?.history_provenance||null,volume_detector:v||null,price_detector:p||null,detector_failed_checks:failures});
  }
 }
 return Object.entries(plans).map(([module_id,rows])=>({...identity,module_id,created_at:asOf,requested_symbols:[...symbols],rows}));
}
module.exports={collect};
