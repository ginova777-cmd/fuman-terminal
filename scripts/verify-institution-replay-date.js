"use strict";
const assert = require('assert');
const path = require('path');
const {isTwseTradingDay}=require('./twse-trading-day');
async function verifyReplayDate(date, now=new Date()) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), 'invalid replay trade date');
  const target=new Date(date+'T13:30:00+08:00');
  assert(Number.isFinite(+target)&&target.toISOString().slice(0,10)===date&&target<=now,'replay date must be completed');
  const stateDir=path.join(process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','state');
  const status=await isTwseTradingDay(target,{stateDir});
  assert(status.isTradingDay&&!/fallback/.test(status.source+' '+status.reason),'replay date not verified trading day');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(now);
  for(let d=new Date(today+'T13:30:00+08:00'),i=0;i<31;i++,d.setUTCDate(d.getUTCDate()-1)){
    if(d>now)continue;
    const s=await isTwseTradingDay(d,{stateDir});
    assert(!/fallback/.test(s.source+' '+s.reason),'market calendar unavailable');
    if(s.isTradingDay){assert(s.date===date,'replay must use latest completed trading day');return {ok:true,requestedDate:today,tradeDate:date,mode:'strategy_revision_replay',calendarSource:s.source};}
  }
  throw Error('latest completed trading day not found');
}
if(require.main===module)verifyReplayDate(process.argv[2]||process.env.FUMAN_REPLAY_TRADE_DATE||'').then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verifyReplayDate};
