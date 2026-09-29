'use strict';
const {finite}=require('./daytrade-fast-candle-row');
const {evaluateTradeValue}=require('./daytrade-trade-value-evidence');
const VOLUME_SOURCES=new Set(['fugle.websocket.aggregates.total.tradeVolume','fugle.intraday.quote.total.tradeVolume','fugle.collector.typed_cumulative_volume']);
function evaluateVolume(volume={},tradeDate,nowMs) {
  if(!volume || typeof volume!=='object' || Array.isArray(volume)) volume={};
  const value=finite(volume.value), time=Date.parse(volume.event_at), age=(nowMs-time)/1000, reasons=[];
  if(value===null||value<0) reasons.push('VOLUME_MISSING_OR_INVALID');
  if(!['shares','lots'].includes(volume.unit)) reasons.push('VOLUME_UNIT_INVALID');
  if(volume.is_synthetic!==false||!VOLUME_SOURCES.has(volume.source)) reasons.push('VOLUME_SOURCE_UNPROVEN');
  if(!Number.isFinite(time)||new Date(time+28800000).toISOString().slice(0,10)!==tradeDate) reasons.push('VOLUME_DATE_INVALID');
  if(!Number.isFinite(age)||age<0||age>120) reasons.push('VOLUME_EVENT_STALE_OR_INVALID');
  const shares=value===null?null:value*(volume.unit==='lots'?1000:1);
  if(shares!==null&&!Number.isFinite(shares)) reasons.push('VOLUME_CONVERSION_OVERFLOW');
  return {...volume,status:reasons.length?'DATA_GAP':'ready',reasons,age_seconds:Number.isFinite(age)?age:null,
    volume_shares:reasons.length?null:shares,volume_lots:reasons.length?null:shares/1000};
}
function buildRanking(inputs,{tradeDate,canonicalRunId,now}) {
  const nowMs=Date.parse(now);
  if(typeof tradeDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Number.isFinite(nowMs)||new Date(nowMs+28800000).toISOString().slice(0,10)!==tradeDate||canonicalRunId!==`fugle_daytrade_source:${tradeDate.replace(/-/g,'')}:canonical`) throw Error('RANKING_IDENTITY_INVALID');
  if(!Array.isArray(inputs)||inputs.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('RANKING_INPUT_INVALID');
  if(new Set(inputs.map(r=>r.symbol)).size!==inputs.length||inputs.some(r=>typeof r.symbol!=='string'||!/^\d{4}$/.test(r.symbol))) throw Error('RANKING_SYMBOL_INVALID_OR_DUPLICATE');
  const rows=inputs.map(row=>({symbol:row.symbol,volume:evaluateVolume(row.volume,tradeDate,nowMs),amount:evaluateTradeValue(row.amount,tradeDate,nowMs)}));
  const rank=(field,key)=>rows.filter(r=>r[field].status==='ready').sort((a,b)=>b[field][key]-a[field][key]||a.symbol.localeCompare(b.symbol)).map((r,i)=>({symbol:r.symbol,rank:i+1,value:r[field][key]}));
  return {contract:'daytrade_volume_value_ranking_v1',trade_date:tradeDate,canonical_run_id:canonicalRunId,
    run_id:`volume-value:${tradeDate}:${now}`,calculated_at:now,scope:'active_common_stock_universe',
    requested_count:rows.length,rows,volume_ranking:rank('volume','volume_shares'),value_ranking:rank('amount','trade_value_twd'),
    volume_unit:'shares',value_unit:'TWD',creates_formal_candidate:false,publish_allowed:false};
}
module.exports={evaluateVolume,buildRanking};
