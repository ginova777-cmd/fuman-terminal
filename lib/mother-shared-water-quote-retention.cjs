'use strict';
// Retention is not freshness or trading eligibility. The native proof verifier
// still decides FRESH / NO_NEW_TRADE after independent publication readback.
function retainQuote(q,{tradeDate,nowMs,includeSameDayIdle=false}){
 const at=Date.parse(q.quoteSeenAt||q.exchangeTime||q.receivedAt);
 if(!Number.isFinite(at)||at>nowMs)return false;
 if(!includeSameDayIdle)return at>=nowMs-900000;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 if(date!==tradeDate)return false;
 if(q.isSynthetic===true||q.is_synthetic===true||q.isTrial===true||q.is_trial===true)return false;
 return ['fugle-ws-trades','fugle-ws-aggregates','fugle-ws'].includes(q.quoteSource);
}
module.exports={retainQuote};
