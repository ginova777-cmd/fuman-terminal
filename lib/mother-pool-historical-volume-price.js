'use strict';
const volume=require('./mother-pool-historical-volume');
function collect({identity,symbols,dailyVolumeMap,asOf},trustedBinding){
 const requested=[...new Set(symbols)];
 const rows=requested.map(symbol=>{
  const value=dailyVolumeMap.get(symbol),raw=value?.a04_daily_evidence||value?.historical_daily_evidence||null;
  const evaluated=volume.evaluate({symbol,tradeDate:identity.trade_date,evidence:raw});
  const price=require('./mother-pool-historical-close-return').evaluate({symbol,tradeDate:identity.trade_date,evidence:raw});
  const gaps=[...evaluated.failed_checks,...price.failed_checks,'HISTORICAL_REFERENCE_AND_LIMIT_PRICE_SOURCE_MISSING','HISTORICAL_PRICE_RULE_CONTRACT_REQUIRED'];
  const readAt=value?.daily_ohlcv_read_at,at=Date.parse(readAt),now=Date.parse(asOf);
  if(!Number.isFinite(at)||!Number.isFinite(now)||at>now||new Date(at+28800000).toISOString().slice(0,10)!==identity.trade_date)gaps.push('HISTORY_READ_TIME_INVALID');
  const sourceProof=value?.historical_source_evidence||null;
  const source=require('./a04-source-evidence.cjs').inspect({symbol,tradeDate:identity.trade_date,raw,proof:sourceProof,readAt,asOf},trustedBinding);
  gaps.push(...source.failed_checks);
  const warmup=require('./a04-warmup-decision.cjs').compose(evaluated,price,source);
  return {symbol,source:'strategy4_daily_ohlcv_view',source_contract:'preopen_a04_volume_price_receipt_v1',source_updated_at:Number.isFinite(at)?readAt:asOf,event_time:asOf,
   history_read_at:readAt||null,raw_source_evidence:sourceProof,a04_warmup: warmup,
   volume_evidence:evaluated,raw_daily_evidence:raw,price_evidence:{close_return:price,limit_up:null,near_limit_up:null},status:'DATA_GAP',data_gap_reason:gaps.join('|'),failed_checks:gaps,formal_candidate_allowed:false,publish_allowed:false,is_synthetic:false,replay:false,look_ahead:false};
 });
 return {...identity,module_id:'A04',created_at:asOf,requested_symbols:requested,rows};
}
module.exports={collect};
