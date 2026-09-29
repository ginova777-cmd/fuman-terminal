'use strict';
// The collector retains the session; an age-filtered quote cache is not a
// complete source for Opening Range or point-in-time session extremes.
function select({payload,tradeDate,asOf}) {
 const now=Date.parse(asOf);
 if(!Number.isFinite(now)||new Date(now+28800000).toISOString().slice(0,10)!==tradeDate||!Array.isArray(payload?.candles))throw Error('SESSION_CANDLE_SOURCE_INVALID');
 return payload.candles.filter(row=>{
  const time=Date.parse(row?.candleTime||row?.date||'');
  const day=Number.isFinite(time)?new Date(time+28800000).toISOString().slice(0,10):null;
  if(day!==tradeDate&&row?.tradeDate!==tradeDate)return false;
  // Only the current, not-yet-complete minute is inapplicable. Malformed or
  // future rows remain inputs so the strict producer can reject them.
  if(Number.isFinite(time)&&time<=now&&time+60000>now)return false;
  return true;
 });
}
module.exports={select};
