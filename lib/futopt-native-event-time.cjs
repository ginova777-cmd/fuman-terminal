'use strict';
function nativeEventAt(quote,nowMs=Date.now()) {
 const raw=quote?.payload;
 if(!raw||typeof raw!=='object'||raw.symbol!==quote.future_symbol||raw.isSynthetic===true||raw.is_synthetic===true)return null;
 const value=raw.lastUpdated??raw.time??raw.lastTrade?.time;
 if(!Number.isSafeInteger(value)||value<=0)return null;
 const ms=value/1000;
 if(!Number.isFinite(new Date(ms).getTime())||ms>nowMs)return null;
 return new Date(Math.floor(ms)).toISOString();
}
module.exports={nativeEventAt};

function nativePrice(raw) {
 const value=raw?.lastPrice??raw?.closePrice??raw?.price??raw?.lastTrade?.price;
 return typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
}
module.exports.nativePrice=nativePrice;

function finiteNative(value,minimum=-Infinity,exclusive=false) {
 if(typeof value!=='number'||!Number.isFinite(value))return null;
 return (exclusive?value>minimum:value>=minimum)?value:null;
}
function nativeQuoteFields(raw) {
 return {
  open_price:finiteNative(raw?.openPrice,0,true),
  high_price:finiteNative(raw?.highPrice,0,true),
  low_price:finiteNative(raw?.lowPrice,0,true),
  previous_close:finiteNative(raw?.previousClose,0,true),
  change_percent:finiteNative(raw?.changePercent),
  total_volume:Number.isSafeInteger(raw?.total?.tradeVolume)&&raw.total.tradeVolume>=0?raw.total.tradeVolume:null,
 };
}
module.exports.nativeQuoteFields=nativeQuoteFields;
