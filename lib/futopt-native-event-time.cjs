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
