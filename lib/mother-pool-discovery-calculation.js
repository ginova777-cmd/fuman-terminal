'use strict';
const {inspect}=require('./verify-mother-pool-discovery-source');
const {hash,identityFields}=require('./mother-pool-module-write-set');
const {evaluateVolume}=require('./daytrade-volume-value-ranking');
const THRESHOLD_VERSION='daytrade_intraday_discovery_existing_rules_v1';
function calculate({symbol,source,previous,bars,identity,asOf}){
 const raw=inspect(source,identity.trade_date,asOf),fail=[...raw.failed_checks];
 let prior=null;
 if(previous?.module_id!=='B02'||previous.trade_date!==identity.trade_date||previous.canonical_run_id!==identity.canonical_run_id||previous.writer_run_id===identity.writer_run_id||previous.plan_hash!==hash(previous.plan)||previous.ack?.plan_hash!==previous.plan_hash||previous.ack?.committed!==true||identityFields.some(k=>previous[k]==null||previous.ack?.[k]!==previous[k])||previous.ack?.module_id!=='B02')fail.push('PREVIOUS_WRITTEN_VOLUME_ROUND_REQUIRED');
 else{
  const row=previous.plan.rows.find(r=>r.symbol===symbol);
  if(!row||!previous.ack.written_symbols.includes(symbol))fail.push('PREVIOUS_WRITTEN_SYMBOL_MISSING');
  else{const v=evaluateVolume(row.volume_evidence,identity.trade_date,Date.parse(previous.plan.created_at));const age=Date.parse(asOf)-Date.parse(previous.plan.created_at);
   if(v.status!=='ready'||!(age>0&&age<=300000)||Date.parse(source.source_evidence.quote.payload.turnoverVolumeEvidence.event_at)<=Date.parse(v.event_at))fail.push('PREVIOUS_VOLUME_INVALID_OR_STALE');
   else prior=v.unit==='shares'?v.value/1000:v.value;
  }
 }
 const selected=bars.slice(-20),end=Date.parse(asOf);
 if(selected.length!==20||selected.some((b,i)=>b.stock_id!==symbol||b.trade_date!==identity.trade_date||b.complete!==true||b.is_synthetic!==false||b.source!=='Fugle.websocket.candles.TSE_OTC'||b.volume_raw_unit!=='LOTS'||!Number.isFinite(b.close)||b.close<=0||!Number.isFinite(b.volume_raw)||b.volume_raw<0||!Number.isFinite(Date.parse(b.available_at))||Date.parse(b.available_at)>end||Date.parse(b.timestamp)+60000>end||(i&&Date.parse(b.timestamp)-Date.parse(selected[i-1].timestamp)!==60000))||end-Date.parse(selected.at(-1)?.timestamp)>120000)fail.push('TWENTY_NATURAL_COMPLETED_BARS_REQUIRED');
 const ready=fail.length===0,ma=n=>ready?selected.slice(-n).reduce((sum,b)=>sum+b.close,0)/n:null;
 const ma3=ma(3),ma5=ma(5),ma10=ma(10),ma20=ma(20),recent=selected.slice(-3);
 return {threshold_version:THRESHOLD_VERSION,status:ready?'READY':'DATA_GAP',data_gap_reason:fail.join('|')||null,failed_checks:fail,
  cumulative_volume_lots:raw.cumulative_volume_lots,volume_ratio:raw.volume_ratio,price_change_pct:raw.price_change_pct,
  previous_cumulative_volume_lots:prior,volume_expanding:ready?raw.cumulative_volume_lots>prior:null,
  recent_1m_volume_not_shrinking:ready?recent[2].volume_raw>=recent[1].volume_raw&&recent[1].volume_raw>=recent[0].volume_raw:null,
  ma3,ma5,ma10,ma20,ma_bullish:ready?ma5>ma10&&ma10>ma20:null};
}
function flags(r,rank){return {bullish_gain_volume:r.status==='READY'&&r.price_change_pct>2&&r.ma_bullish&&r.volume_expanding&&r.cumulative_volume_lots>0,
 volume_surge_top100:r.status==='READY'&&r.cumulative_volume_lots>10000&&r.volume_ratio>=2&&r.volume_expanding&&r.recent_1m_volume_not_shrinking&&rank>0&&rank<=100};}
module.exports={calculate,flags,THRESHOLD_VERSION};
