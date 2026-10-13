'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {verifyCalendarReadback: verify} = require('../lib/a04-calendar-readback.cjs');
const now = Date.parse('2026-10-13T07:02:02Z'), date = '2026-10-12';
const annual = [
  {Name:'元旦',Date:'1150101',Weekday:'四',Description:'休市'},
  {Name:'國慶日',Date:'1151009',Weekday:'五',Description:'休市'}
];
const row = {market:'TW',trade_date:date,is_open:true,updated_at:'2026-10-13T06:00:00Z',payload:{
  override:false,source:'daytrade-source-writer:twse-trading-day',calendar_contract:'market-calendar-contract-v1',
  calendar_publication_contract:'calendar-horizon-v1',
  calendar_source_sha256:crypto.createHash('sha256').update(JSON.stringify(annual)).digest('hex'),
  calendar_decision:{date,isTradingDay:true,source:'cache',calendar_evidence:{source:'cache',year:2026,
    source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetched_at:'2026-10-13T00:00:00Z',rows:annual}}
}};
let checks=0;
assert.equal(verify(row,date,now).mode,'exact'); checks++;
const reordered = structuredClone(row);
reordered.payload.calendar_decision.calendar_evidence.rows = annual.map(r=>({Date:r.Date,Name:r.Name,Weekday:r.Weekday,Description:r.Description}));
const opts={allowLegacySerialization:true};
assert.throws(()=>verify(reordered,date,now)); checks++;
assert.equal(verify(reordered,date,now,opts).sha256,row.payload.calendar_source_sha256); checks++;
for(const mutate of [
 r=>r.market='US',r=>r.trade_date='2026-10-11',r=>r.is_open=false,r=>r.payload.override=true,
 r=>r.payload.source='fake',r=>r.payload.calendar_contract='fake',r=>r.payload.calendar_publication_contract='fake',
 r=>r.updated_at='invalid',r=>r.updated_at='2026-10-14T00:00:00Z',r=>r.payload.calendar_source_sha256='0'.repeat(64),
 r=>r.payload.calendar_decision.source='fallback',r=>r.payload.calendar_decision.override=true,
 r=>r.payload.calendar_decision.calendar_evidence.source_url='fake',
 r=>r.payload.calendar_decision.calendar_evidence.year=2025,
 r=>r.payload.calendar_decision.calendar_evidence.fetched_at='2026-10-01T00:00:00Z',
 r=>r.payload.calendar_decision.calendar_evidence.fetched_at='2026-10-14T00:00:00Z',
 r=>r.payload.calendar_decision.calendar_evidence.rows.reverse(),
 r=>r.payload.calendar_decision.calendar_evidence.rows[0].Extra='value',
 r=>r.payload.calendar_decision.calendar_evidence.rows[0].Name={value:'元旦'},
 ...['Date','Name','Weekday','Description'].map(k=>r=>r.payload.calendar_decision.calendar_evidence.rows[0][k]+='changed'),
 r=>r.payload.calendar_decision.calendar_evidence.rows.push({Name:'休市',Date:'1151012',Weekday:'一',Description:'休市'})
]){const r=structuredClone(reordered);mutate(r);assert.throws(()=>verify(r,date,now,opts));checks++;}
assert.throws(()=>verify(row,date,NaN,opts)); checks++;
assert.throws(()=>verify(reordered,date,now,{allowLegacySerialization:'true'})); checks++;
console.log(JSON.stringify({ok:true,checks,production_calls:0,source_binding:'UNBOUND'}));
