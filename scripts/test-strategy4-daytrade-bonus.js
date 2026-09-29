'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const b=require('../lib/strategy4-daytrade-bonus');
const target='2026-09-29';
const input=n=>({symbol:'2330',official:{symbol:'2330',market:'TWSE',tradeDate:target,unit:'shares',source:'https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=20260929&response=json',sourceHash:'test',daytradeShares:n},totalVolumeShares:100000,totalVolumeDate:target,totalVolumeSource:'stock_daily_volume'});
test('strict greater-than 50, no rounding across threshold',()=>{for(const [n,p] of [[49999,0],[50000,0],[50001,5]]){const e=b.calculate(input(n),target);assert.equal(e.points,p);assert(b.valid(e));}});
test('missing, stale, wrong symbol and zero denominator earn zero',()=>{for(const x of [{}, {...input(60000),totalVolumeShares:0},{...input(60000),totalVolumeDate:'2026-09-24'},{...input(60000),symbol:'2317'}]){const e=b.calculate(x,target);assert.equal(e.points,0);assert.equal(e.status,'unavailable');assert(b.valid(e));}});
test('ratio, source, threshold and points tampering rejected',()=>{for(const [k,v] of [['ratioPct',99],['points',10],['comparison','>='],['thresholdPct',49]]){const e=b.calculate(input(60000),target);e[k]=v;assert(!b.valid(e));}});
