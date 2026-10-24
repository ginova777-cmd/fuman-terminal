'use strict';
const crypto=require('node:crypto');
const KEY='market_calendar_display_v1';
function canonical(v){const sort=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(sort):Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;return JSON.stringify(sort(JSON.parse(JSON.stringify(v))));}
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const dateOf=now=>new Date(new Date(now).getTime()+28800000).toISOString().slice(0,10);
function seal(calendar,decisions,now=new Date()){
 const body={contract:'market-calendar-display-v1',scope:'display_only_not_scan_authority',publishedAt:new Date(now).toISOString(),calendar,decisions};
 const value={...body,sha256:hash(body)};validate(value,now);return value;
}
function validate(p,now=new Date()){
 const {sha256,...body}=p||{},c=p?.calendar,t=Date.parse(p?.publishedAt),ms=new Date(now).getTime();
 if(p?.contract!=='market-calendar-display-v1'||p.scope!=='display_only_not_scan_authority'||hash(body)!==sha256||!Number.isFinite(t)||t>ms+30000||ms-t>86400000||c?.requestedDate!==dateOf(now)||c.ok!==true||typeof c.marketOpen!=='boolean')throw Error('CALENDAR_DISPLAY_UNVERIFIED');
 const days=p.decisions;
 if(!Array.isArray(days)||!days.length||days.length>15||days[0].date!==c.requestedDate||days[0].isTradingDay!==c.marketOpen)throw Error('CALENDAR_DISPLAY_CHAIN_MISMATCH');
 for(let i=0;i<days.length;i++){
  const d=days[i],expected=dateOf(new Date(Date.parse(c.requestedDate+'T12:00:00+08:00')-i*86400000));
  if(d.date!==expected||typeof d.isTradingDay!=='boolean'||d.error||!['twse','cache','manual_override','dgpa_auto_update','dgpa_twse_rule'].includes(d.source))throw Error('CALENDAR_DISPLAY_SOURCE_UNVERIFIED');
  if(i>0&&i<days.length-1&&d.isTradingDay)throw Error('CALENDAR_DISPLAY_SKIPPED_OPEN_DAY');
 }
 if(days.length<2||days.at(-1).isTradingDay!==true||days.at(-1).date!==c.previousTradingDate)throw Error('CALENDAR_DISPLAY_PREVIOUS_UNVERIFIED');
 if(!c.marketOpen&&c.displayTradeDate!==c.previousTradingDate)throw Error('CALENDAR_DISPLAY_DATE_MISMATCH');
 return p;
}
function publicPayload(p,now=new Date()){
 validate(p,now);
 const {sourceWindow}=require('./market-calendar-contract');
 const window=sourceWindow(now),open=p.calendar.marketOpen,live=open&&window.inWindow;
 return {...p.calendar,checkedAt:new Date(now).toISOString(),formalSourceWindow:window,formalSourceWindowOpen:live,sourceFreshnessRequired:live,
  marketStatus:open?(live?'open':window.phase):'closed',displayTradeDate:live?p.calendar.requestedDate:p.calendar.previousTradingDate,
  formalScanSkipped:!live,preservePreviousGood:!live,scannerAction:live?'allow_formal_scan':'skip_formal_scan',
  skipReason:live?'':open?'trading_day_'+window.phase:'market_closed',displayMode:live?'live_market':open?'trading_day_wait_source_window_previous_good':'market_closed_previous_good',
  evidenceStatus:live?'complete':open?'waiting_source_window':'market_closed',unattendedStatus:live?'YES':open?'WAITING_SOURCE_WINDOW':'MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD',
  tradingDay:undefined,overrideFile:undefined,lockedBy:undefined,displayEvidence:{contract:p.contract,scope:p.scope,publishedAt:p.publishedAt,sha256:p.sha256}};
}
module.exports={KEY,seal,validate,publicPayload,dateOf};
