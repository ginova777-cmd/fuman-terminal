'use strict';
const assert=require('node:assert/strict');
const b=require('../lib/institution-ranking-bonuses');
const dates=Array.from({length:15},(_,i)=>'2026-09-'+String(i+1).padStart(2,'0'));
const target=dates.at(-1);
function input(ratio=50,vol=250){return {symbol:'2330',recentVolume:{expectedDates:dates,rows:dates.map((date,i)=>({date,volume_lots:i===14?vol:100}))},daytrade:{symbol:'2330',market:'TWSE',source:'https://www.twse.com.tw/report',sourceHash:'test-source-hash',tradeDate:target,totalVolumeDate:target,unit:'shares',daytradeShares:vol*1000*ratio/100,totalVolumeShares:vol*1000}};}
assert.equal(b.calculate(input(),target).totalPoints,10);
assert.equal(b.calculate(input(49.999,249.999),target).totalPoints,0);
assert.equal(b.calculate(input(50,100),target).totalPoints,5);
assert.equal(b.calculate(input(0,250),target).totalPoints,5);
const stale=input();stale.daytrade.tradeDate='2026-09-14';assert.equal(b.calculate(stale,target).daytrade.points,0);
const wrong=input();wrong.daytrade.unit='lots';assert.equal(b.calculate(wrong,target).daytrade.points,0);
const symbol=input();symbol.daytrade.symbol='1101';assert.equal(b.calculate(symbol,target).daytrade.points,0);
const zero=input();zero.daytrade.totalVolumeShares=0;assert.equal(b.calculate(zero,target).daytrade.points,0);
const missing=b.apply({code:'2330',total:100},null,target);assert.equal(missing.code,'2330');assert.equal(missing.rankingBonusScore,0);assert.equal(missing.rankingBonuses.daytrade.status,'unavailable');
const selected=[b.apply({code:'1101',total:999999},null,target),b.apply({code:'2330',total:100},input(),target)].sort(b.compare);assert.equal(selected[0].code,'2330');
assert.equal(b.apply(selected[0],input(),target).rankingBonusScore,10);
console.log('PASS 11 bonus boundary, source identity, missing-data, ranking and idempotency assertions');
