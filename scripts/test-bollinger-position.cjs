'use strict';
const assert=require('node:assert/strict'),b=require('./bollinger-position.cjs');
for(const [close,expected] of [[100,0],[110,5],[112,6],[116,8],[120,10],[80,-10],[130,15],[70,-15]]){assert.equal(b.position(close,100,10),expected);assert.equal(20*(close-80)/40-10,expected);}
assert.equal(b.round(7.8),8);assert(b.position(115.6,100,10)<8);assert.equal(b.round(-5.5),-6);
assert.equal(b.position(100,100,0),null);
for(const [v,z] of [[-10,'VERY_WEAK_LOW'],[1,'WEAK'],[4,'WEAK_REBOUND'],[7,'NEAR_STRONG'],[8,'STRONG'],[15,'STRONG']])assert.equal(b.zone(v),z);
const bars=Array.from({length:25},(_,i)=>({symbol:'TEST',trade_date:`2026-08-${String(i+1).padStart(2,'0')}`,close:125-i}));
const x=b.calculate(bars,'2026-08-25');assert.equal(x.ma20_slope_1d,-1);assert.equal(x.ma20_slope_5d,-1);assert.equal(x.ma20_trend,'DOWN');assert.equal(x.short_boll_candidate,true);
assert.equal(b.calculate(bars.slice(-20),'2026-08-25').ma20_trend,'UNKNOWN');
assert.equal(b.calculate(bars,'2026-08-26').boll_position_raw,null);
assert.equal(b.calculate(bars.map(x=>({...x,close:100})),'2026-08-25').boll_position_raw,null);
assert.equal(b.calculate(bars,'2026-08-25',{period:10}).parameters.period,10);
assert.equal(b.position(120,100,10,4),5);assert.equal(b.openingLevels(100).target_2,96);assert.equal(b.openingLevels(null),null);
console.log('PASS: formula, equivalent formula, unbounded values, rounding, zones, slopes, missing data, configurable parameters, opening levels');
