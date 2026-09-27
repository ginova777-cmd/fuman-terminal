'use strict';
const {adaptDaily}=require('./premarket-daily-source.cjs');
const {digest}=require('./premarket-plan-contract.cjs');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const local=t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+28800000).toISOString():'';
// Accept existing lightweight preopen history rows or captured Fugle quote rows.
// Never fall back to actual opening price or the user's example trial price.
function trialAt0859({rows,symbol,tradeDate,asOf,startMinute='08:59'}){
 const candidates=[];
 for(const raw of rows||[]){
  let timestamp,price,source;
  if(raw.symbol===symbol&&raw.trade_date===tradeDate&&raw.is_trial===true&&raw.payload?.source==='fugle-websocket-cache:trial-event'){
   timestamp=raw.observed_at||raw.updated_at;price=raw.trial_price;source=raw.payload.source;
   if(raw.payload.observed_at!==timestamp||raw.payload.trade_date!==tradeDate)continue;
  }else if(String(raw.code||raw.symbol)===symbol&&raw.quoteSource==='fugle-ws'&&raw.isSynthetic===false){
   timestamp=raw.trialEventAt;price=raw.trialPrice;source='Fugle.websocket.trialEventAt';
  }else continue;
  const stamp=local(timestamp);
  if(stamp.slice(0,10)!==tradeDate||stamp.slice(11,16)<startMinute||stamp.slice(11,16)>'08:59'||Date.parse(timestamp)>Date.parse(asOf)||!finite(price)||price<=0)continue;
  candidates.push({timestamp,price,source,source_sha256:digest(raw),verified:true});
 }
 candidates.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
 if(candidates.length>1&&candidates.some(c=>Date.parse(c.timestamp)===Date.parse(candidates[0].timestamp)&&c.price!==candidates[0].price))return {verified:false,price:null,reason:'CONFLICTING_0859_TRIAL'};
 return candidates[0]||{verified:false,price:null,reason:'VALID_0859_TRIAL_MISSING'};
}
// Explicit calendar date list is supplied by the calendar collector and retained
// in provenance. The validator never infers a trading day from weekday alone.
function checkCalendar({calendar,history,baseDate,tradeDate}){
 const days=calendar?.trading_dates;
 if(calendar?.verified!==true||!Array.isArray(days)||!days.length||!calendar.source)return {complete:false,reason:'CALENDAR_EVIDENCE_MISSING'};
 if(days.some((d,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||(i&&days[i-1]>=d)))return {complete:false,reason:'CALENDAR_DATES_INVALID'};
 const index=days.indexOf(tradeDate);
 if(index<1||days[index-1]!==baseDate)return {complete:false,reason:'PREVIOUS_TRADING_DAY_MISMATCH'};
 const actual=(history||[]).map(b=>b.date),expected=days.filter(d=>d>=actual[0]&&d<=baseDate);
 if(!actual.length||actual[0]<days[0]||digest(actual)!==digest(expected))return {complete:false,reason:'DAILY_HISTORY_CALENDAR_GAP'};
 return {complete:true,reason:null,source:calendar.source,sha256:digest(calendar)};
}
function sourceFor({source,symbol,baseDate,tradeDate,asOf,trialRows,calendar}){
 const freeze=tradeDate+'T08:59:59.999+08:00';
 const daily=adaptDaily({source,symbol,baseDate,tradeDate,asOf:Date.parse(asOf)<Date.parse(freeze)?asOf:freeze});
 const trial=trialAt0859({rows:trialRows,symbol,tradeDate,asOf});
 const calendarProof=checkCalendar({calendar,history:daily.history,baseDate,tradeDate});
 const blockers=[];
 if(!daily.complete)blockers.push(daily.reason||'DAILY_INPUT_INCOMPLETE');
 if(!trial.verified)blockers.push(trial.reason);
 if(!calendarProof.complete)blockers.push(calendarProof.reason);
 return {daily,trial,calendar:calendarProof,blockers,source_sha256:digest(source||null)};
}
function trialAtPreopen(input){return trialAt0859({...input,startMinute:'08:45'});}
module.exports={trialAt0859,trialAtPreopen,checkCalendar,sourceFor};
