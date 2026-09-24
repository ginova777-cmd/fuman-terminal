'use strict';
const {inspect}=require('./mother-pool-combination-sources');
const {b24,b22}=require('./intraday-context-detectors-b19-b24');
function collect({identity,symbols,parents,side,asOf}){
 const coverage=inspect({identity,symbols,parents,side,asOf});
 const rows=coverage.rows.map(entry=>{
  const gaps=[...entry.data_gaps],events=[],sources=entry.sources;
  function event(module_id,type,time,source_contract){
   const ts=Date.parse(time),now=Date.parse(asOf);
   if(!Number.isFinite(ts)||ts>now||now-ts>180000){gaps.push({module_id,reason:'EVENT_TIME_INVALID_OR_STALE'});return;}
   events.push({module_id,type,symbol:entry.symbol,trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,event_timestamp:time,event_id:[identity.writer_run_id,entry.symbol,module_id,type,time].join('|'),source_contract,source_contract_ok:true});
  }
  for(const [id,type] of [['B12','VOLUME_SPIKE'],['B13','PRICE_SPIKE_UP'],['B19','PRICE_SPIKE_DOWN']]){
   const r=sources[id];if(r?.status!=='READY')continue;
   const verified=require('./verify-mother-pool-anomaly-row').verify(id,{...r,...identity},asOf);
   if(!verified)gaps.push({module_id:id,reason:'ANOMALY_FORMULA_INVALID'});
   else if(r.event_detected)event(id,type,r.event_time,r.source_contract);
  }
  for(const [id,direction,type] of [['B14','outside','OUTSIDE_STRONG'],['B20','inside','INSIDE_STRONG']]){
   const r=sources[id]?.source;if(!r)continue;
   const projected={...r,...identity,event_time:r.minute_start,baseline_value:r[direction+'_baseline_value'],baseline_sample_count:r[direction+'_baseline_sample_count'],dynamic_ratio:r[direction+'_dynamic_ratio'],side_state:r[direction+'_side_state']};
   if(!require('./verify-mother-pool-module-round').createVerifier(id).minuteSideFormulaOk(id,projected))gaps.push({module_id:id,reason:'SIDE_FORMULA_INVALID'});
   else if(projected.side_state==='RATIO_VALID'&&r['raw_'+direction+'_ratio']>=2)event(id,type,r.side_volume_timestamp,r.source_contract);
  }
  const point=sources.B23;
  const pointValid=point?.status==='READY'&&require('./verify-mother-pool-point-in-time').verify({...point,...identity},asOf);
  if(point?.status==='READY'&&!pointValid)gaps.push({module_id:'B23',reason:'POINT_IN_TIME_FORMULA_INVALID'});
  if(pointValid){if(point.new_high)event('B23','NEW_INTRADAY_HIGH',point.event_time,point.source_contract);if(point.new_low)event('B23','NEW_INTRADAY_LOW',point.event_time,point.source_contract);}
  const range=sources.B22;
  if(range?.status==='READY'){
   const current=pointValid?point.current_price:null;
   const result=b22({symbol:entry.symbol,trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,current_price:current,event_timestamp:asOf,opening_range_bars:range.opening_range?.bars});
   if(!pointValid||!result.source_contract_ok)gaps.push({module_id:'B22',reason:'OPENING_RANGE_EVENT_SOURCE_INVALID'});
   else if(result.break_direction)event('B22','OPENING_RANGE_BREAK_'+result.break_direction,asOf,'intraday_opening_range_v1');
  }
  const vwap=sources.B21;
  if(vwap?.status==='READY'){
   const v=require('./daytrade-volume-value-ranking').evaluateVolume(vwap.volume_evidence,identity.trade_date,Date.parse(asOf));
   const a=require('./daytrade-trade-value-evidence').evaluateTradeValue(vwap.trade_value_evidence,identity.trade_date,Date.parse(asOf));
   const valid=pointValid&&v.status==='ready'&&a.status==='ready'&&v.event_at===a.event_at&&v.volume_shares>0&&typeof vwap.vwap==='number'&&Math.abs(vwap.vwap-a.trade_value_twd/v.volume_shares)<1e-6;
   if(!valid)gaps.push({module_id:'B21',reason:'VWAP_EVENT_SOURCE_INVALID'});
   else {const pct=(point.current_price-vwap.vwap)/vwap.vwap*100;event('B21',pct>0.05?'VWAP_ABOVE_VWAP':pct< -0.05?'VWAP_BELOW_VWAP':'VWAP_AT_VWAP',v.event_at,'intraday_vwap_v1');}
  }
  const combinations=b24(events);
  return {symbol:entry.symbol,status:gaps.length?'DATA_GAP':'READY',data_gap_reason:gaps.length?gaps.map(g=>g.module_id+':'+g.reason).join('|'):null,source:'MotherPool.committed_module_sources',source_contract:'intraday_event_combination_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,events,combinations,data_gaps:gaps,event_count:events.length,combination_count:combinations.length,formal_candidate_allowed:false,publish_allowed:false};
 });
 return {...identity,module_id:'B24',created_at:asOf,requested_symbols:[...symbols],rows,source_evidence:{parents,side},special_evidence:{window_seconds:180}};
}
module.exports={collect};
