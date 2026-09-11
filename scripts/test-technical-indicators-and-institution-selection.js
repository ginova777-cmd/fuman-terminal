'use strict';
const assert=require('assert');const {indicatorSeries,indicatorTrend,rsiAt,PARAMETERS}=require('../lib/technical-indicators');const {evaluateCandidates,timeframeEvidence}=require('../lib/institution-technical-selection');
assert.deepStrictEqual([PARAMETERS.kdPeriod,PARAMETERS.kSmoothing,PARAMETERS.dSmoothing,PARAMETERS.rsiFast,PARAMETERS.rsiSlow],[5,3,3,3,6]);
assert.equal(rsiAt([1,2,1,3],3,3),75);assert.equal(rsiAt([2,2,2,2],3,3),50);assert.equal(rsiAt([1,2],1,3),null);
const seed=indicatorSeries(Array.from({length:6},()=>({high:10,low:1,close:10})));assert(Math.abs(seed[4].k-200/3)<1e-9);assert(Math.abs(seed[4].d-500/9)<1e-9);assert(Math.abs(seed[5].k-700/9)<1e-9);
const closes=[100,102,101,103,102,104,103,105,104,106,105,112];const bars=closes.map((close,i)=>({date:new Date(Date.UTC(2000,0,9+i)).toISOString().slice(0,10),high:close+2,low:close-2,open:close-1,close}));assert.equal(indicatorTrend(bars).trendUp,true);assert.equal(indicatorTrend(bars.slice(0,7)).available,false);assert.equal(indicatorTrend([...bars.slice(0,-1),{...bars.at(-1),close:null}]).available,false);
const date='2000-01-20',last=Date.parse(date+'T13:00:00+08:00'),hourly=bars.map((b,i)=>({...b,date:new Date(last-(bars.length-1-i)*3600000).toISOString()}));assert.equal(timeframeEvidence(hourly,date,true).available,true);assert.equal(timeframeEvidence(hourly.slice(0,-1),date,true).available,false);
const candidates=Array.from({length:10},(_,i)=>({code:String(2300+i),name:'test',market:'上市',foreign:100,trust:20,dealer:0,total:120,foreignStreak:1,trustStreak:1,jointStreak:1,close:112,tradeVolume:4000000,fiveDayAvgVolume:4000000}));const sources=Object.fromEntries(candidates.map(r=>[r.code,{daily:bars,hourly60:hourly,errors:[]}]));
let x=evaluateCandidates(candidates,sources,date,{'2300':['required_field_missing']});assert.equal(x.selectionCoverage.dataCoverage,.9);assert.equal(x.selectionCoverage.ok,true);assert.equal(x.selected.length,9);assert(!x.selected.some(r=>r.code==='2300'));
x=evaluateCandidates(candidates,sources,date,{'2300':['missing'],'2301':['missing']});assert.equal(x.selectionCoverage.ok,false);assert.equal(x.selectionCoverage.dataCoverage,.8);
const flat=bars.map(b=>({...b,high:102,low:98,open:100,close:100})),flatHourly=hourly.map(b=>({...b,high:102,low:98,open:100,close:100}));const nonbull=Object.fromEntries(candidates.map(r=>[r.code,{daily:flat,hourly60:flatHourly,errors:[]}]));x=evaluateCandidates(candidates,nonbull,date);assert.equal(x.selectionCoverage.dataCoverage,1);assert.equal(x.selectionCoverage.technicalRejectedCount,10);assert.equal(x.selected.length,0);assert.equal(x.selectionCoverage.ok,true);
console.log('PASS shared KD/RSI arithmetic, missing/unfinished source, exact 90% boundary, excluded data, and legitimate zero bullish results');

assert.equal(timeframeEvidence([...hourly.slice(0,-2),hourly.at(-1)],date,true).reason,"previous_session_60m_missing");
assert.equal(timeframeEvidence([...hourly, hourly.at(-1)],date,true).available,false);
assert.equal(timeframeEvidence(hourly,date,true).previousBarTime,hourly.at(-2).date);
console.log("PASS last two completed T-day native 60m bars, missing predecessor and duplicate bars rejected");
