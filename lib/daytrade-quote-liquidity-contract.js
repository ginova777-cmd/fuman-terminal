'use strict';
const {finite}=require('./daytrade-fast-candle-row');
const iso=v=>Number.isFinite(Date.parse(v||''))?new Date(v).toISOString():null;
const day=v=>iso(v)?new Date(Date.parse(v)+28800000).toISOString().slice(0,10):null;
function evidence(e,date,kind){
  e=e&&typeof e==='object'&&!Array.isArray(e)?e:{};
  const value=typeof e.value==='number'?finite(e.value):null,event=iso(e.event_at),reasons=[];
  if(value===null||value<0)reasons.push('MISSING_OR_INVALID_VALUE');
  if(!(kind==='volume'?['lots','shares']:['TWD']).includes(e.unit))reasons.push('INVALID_UNIT');
  const field=kind==='volume'?'tradeVolume':'tradeValue';
  if(![`fugle.websocket.aggregates.total.${field}`,`fugle.intraday.quote.total.${field}`].includes(e.source))reasons.push('UNPROVEN_SOURCE');
  if(e.is_synthetic!==false)reasons.push('SYNTHETIC_OR_UNKNOWN');
  if(!event||day(event)!==date)reasons.push('EVENT_DATE_MISMATCH');
  return {value,event,unit:e.unit||null,source:e.source||null,synthetic:e.is_synthetic??null,valid:!reasons.length,reasons};
}
function normalizeQuoteLiquidity(row){
  const p=row.payload||{},v=evidence(p.turnoverVolumeEvidence,row.trade_date,'volume'),a=evidence(p.tradeValueEvidence,row.trade_date,'amount');
  return {...row,total_volume:v.valid?v.value:null,trade_value:a.valid?a.value:null,payload:{...p,
    liquidity_contract:'native-liquidity-evidence-v1',
    total_volume_unit:v.unit,total_volume_raw_unit:v.unit,volume_unit:v.unit,
    total_volume_source_event_at:v.event,total_volume_available:v.valid,total_volume_source:v.source,
    is_synthetic:v.synthetic,volume_strategy_usable:v.valid,
    trade_value_unit:a.valid?'TWD':null,trade_value_source_event_at:a.event,trade_value_available:a.valid,
    liquidity_missing_reasons:{volume:v.reasons,trade_value:a.reasons}
  }};
}
module.exports={normalizeQuoteLiquidity,evidence};
