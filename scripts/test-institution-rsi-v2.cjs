'use strict';
const assert=require('node:assert/strict');
const p=require('../lib/institution-daily-indicators.cjs');
const old=require('../lib/technical-indicators-rsi515.cjs');
const c=require('../lib/institution-indicator-contract.cjs');
const selection=require('../lib/institution-technical-selection.js');
assert.equal(p.CONTRACT,'technical-kd5-3-rsi5-15-v2');
for(let shift=0;shift<40;shift++){
 const bars=Array.from({length:40},(_,i)=>{const close=100+Math.sin((i+shift)*.6)*10;return {high:close+2,low:close-2,close}});
 const a=p.indicatorTrend(bars,'1d'),b=old.indicatorTrend(bars,'1d');
 for(const k of ['kdK','kdD','kdPrevK','kdPrevD','rsi5','rsi15','rsi5Prev','rsi15Prev','trendUp'])assert.equal(a[k],b[k]);
 const trend={indicatorContract:c.CONTRACT,daily:a,hourly60:p.indicatorTrend(bars,'60m')};
 assert(c.checkTrend(trend));
 for(const change of [x=>x.indicatorContract='old',x=>x.daily.contract='old',x=>x.daily.parameters={...x.daily.parameters,rsiSlow:6},x=>x.daily.rsiEvidence.contract_version='old',x=>x.hourly60.contract='old',x=>x.daily.barCount=16,x=>x.daily.rsi15=null]){
  const altered=structuredClone(trend);change(altered);assert.equal(c.checkTrend(altered),false);
 }
 assert(c.checkTrend({...trend,hourly60:{available:false,reason:'missing'}}));
}
assert(!p.indicatorTrend(Array(16).fill({high:12,low:8,close:10})).available);
assert(c.checkCoverage({indicatorContract:c.CONTRACT}));
for(const contract of ['technical-kd5-3-rsi3-6-v1','technical-kd5-3-rsi5-15-v1',undefined])assert(!c.checkCoverage({indicatorContract:contract}));
const fs=require('fs'),path=require('path');
for(const file of ['verify-buy-sell-complete.js','verify-institution-live-readback.js']){
 const text=fs.readFileSync(path.join(__dirname,file),'utf8');
 assert(text.includes('indicatorContract.checkCoverage'));
 assert(!text.includes('technical-kd5-3-rsi3-6-v1'));
}
assert(fs.readFileSync(path.join(__dirname,'../lib/institution-technical-selection.js'),'utf8').includes("MIN_BARS}=require('./institution-daily-indicators.cjs')"));
console.log('PASS 40 formula parity cases; v2 daily/hourly evidence; old/tampered contracts rejected; optional hourly missing; 17-bar minimum; verifier wiring');
