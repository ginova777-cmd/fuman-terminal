'use strict';
const volume=require('./mother-pool-historical-volume');
function collect({identity,symbols,dailyVolumeMap,asOf}){
 const rows=symbols.map(symbol=>{
  const value=dailyVolumeMap.get(symbol),raw=value?.historical_daily_evidence||null;
  const evaluated=volume.evaluate({symbol,tradeDate:identity.trade_date,evidence:raw});
  const gaps=[...evaluated.failed_checks,'HISTORICAL_REFERENCE_AND_LIMIT_PRICE_SOURCE_MISSING','HISTORICAL_PRICE_RULE_CONTRACT_REQUIRED'];
  const readAt=value?.daily_ohlcv_read_at,at=Date.parse(readAt),now=Date.parse(asOf);
  if(!Number.isFinite(at)||!Number.isFinite(now)||at>now||new Date(at+28800000).toISOString().slice(0,10)!==identity.trade_date)gaps.push('HISTORY_READ_TIME_INVALID');
  return {symbol,source:'strategy4_daily_ohlcv_view',source_contract:'preopen_a04_volume_price_receipt_v1',source_updated_at:Number.isFinite(at)?readAt:asOf,event_time:asOf,
   volume_evidence:evaluated,raw_daily_evidence:raw,price_evidence:null,status:'DATA_GAP',data_gap_reason:gaps.join('|'),failed_checks:gaps,formal_candidate_allowed:false,publish_allowed:false,is_synthetic:false,replay:false,look_ahead:false};
 });
 return {...identity,module_id:'A04',created_at:asOf,requested_symbols:[...symbols],rows};
}
module.exports={collect};
