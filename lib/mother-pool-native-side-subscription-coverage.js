'use strict';
function inspect(selection){
 const requested=[...new Set(selection.allSymbols||[])];
 const trades=new Set(selection.quoteRadarChannel==='trades'?selection.quoteRadarSymbols||[]:[]);
 const aggregates=new Set(selection.aggregateRadarChannel==='aggregates'?selection.aggregateRadarSymbols||[]:[]);
 const paired=requested.filter(s=>trades.has(s)&&aggregates.has(s));
 return {contract:'mother_pool_native_side_subscription_coverage_v1',scope:'planned_current_connection_not_acknowledged_or_historical_samples',requested_count:requested.length,paired_count:paired.length,coverage_pct:requested.length?paired.length/requested.length*100:0,
  missing_trade_symbols:requested.filter(s=>!trades.has(s)),missing_aggregate_symbols:requested.filter(s=>!aggregates.has(s)),
  planned_full_coverage:requested.length>0&&paired.length===requested.length,complete:false};
}
module.exports={inspect};
