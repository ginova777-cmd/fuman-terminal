'use strict';
const path=require('node:path');
const {buildMarketCalendarContract}=require('../lib/market-calendar-contract');
const {isTwseTradingDay}=require('./twse-trading-day');
const {KEY,seal,validate,dateOf}=require('../lib/market-calendar-display.cjs');
const {upsertSnapshot,readSnapshot}=require('../lib/supabase-snapshots');
async function build({now=new Date(),stateDir=path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','state'),decide=isTwseTradingDay,calendar=buildMarketCalendarContract}={}){
 const today=dateOf(now),decisions=[];
 for(let i=0;i<15;i++){
  const d=await decide(new Date(Date.parse(today+'T12:00:00+08:00')-i*86400000),{stateDir});decisions.push(d);
  if(i>0&&d.isTradingDay===true)break;
 }
 const c=await calendar({now,stateDir});
 // The display publication always records the previous-date proof, even in-session.
 c.previousTradingDate=decisions.at(-1).date;
 return seal(c,decisions,now);
}
async function main(){
 const value=await build();const r=await upsertSnapshot(KEY,value,{tradeDate:value.calendar.requestedDate,source:'windows-market-calendar-display'});
 if(!r.ok)throw Error(r.error||r.reason||'CALENDAR_DISPLAY_PUBLISH_FAILED');
 const readback=await readSnapshot(KEY,{maxAttempts:1,timeoutMs:15000});validate(readback?.payload);
 if(readback.payload.sha256!==value.sha256)throw Error('CALENDAR_DISPLAY_READBACK_MISMATCH');
 console.log(JSON.stringify({ok:true,key:KEY,requestedDate:value.calendar.requestedDate,displayTradeDate:value.calendar.displayTradeDate,sha256:value.sha256}));
}
module.exports={build};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
