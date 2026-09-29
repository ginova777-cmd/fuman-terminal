'use strict';
const {finite} = require('./daytrade-fast-candle-row');
// Taiwan stock aggregates/quote total.tradeValue is the provider-reported
// cumulative amount. Never derive it from last price times cumulative volume.
const SOURCES = new Set(['fugle.websocket.aggregates.total.tradeValue','fugle.intraday.quote.total.tradeValue']);
function nativeTradeValue(data={}, source) {
  if(!data || typeof data!=='object' || Array.isArray(data)) data={};
  const micros=finite(data.total?.time);
  const date=micros!==null && micros>0 ? new Date(micros/1000) : null;
  return {value:finite(data.total?.tradeValue),unit:'TWD',source,
    event_at:date && Number.isFinite(date.getTime())?date.toISOString():null,
    is_synthetic:false, calculation:'provider_reported_cumulative'};
}
function evaluateTradeValue(evidence={}, tradeDate, nowMs=Date.now()) {
  if(!evidence || typeof evidence!=='object' || Array.isArray(evidence)) evidence={};
  const value=finite(evidence.value), time=Date.parse(evidence.event_at);
  const age=(nowMs-time)/1000, reasons=[];
  if(value===null || value<0) reasons.push('TRADE_VALUE_MISSING_OR_INVALID');
  if(evidence.unit!=='TWD') reasons.push('TRADE_VALUE_UNIT_INVALID');
  if(!SOURCES.has(evidence.source)||evidence.calculation!=='provider_reported_cumulative'||evidence.is_synthetic!==false) reasons.push('TRADE_VALUE_SOURCE_UNPROVEN');
  const date=Number.isFinite(time)?new Date(time+28800000).toISOString().slice(0,10):null;
  if(date!==tradeDate) reasons.push('TRADE_VALUE_DATE_INVALID');
  if(!Number.isFinite(age)||age<0||age>120) reasons.push('TRADE_VALUE_EVENT_STALE_OR_INVALID');
  return {...evidence,status:reasons.length?'DATA_GAP':'ready',reasons,age_seconds:Number.isFinite(age)?age:null,
    trade_value_twd:reasons.length?null:value};
}
module.exports={nativeTradeValue,evaluateTradeValue};
