'use strict';
const assert=require('node:assert/strict');
const {previousSession}=require('../lib/daytrade-preopen-history-calendar');
const date='2026-09-29',asOf=date+'T08:00:00+08:00';
const calendar={trade_date:date,market:'TW',is_open:true,payload:{checked_at:asOf,calendar_decision:{date,isTradingDay:true,source:'cache',calendar_evidence:{year:2026,source:'cache',source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetched_at:date+'T06:00:00+08:00',rows:[{Date:'1150928',Name:'休市'},{Date:'1150925',Name:'休市'}]}}}};
assert.equal(previousSession(calendar,date,asOf),'2026-09-24');
for(const mutate of [c=>c.payload.calendar_decision.override=true,c=>c.payload.calendar_decision.calendar_evidence.fetched_at='2026-09-01T00:00:00Z',c=>c.payload.calendar_decision.calendar_evidence.rows.push({Date:'1150928',Name:'補行交易'}),c=>c.payload.calendar_decision.calendar_evidence.source_url='invalid']) {
 const c=structuredClone(calendar);mutate(c);assert.throws(()=>previousSession(c,date,asOf));
}
console.log('PASS isolated calendar fixtures: consecutive holidays/weekend, override, stale evidence, duplicate date, wrong source URL');

