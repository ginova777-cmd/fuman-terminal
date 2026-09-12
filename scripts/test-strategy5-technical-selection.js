const assert = require('assert');
const { evaluate } = require('../lib/strategy5-technical-selection');
const date='2000-01-20';
const bars=[100,102,101,103,102,104,103,105,104,106,105,112].map((close,i)=>({date:new Date(Date.UTC(2000,0,9+i)).toISOString().slice(0,10),high:close+2,low:close-2,open:close-1,close}));
const rows=Array.from({length:10},(_,i)=>({code:String(2300+i),name:'test',market:'上市',close:112,score:80,matches:[{id:'volume_turnover_breakout',score:80}]}));
const sources=Object.fromEntries(rows.map(r=>[r.code,{daily:bars,hourly60:[],errors:[]}]));
let result=evaluate(rows,sources,date);
assert.equal(result.selected.length,10); assert.equal(result.selectionCoverage.dataCoverage,1);
assert(result.selected.every(r=>r.technicalTrend.hourly60Bonus===false));
assert.deepStrictEqual(result.selected[0].matches,rows[0].matches);
sources['2300'].daily=[];
result=evaluate(rows,sources,date); assert.equal(result.selectionCoverage.dataCoverage,.9);assert(result.selectionCoverage.ok);assert.equal(result.selected.length,9);
sources['2301'].daily=[];assert.equal(evaluate(rows,sources,date).selectionCoverage.ok,false);
const flat=bars.map(b=>({...b,close:100,high:102,low:98}));
result=evaluate(rows,Object.fromEntries(rows.map(r=>[r.code,{daily:flat,hourly60:[]} ])),date);
assert.equal(result.selected.length,0);assert.equal(result.selectionCoverage.dataCoverage,1);
assert.equal(evaluate(rows,sources,'2000-01-21').selectionCoverage.dataCoverage,0);
console.log('PASS Strategy5 daily up required, optional 60m, unchanged base strategies, 90% boundary, missing/stale and flat trend');

{
 const proof = require('../lib/strategy5-technical-selection');
 const assert = require('assert');
 const bars = Array.from({length:12},(_,i)=>({date:'2026-01-'+String(i+9).padStart(2,'0'),open:10+i,high:12+i,low:9+i,close:11+i}));
 const candidate={code:'2330',name:'test',market:'TWSE',close:22,matches:[{id:'volume_turnover_breakout'}]};
 const evaluate=rows=>proof.evaluate([candidate],{'2330':{daily:rows,hourly60:[]}},'2026-01-20');
 assert.equal(evaluate([...bars,{date:'2026-01-03',open:null,high:null,low:null,close:null}]).selectionCoverage.dataCoverage,1,'weekend null placeholder is not a daily candle');
 assert.equal(evaluate([...bars,{date:'2026-01-02',open:null,high:null,low:null,close:null}]).selectionCoverage.dataCoverage,0,'weekday missing candle must remain blocking');
 assert.equal(evaluate([...bars,{date:'2026-01-03',open:12,high:null,low:11,close:12}]).selectionCoverage.dataCoverage,0,'partially malformed weekend row must not be silently removed');
 console.log('PASS Strategy5 excludes only empty weekend placeholders, retains missing trading bars');
}

{
 const assert=require('assert');
 const scanner=require('./scan-strategy5-cache');
 const evidence={contract:'strategy5-candidate90-daily-up-hourly60-bonus-v1',dataCoverage:.99,ok:true};
 const payload=scanner.buildStrategy5RunRow({selectionCoverage:evidence,technicalSourceHash:'a'.repeat(64),technicalSourcePath:'evidence/run.json'},'strategy5-20260911-20260912000000').payload;
 assert.deepStrictEqual(payload.selectionCoverage,evidence);
 assert.equal(payload.technicalSourceHash,'a'.repeat(64));assert.equal(payload.technicalSourcePath,'evidence/run.json');
 console.log('PASS Strategy5 database run payload preserves technical evidence contract');
}
