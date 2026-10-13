'use strict';
const {inspect}=require('./mother-pool-combination-sources');
const {combine}=require('./mother-pool-directional-combinations');
function collect({identity,symbols,parents,side,asOf}){
 // B24 depends on exactly these committed sources; unrelated module payloads
 // must not be copied into every B24 evidence and verification round.
 parents=Object.fromEntries(require('./mother-pool-combination-sources').MODULES.filter(id=>parents?.[id]).map(id=>[id,parents[id]]));
 const coverage=inspect({identity,symbols,parents,side,asOf});
 const rows=coverage.rows.map(entry=>{
  const gaps=[...entry.data_gaps],events=[],sources=entry.sources;
  function event(module_id,type,time,source_contract,direction=null,event_price=null,event_id=null){
   const ts=Date.parse(time),now=Date.parse(asOf);
   if(!Number.isFinite(ts)||ts>now||now-ts>180000){gaps.push({module_id,reason:'EVENT_TIME_INVALID_OR_STALE'});return;}
   const r=sources[module_id];const calculation_evidence=['B12','B13','B19'].includes(module_id)?{baseline_method:r.baseline_method,baseline_value:r.baseline_value,sample_count:r.sample_count,ratio:r.ratio,value:module_id==='B12'?r.latest_volume:r.return_1m}:module_id==='B22'?{level:r.tongzi.levels.P2,reference_bar_hash:r.tongzi.levels.bar_hash,crossing:r.tongzi.events.find(e=>e.event_id===event_id)}:module_id==='B21'?{vwap:r.vwap,volume:r.volume_evidence,trade_value:r.trade_value_evidence}:{high:r.day_high_so_far,low:r.day_low_so_far,current_price:r.current_price};
   events.push({calculation_evidence,ratio:module_id==='B12'?r.ratio:null,module_id,type,symbol:entry.symbol,trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,event_timestamp:time,event_id:event_id||[identity.trade_date,entry.symbol,module_id,type,time].join('|'),direction,event_price,source_contract,source_contract_ok:true});
  }
  for(const [id,type] of [['B12','VOLUME_SPIKE'],['B13','PRICE_SPIKE_UP'],['B19','PRICE_SPIKE_DOWN']]){
   const r=sources[id];if(r?.status!=='READY')continue;
   const verified=require('./verify-mother-pool-anomaly-row').verify(id,{...r,...identity},asOf);
   if(!verified)gaps.push({module_id:id,reason:'ANOMALY_FORMULA_INVALID'});
   else if(r.event_detected)event(id,type,r.event_time,r.source_contract,id==='B13'?'long':id==='B19'?'short':'neutral',r.current?.at(-1)?.close??null);
  }
  const point=sources.B23;
  const pointValid=point?.status==='READY'&&require('./verify-mother-pool-point-in-time').verify({...point,...identity},asOf);
  if(point?.status==='READY'&&!pointValid)gaps.push({module_id:'B23',reason:'POINT_IN_TIME_FORMULA_INVALID'});
  if(pointValid){if(point.new_high)event('B23','NEW_INTRADAY_HIGH',point.event_time,point.source_contract,'long',point.current_price);if(point.new_low)event('B23','NEW_INTRADAY_LOW',point.event_time,point.source_contract,'short',point.current_price);}
  const range=sources.B22;
  if(range?.status==='READY'){
   if(!require('./verify-mother-pool-tongzi').verify(range,{...identity,observed_at:asOf}))gaps.push({module_id:'B22',reason:'TONGZI_SOURCE_INVALID'});
   else for(const e of range.tongzi.events)if(Date.parse(asOf)-Date.parse(e.event_timestamp)<=180000)event('B22',e.type,e.event_timestamp,e.source_contract,e.direction,e.event_price,e.event_id);
  }
  const vwap=sources.B21;
  if(vwap?.status==='READY'){
   const v=require('./daytrade-volume-value-ranking').evaluateVolume(vwap.volume_evidence,identity.trade_date,Date.parse(asOf));
   const a=require('./daytrade-trade-value-evidence').evaluateTradeValue(vwap.trade_value_evidence,identity.trade_date,Date.parse(asOf));
   const valid=pointValid&&v.status==='ready'&&a.status==='ready'&&v.event_at===a.event_at&&v.volume_shares>0&&typeof vwap.vwap==='number'&&Math.abs(vwap.vwap-a.trade_value_twd/v.volume_shares)<1e-6;
   if(!valid)gaps.push({module_id:'B21',reason:'VWAP_EVENT_SOURCE_INVALID'});
   else {const pct=(point.current_price-vwap.vwap)/vwap.vwap*100;event('B21',pct>0.05?'VWAP_ABOVE_VWAP':pct< -0.05?'VWAP_BELOW_VWAP':'VWAP_AT_VWAP',v.event_at,'intraday_vwap_v1',pct>0.05?'long':pct< -0.05?'short':null,point.current_price);}
  }
  const combinations=combine(events,{asOf});
  return {symbol:entry.symbol,status:gaps.length?'DATA_GAP':'READY',data_gap_reason:gaps.length?gaps.map(g=>g.module_id+':'+g.reason).join('|'):null,source:'MotherPool.committed_module_sources',source_contract:'intraday_event_combination_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,events,combinations,data_gaps:gaps,event_count:events.length,combination_count:combinations.length,formal_candidate_allowed:false,publish_allowed:false};
 });
 return {...identity,module_id:'B24',created_at:asOf,requested_symbols:[...symbols],rows,source_evidence:{parents,side},special_evidence:{window_seconds:180}};
}
module.exports={collect};
