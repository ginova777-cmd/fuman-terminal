'use strict';
const asOf='2026-10-08T04:45:00.000Z';
function quote(symbol, price=100, volume=10000, eventAt=asOf) { return {symbol,source:'fugle_websocket_OFFLINE_FIXTURE',trade_date:'2026-10-08',last_trade_time:eventAt,price,previous_close:100,open_price:100,high_price:104,low_price:99,total_volume:volume,trade_value:price*volume*1000,quote_seen_at:eventAt,updated_at:eventAt,
 payload:{turnoverVolumeEvidence:{value:volume,unit:'lots',event_at:eventAt,source:'isolated_fixture',is_synthetic:false}}}; }
function fixture(n=2000) {
 const activeSymbols=[],quoteMap=[],dailyVolumeMap=[],intradayMap=[];
 for(let i=0;i<n;i++) {
  const symbol=String(1000+i);activeSymbols.push({symbol,name:'OFFLINE-'+symbol,market:'TSE',stockType:'common',isActive:true,hasFormalDaytradeUniverseEvidence:true,
   turnoverMaster:{official_issued_common_shares:1e8,stock_master_source:'MOPS_OPEN_DATA_TWSE_TPEX',official_present:true,stock_master_source_date:'2026-10-07',stock_master_synced_at:'2026-10-08T00:00:00Z'}});
  quoteMap.push([symbol,quote(symbol,100+(i%20)/10,10000+i)]);
  dailyVolumeMap.push([symbol,{avg_volume5:5000,avg_volume3:5000,avg_volume3_sample_days:3,volume:6000}]);
  intradayMap.push([symbol,{ma3:100,ma5:99,ma10:98,ma20:97,today_candle_count:200,first_candle_time:'2026-10-08T01:00:00Z',latest_candle_time:'2026-10-08T04:44:00Z',latest_candle_age_seconds:60}]);
 }
 return {epoch:'isolated-epoch',sequence:0,tradeDate:'2026-10-08',identity:{trade_date:'2026-10-08',canonical_run_id:'fugle_daytrade_source:20261008:canonical',writer_run_id:'isolated-writer-1',generation_id:'isolated-generation'},activeSymbols,quoteMap,dailyVolumeMap,supplementalMaps:{intradayMap},artifacts:{}};
}
module.exports={asOf,quote,fixture};
