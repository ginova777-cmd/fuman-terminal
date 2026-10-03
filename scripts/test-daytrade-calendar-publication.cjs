'use strict';
const assert=require('node:assert/strict');
const {buildCalendarPublication,validateDecision}=require('../lib/daytrade-calendar-publication.cjs');
const now=new Date('2026-10-03T09:00:00+08:00');
const annual=[{Date:'1150101',Description:'休市'},{Date:'1151009',Description:'國慶日補假休市'}];
function decision(probe){const date=new Date(probe.getTime()+28800000).toISOString().slice(0,10);return {date,isTradingDay:!['2026-10-03','2026-10-04','2026-10-09','2026-10-10','2026-10-11'].includes(date),source:'cache',reason:'official_annual_schedule',calendar_evidence:{source:'cache',year:2026,source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetched_at:'2026-10-03T00:00:00Z',rows:annual}};}
(async()=>{const rows=await buildCalendarPublication({now,decide:async p=>decision(p)});assert.equal(rows.length,10);assert.equal(rows[0].is_open,false);assert.equal(rows[2].is_open,true);assert.equal(rows[2].trade_date,'2026-10-05');assert.equal(rows[6].is_open,false);assert.equal(rows[0].session,'closed');assert.equal(rows[2].session,'scheduled');
for(const mutate of [d=>d.source='weekend_fallback',d=>d.calendar_evidence.fetched_at='2026-09-01T00:00:00Z',d=>d.calendar_evidence.year=2025,d=>d.isTradingDay='false',d=>d.isTradingDay=true,d=>d.override=true,d=>d.calendar_evidence.rows=[]]){const d=structuredClone(decision(now));mutate(d);assert.throws(()=>validateDecision(d,'2026-10-03',now.getTime()));}
await assert.rejects(()=>buildCalendarPublication({now,days:20}));
console.log(JSON.stringify({ok:true,tests:'holiday/weekend/next-open/source/age/year/type/conflict/override/bounds',isolated:true,natural_session:false}));})().catch(e=>{console.error(e);process.exitCode=1});
