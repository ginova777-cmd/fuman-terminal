'use strict';
const crypto=require('node:crypto');
const {isTwseTradingDay,isClosedRow,isExplicitTradingRow}=require('../scripts/twse-trading-day');
const URL='https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';
const dateOf=ms=>new Date(ms+28800000).toISOString().slice(0,10);
function validateDecision(d,date,nowMs){
 const e=d?.calendar_evidence,year=Number(date.slice(0,4)),roc=String(year-1911),fetched=Date.parse(e?.fetched_at);
 if(d?.date!==date||typeof d.isTradingDay!=='boolean'||d.override===true||d.error||!['cache','twse'].includes(d.source)||e?.source!==d.source||e.source_url!==URL||e.year!==year||!Number.isFinite(fetched)||fetched>nowMs||nowMs-fetched>7*86400000)throw Error('CALENDAR_SOURCE_UNVERIFIED:'+date);
 if(!Array.isArray(e.rows)||!e.rows.length||!e.rows.some(r=>String(r.Date).startsWith(roc)))throw Error('CALENDAR_YEAR_UNVERIFIED:'+date);
 const key=roc+date.slice(5,7)+date.slice(8,10),matches=e.rows.filter(r=>String(r.Date)===key);
 if(matches.length>1)throw Error('CALENDAR_DATE_CONFLICT:'+date);
 const row=matches[0],weekend=[0,6].includes(new Date(date+'T12:00:00+08:00').getUTCDay());
 // The decision must agree with the full official annual schedule, including
 // special trading days. Never publish from weekday-only fallback.
 const open=row&&isExplicitTradingRow(row)?true:row&&isClosedRow(row)?false:!weekend;
 if(open!==d.isTradingDay)throw Error('CALENDAR_DECISION_CONFLICT:'+date);
 return crypto.createHash('sha256').update(JSON.stringify(e.rows)).digest('hex');
}
async function buildCalendarPublication({now=new Date(),stateDir,days=10,pastDays=0,decide=isTwseTradingDay}={}){
 if(!Number.isInteger(pastDays)||pastDays<0||pastDays>40)throw Error('CALENDAR_LOOKBACK_INVALID');
 if(!Number.isInteger(days)||days<1||days>14)throw Error('CALENDAR_HORIZON_INVALID');
 const nowMs=new Date(now).getTime();if(!Number.isFinite(nowMs))throw Error('CALENDAR_NOW_INVALID');
 const checkedAt=new Date(nowMs).toISOString(),date=dateOf(nowMs),rows=[];
 for(const i of [...Array.from({length:days},(_,n)=>n),...Array.from({length:pastDays},(_,n)=>-n-1)]){
  const probe=new Date(Date.parse(date+'T12:00:00+08:00')+i*86400000),key=dateOf(probe.getTime());
  const decision=await decide(probe,{stateDir,includeEvidence:true});
  const hash=validateDecision(decision,key,nowMs);
  const minute=new Date(nowMs+28800000).getUTCHours()*60+new Date(nowMs+28800000).getUTCMinutes();
  const session=!decision.isTradingDay||i<0?'closed':i?'scheduled':minute<540?'preopen':minute<=810?'regular':'closed';
  rows.push({trade_date:key,market:'TW',is_open:decision.isTradingDay,session,note:decision.reason,updated_at:checkedAt,payload:{source:'daytrade-source-writer:twse-trading-day',checked_at:checkedAt,calendar_contract:'market-calendar-contract-v1',calendar_decision:decision,calendar_source_sha256:hash,calendar_publication_contract:'calendar-horizon-v1',override:false,reason:decision.reason,future_schedule:i>0,historical_calendar_evidence:i<0,historical_publication_available_at:i<0?checkedAt:null,schedule_subject_to_official_revision:true}});
 }
 return rows;
}
module.exports={buildCalendarPublication,validateDecision};
