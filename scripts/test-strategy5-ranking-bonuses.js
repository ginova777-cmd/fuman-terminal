'use strict';
const assert=require('node:assert/strict'),ranking=require('../lib/strategy5-ranking-bonuses'),technical=require('../lib/strategy5-technical-selection');
const target='2000-01-20',dates=Array.from({length:15},(_,i)=>'2000-01-'+String(i+6).padStart(2,'0'));
const bars=[100,102,101,103,102,104,103,105,104,106,105,112].map((close,i)=>({date:'2000-01-'+String(i+9).padStart(2,'0'),open:close-1,high:close+2,low:close-2,close}));
const input=(symbol,vol=250,pct=50)=>({symbol,recentVolume:{expectedDates:dates,rows:dates.map((date,i)=>({date,volume_lots:i===14?vol:100}))},daytrade:{symbol,source:'official-test',sourceHash:'isolated',tradeDate:target,totalVolumeDate:target,unit:'shares',daytradeShares:vol*1000*pct/100,totalVolumeShares:vol*1000}});
assert.equal(ranking.calculate(input('2330'),target).totalPoints,10);
assert.equal(ranking.calculate(input('2330',249.999,49.999),target).totalPoints,0);
const candidates=[{code:'1101',score:89},{code:'2330',score:80}].map(r=>({...r,name:r.code,market:'TWSE',close:112,matches:[{id:'original',score:r.score}]}));
const sources=Object.fromEntries(candidates.map(r=>[r.code,{daily:bars,hourly60:[],rankingBonus:r.code==='2330'?input(r.code):{symbol:r.code}}]));
const result=technical.evaluate(candidates,sources,target);assert.deepEqual(result.selected.map(r=>r.code),['2330','1101']);assert.equal(result.selected[0].score,90);assert.equal(result.selected[1].score,89);assert.deepEqual(result.selected[0].matches,candidates[1].matches);
assert.equal(technical.evaluate(result.selected,sources,target).selected[0].score,90,'must not double add on reread');
assert.equal(result.selectionCoverage.dataCoverage,1,'optional missing bonus does not reject');
for(const mutation of [x=>x.daytrade.unit='LOTS',x=>x.daytrade.tradeDate='2000-01-19',x=>x.daytrade.symbol='1101',x=>x.daytrade.totalVolumeShares=0]){const x=input('2330');mutation(x);assert.equal(ranking.calculate(x,target).daytrade.points,0);}
console.log('PASS Strategy5 thresholds, ranking, missing data, identity, unit, zero denominator and idempotence');
