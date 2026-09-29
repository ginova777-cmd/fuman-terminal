'use strict';
const assert=require('node:assert/strict'),{evaluate}=require('../lib/mother-pool-historical-close-return');
const tradeDate='2026-09-29',symbol='2330',checks=[];
for(let n=1;n<=30;n++){const d=new Date(Date.parse(tradeDate+'T00:00:00Z')-n*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
const calendar={trade_date:tradeDate,status:'SESSION_DATES_VERIFIED',checks},dates=require('../lib/mother-pool-daily-volume-baseline').datesFromCalendar(calendar,tradeDate,15);
const evidence={symbol,trade_date:tradeDate,source:'strategy4_daily_ohlcv_view',calendar,rows:dates.map(trade_date=>({symbol,trade_date,close:100}))};
for(const close of [106.99,107,108]){evidence.rows[5].close=close;const r=evaluate({symbol,tradeDate,evidence});assert.equal(r.days[0].return_7pct_flag,close>=107);assert.equal(r.days[0].previous_completed_date,dates[4]);assert.equal(r.days.length,10);assert.equal(r.status,'READY');}
for(const modify of [e=>e.rows.splice(4,1),e=>e.rows.push({...e.rows[5]}),e=>e.rows[5].close=0,e=>e.rows[5].synthetic=true,e=>e.rows[5].close='107']){const e=structuredClone(evidence);modify(e);const r=evaluate({symbol,tradeDate,evidence:e});assert.equal(r.status,'DATA_GAP');assert.equal(r.days[0].return_7pct_flag,null);}
console.log('PASS historical close returns: prior completed date, 7% boundary, missing/duplicate/non-natural/invalid closes');
