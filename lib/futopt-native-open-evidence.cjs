'use strict';
const crypto=require('node:crypto');
function inspect(raw,{futureSymbol,tradeDate,capturedAt}) {
 const r=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const captured=Date.parse(capturedAt),reasons=[];
 const time=Number.isSafeInteger(r.openTime)&&r.openTime>0?r.openTime/1000:NaN;
 const validTime=Number.isFinite(time)&&Number.isFinite(new Date(time).getTime());
 const iso=validTime?new Date(Math.floor(time)).toISOString():null;
 const local=validTime?new Date(time+28800000):null;
 if(!/^[A-Z0-9]+$/.test(futureSymbol||'')||r.symbol!==futureSymbol)reasons.push('CONTRACT_MISMATCH');
 if(r.date!==tradeDate)reasons.push('TRADE_DATE_MISMATCH');
 if(r.type!=='FUTURE'||r.exchange!=='TAIFEX')reasons.push('REGULAR_FUTURE_SOURCE_UNCONFIRMED');
 if(typeof r.openPrice!=='number'||!Number.isFinite(r.openPrice)||r.openPrice<=0)reasons.push('NATIVE_OPEN_PRICE_MISSING_OR_INVALID');
 if(!validTime)reasons.push('NATIVE_OPEN_TIME_MISSING_OR_INVALID');
 else if(local.toISOString().slice(0,10)!==tradeDate||local.getUTCHours()*60+local.getUTCMinutes()<525||local.getUTCHours()*60+local.getUTCMinutes()>825)reasons.push('OPEN_OUTSIDE_REGULAR_SESSION');
 if(!Number.isFinite(captured)||!/(Z|[+-]\d{2}:\d{2})$/.test(capturedAt||''))reasons.push('CAPTURE_TIME_INVALID');
 else if(validTime&&time>captured)reasons.push('OPEN_EVENT_IN_FUTURE');
 if(r.isSynthetic===true||r.is_synthetic===true)reasons.push('SYNTHETIC_SOURCE');
 return {contract:'fugle-futopt-native-open-v1',status:reasons.length?'UNCONFIRMED':'CONFIRMED',future_symbol:futureSymbol,trade_date:tradeDate,
  price:reasons.length?null:r.openPrice,event_at:reasons.length?null:iso,captured_at:capturedAt,
  source:'fugle.futopt.native.openPrice/openTime',raw_open_price:r.openPrice??null,raw_open_time:r.openTime??null,
  raw_sha256:crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'),raw_evidence:r,reasons,
  exact_0845_minute:reasons.length?false:local.getUTCHours()===8&&local.getUTCMinutes()===45,
  historical_availability_proven:false};
}
module.exports={inspect};
