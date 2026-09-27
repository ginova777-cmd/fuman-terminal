'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {calendarFromCache}=require('./premarket-runtime-inputs.cjs');
function collect({runtimeRoot,now}){
 const time=Date.parse(now);if(!Number.isFinite(time))throw Error('SOURCE_CLOCK_REQUIRED');
 const date=new Date(time+28800000).toISOString().slice(0,10),files=[],blockers=[];
 const read=(file,fallback)=>{try{const bytes=fs.readFileSync(file),payload=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));files.push({path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});return payload;}catch(e){blockers.push({source:file,reason:e.code==='ENOENT'?'SOURCE_FILE_MISSING':'SOURCE_FILE_UNREADABLE'});return fallback;}};
 const snapshot=read(path.join(runtimeRoot,'data/opening-limit-order',`opening-limit-order-0850-static-sources-${date.replaceAll('-','')}.json`),{symbols:[]});
 if(!Array.isArray(snapshot.symbols))throw Error('STATIC_SYMBOLS_INVALID');
 const quotes=read(path.join(runtimeRoot,'cache/intraday/fugle-daytrade-ws-quotes-v2.json'),{quotes:[]});
 const archived=require('./trial-evidence-store.cjs').load({runtimeRoot,tradeDate:date,asOf:now});files.push(...archived.files);
 const trialRows=[...archived.rows,...(Array.isArray(quotes.quotes)?quotes.quotes:[])];
 // Only request years needed to prove today's immediately preceding session.
 // Old indicator history must not force another year's calendar acquisition.
 const lastYear=Number(date.slice(0,4));
 const currentCalendar=calendarFromCache({runtimeRoot,tradeDate:date});
 const firstYear=currentCalendar.trading_dates.some(d=>d<date)?lastYear:lastYear-1;
 const calendars=[];for(let year=firstYear;year<=lastYear;year++){const p=calendarFromCache({runtimeRoot,tradeDate:year+'-12-31'});calendars.push(p);read(path.join(runtimeRoot,'state',`twse-holiday-schedule-${year}.json`),null);}
 const calendar={verified:calendars.every(c=>c.verified),source:'cached_twse_calendar_range',trading_dates:[...new Set(calendars.flatMap(c=>c.trading_dates))].sort(),years:calendars};
 const index=calendar.trading_dates.indexOf(date),baseDate=index>0?calendar.trading_dates[index-1]:null;
 if(!baseDate)blockers.push({source:'calendar',reason:'PREVIOUS_TRADING_DAY_NOT_PROVEN'});
 const universe=read(path.join(runtimeRoot,'data/telegram-detectors',date,'universe.json'),null);
 return {snapshot,trialRows,calendar,universe,tradeDate:date,baseDate,now,files,blockers};
}
module.exports={collect};
