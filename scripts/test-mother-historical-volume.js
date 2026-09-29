'use strict';
const assert=require('node:assert/strict'),{evaluate}=require('../lib/mother-pool-historical-volume'),{datesFromCalendar}=require('../lib/mother-pool-daily-volume-baseline');
const tradeDate='2026-09-18',checks=[];
for(let i=1;i<=35;i++){const d=new Date(Date.parse(tradeDate+'T00:00:00Z')-i*86400000);checks.push({date:d.toISOString().slice(0,10),source:'cache',isTradingDay:![0,6].includes(d.getUTCDay())&&d.toISOString().slice(0,10)!=='2026-09-16'});}
const calendar={trade_date:tradeDate,status:'SESSION_DATES_VERIFIED',checks},dates=datesFromCalendar(calendar,tradeDate,15);
const evidence={symbol:'2330',trade_date:tradeDate,source:'strategy4_daily_ohlcv_view',volume_unit:'LOTS',calendar,rows:dates.map((trade_date,i)=>({symbol:'2330',trade_date,volume_lots:i===14?250:100}))};
const run=e=>evaluate({symbol:'2330',tradeDate,evidence:e}),good=run(evidence);
assert.equal(good.status,'READY');assert.equal(good.days.length,10);assert.equal(good.days.at(-1).volume_ratio,2.5);assert.deepEqual(good.matched_dates,[dates.at(-1)]);
assert(good.days.every(d=>d.baseline_dates.length===5&&d.baseline_dates.every(b=>b<d.source_date)));
for(const change of [e=>e.rows.pop(),e=>e.rows.push({...e.rows[0]}),e=>e.rows[0].volume_lots=null,e=>e.rows[0].synthetic=true,e=>e.rows[0].replay=true,e=>e.rows[0].look_ahead=true,e=>e.volume_unit='SHARES',e=>e.trade_date='2026-09-17',e=>e.calendar.checks.splice(2,1),e=>e.rows.forEach(r=>r.volume_lots=0)]){const e=structuredClone(evidence);change(e);assert.equal(run(e).status,'DATA_GAP');}
console.log(JSON.stringify({checks:15,status:'passed',scope:'isolated_A04_volume_component',production_complete:false}));
