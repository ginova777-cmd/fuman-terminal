'use strict';
const assert=require('node:assert/strict'),{build,verify,datesFromCalendar}=require('../lib/mother-pool-daily-volume-baseline');
const tradeDate='2026-09-18',checks=[];
for(let i=1;i<=20;i++){const d=new Date(Date.parse(tradeDate+'T00:00:00Z')-i*86400000),date=d.toISOString().slice(0,10);checks.push({date,source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())&&date!=='2026-09-16'});}
const calendar={trade_date:tradeDate,status:'SESSION_DATES_VERIFIED',checks};
const dates=datesFromCalendar(calendar,tradeDate);assert.equal(dates.length,5);assert(!dates.includes('2026-09-16'));assert(!dates.includes(tradeDate));
const rows=dates.map((trade_date,i)=>({symbol:'2330',trade_date,volume_lots:(i+1)*100})),input={symbol:'2330',tradeDate,calendar,rows};
const result=build(input);assert.equal(result.avg_volume5,300);assert.equal(verify(result),true);
assert.equal(build({...input,rows:rows.slice(1)}).status,'DATA_GAP');
assert.equal(build({...input,rows:[...rows,rows[0]]}).status,'DATA_GAP');
assert.equal(build({...input,rows:rows.map((r,i)=>i? r:{...r,volume_lots:null})}).status,'DATA_GAP');
assert.equal(build({...input,rows:rows.map(r=>({...r,volume_lots:0}))}).status,'DATA_GAP');
assert.equal(verify({...result,avg_volume5:301}),false);
const bad=structuredClone(calendar);bad.checks.splice(1,1);assert.throws(()=>build({...input,calendar:bad}),/CALENDAR_INVALID/);
const wrong=structuredClone(calendar);wrong.checks[0].source='weekday_guess';assert.throws(()=>build({...input,calendar:wrong}),/CALENDAR_INVALID/);
for(const flag of ['synthetic','is_synthetic','replay','look_ahead'])assert.equal(build({...input,rows:rows.map((r,i)=>i?r:{...r,[flag]:true})}).status,'DATA_GAP');
assert.throws(()=>datesFromCalendar(calendar,tradeDate,0),/SESSION_COUNT_INVALID/);
assert.throws(()=>datesFromCalendar(calendar,'2026-02-30'),/TRADE_DATE_INVALID/);
const long=structuredClone(calendar);
for(let i=21;i<=35;i++){const d=new Date(Date.parse(tradeDate+'T00:00:00Z')-i*86400000);long.checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
const fifteen=datesFromCalendar(long,tradeDate,15);assert.equal(fifteen.length,15);assert.deepEqual(fifteen.slice(-5),dates);
assert.throws(()=>datesFromCalendar(calendar,tradeDate,20),/COMPLETED_SESSIONS_REQUIRED/);
console.log(JSON.stringify({status:'passed',scope:'isolated',checks:17,production_complete:false}));

