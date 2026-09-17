'use strict';
async function selectSessions({tradeDate,resolveDay,count=20}) {
 if(typeof tradeDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Number.isFinite(Date.parse(tradeDate))
  ||new Date(tradeDate).toISOString().slice(0,10)!==tradeDate||typeof resolveDay!=='function'||count!==20)throw Error('SESSION_REQUEST_INVALID');
 const dates=[],checks=[];
 const base=Date.parse(tradeDate+'T12:00:00+08:00');
 for(let offset=1;offset<=90&&dates.length<count;offset++) {
  const instant=new Date(base-offset*86400000),date=new Date(instant.getTime()+28800000).toISOString().slice(0,10);
  const result=await resolveDay(instant);
  checks.push({date,...result});
  if(!result||result.date!==date||typeof result.isTradingDay!=='boolean'||!['twse','cache'].includes(result.source)||result.error||result.override===true)
   return {status:'BLOCKED',reason:'HISTORICAL_CALENDAR_UNPROVEN',trade_date:tradeDate,session_dates:[],checks,complete:false};
  if(result.isTradingDay)dates.push(date);
 }
 return {status:dates.length===count?'SESSION_DATES_VERIFIED':'BLOCKED',reason:dates.length===count?null:'HISTORICAL_SESSIONS_INSUFFICIENT',
  trade_date:tradeDate,session_dates:dates.reverse(),checks,complete:false};
}
module.exports={selectSessions};
