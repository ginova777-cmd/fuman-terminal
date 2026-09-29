'use strict';
const assert=require('node:assert/strict'),{evaluate}=require('../lib/mother-pool-historical-volume');
const tradeDate='2026-09-29',symbol='2330',checks=[];
for(let n=1;n<=23;n++){const d=new Date(Date.parse(tradeDate+'T00:00:00Z')-n*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())});}
const calendar={trade_date:tradeDate,status:'SESSION_DATES_VERIFIED',checks};
const dates=require('../lib/mother-pool-daily-volume-baseline').datesFromCalendar(calendar,tradeDate,15);
const rows=dates.map(trade_date=>({symbol,trade_date,volume_lots:100}));
const evidence={symbol,trade_date:tradeDate,source:'strategy4_daily_ohlcv_view',volume_unit:'LOTS',calendar,rows};
for(const value of [199,200,249,250]){rows[5].volume_lots=value;const r=evaluate({symbol,tradeDate,evidence}),d=r.days[0];assert.equal(d.avg_volume5,100);assert.equal(d.volume_2x_flag,value>=200);assert.equal(d.volume_2_5x_flag,value>=250);assert.equal(r.volume_2x_dates.includes(d.source_date),value>=200);assert.equal(r.volume_2_5x_dates.includes(d.source_date),value>=250);assert(!d.baseline_dates.includes(d.source_date));}
rows[0].volume_lots=NaN;const gap=evaluate({symbol,tradeDate,evidence});assert.equal(gap.days[0].volume_2x_flag,null);assert.equal(gap.days[0].volume_2_5x_flag,null);assert.equal(gap.status,'DATA_GAP');
console.log('PASS A04 independent 2x/2.5x boundaries, prior-five denominator and null flags on missing evidence');
