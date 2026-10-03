'use strict';
function nativeTime(value){
 const n=typeof value==='number'?value:NaN;
 if(!Number.isSafeInteger(n)||n<1e14)return null;
 const ms=Math.floor(n/1000);return Number.isFinite(new Date(ms).getTime())?new Date(ms).toISOString():null;
}
function futuresEventTime(quote,nowMs){
 const p=quote?.payload||{},event=nativeTime(p.lastUpdated)||nativeTime(p.lastTrade?.time),received=Date.parse(quote?.quoteSeenAt||'');
 if(!event)return {ok:false,reason:'FUTURE_NATIVE_EVENT_TIME_MISSING'};
 if(!Number.isFinite(nowMs)||Date.parse(event)>nowMs)return {ok:false,reason:'FUTURE_EVENT_IN_FUTURE'};
 if(!Number.isFinite(received)||received>nowMs||received<Date.parse(event))return {ok:false,reason:'FUTURE_RECEIVE_TIME_INVALID'};
 return {ok:true,event_at:event,received_at:new Date(received).toISOString(),source_field:nativeTime(p.lastUpdated)?'lastUpdated':'lastTrade.time'};
}
module.exports={futuresEventTime};
