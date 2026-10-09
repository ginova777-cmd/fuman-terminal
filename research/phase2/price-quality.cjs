'use strict';
// Price-only quality path. No volume is synthesized to satisfy the volume mapper.
const {finite}=require('../../lib/daytrade-fast-candle-row.js');
function priceOnly(c,{tradeDate,nowMs}){
 if(!c||c.source!=='fugle-ws-candles'||c.sourceChannel!=='candles'||c.candleOrigin!=='websocket_candle'||c.restRepairRow===true||c.intradayOddLot!==false||c.synthetic!==false||c.payload?.is_synthetic===true||c.payload?.type==='INDEX')return null;
 const market=String(c.market||c.payload?.market||'').toUpperCase(),unit=market==='ESB'?'shares':['TSE','TWSE','OTC','TPEX','TIB'].includes(market)?'lots':null;
 const t=Date.parse(c.candleTime||c.date),seen=Date.parse(c.candleSeenAt),symbol=String(c.symbol||c.code||''),v=['open','high','low','close'].map(k=>finite(c[k]));
 if(!unit||!/^\d{4}$/.test(symbol)||!Number.isFinite(t)||t%60000||t+60000>nowMs||!Number.isFinite(seen)||seen<t||seen>nowMs||c.tradeDate!==tradeDate||new Date(t+28800000).toISOString().slice(0,10)!==tradeDate||v.some(x=>x===null||x<=0))return null;
 const [open,high,low,close]=v;if(high<Math.max(open,close,low)||low>Math.min(open,close,high))return null;
 return {symbol,market,trade_date:tradeDate,candle_time:new Date(t).toISOString(),open,high,low,close,volume:null,updated_at:new Date(seen).toISOString(),source:'fugle_daytrade_fast_sync:websocket_candles',synthetic:false,volume_strategy_usable:false,price_strategy_usable:true,payload:{volume_unit:unit,quality_reason:'VOLUME_UNUSABLE_PRICE_PRESERVED',originalSource:c.source,originalChannel:c.sourceChannel,raw_volume:c.volume??null}};
}
module.exports={priceOnly};
