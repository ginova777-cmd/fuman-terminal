"use strict";
const fs=require("fs"),vm=require("vm"),assert=require("assert/strict"),path=require("path");
const text=fs.readFileSync(path.join(__dirname,"run-daytrade-source-writer.js"),"utf8");
const block=text.slice(text.indexOf("  const ma20Scope ="),text.indexOf("  const effectiveMa35Required",text.indexOf("  const ma20Scope =")));
function check(count,ready,extra){const ctx={priorityRows:Array.from({length:count},(_,i)=>({symbol:String(i),selected:true})),intradayMap:new Map(Array.from({length:ready+extra},(_,i)=>[String(i<ready?i:count+i),{continuous_candle_count:25,ma20:100}])),isPublishedMotherMember:r=>r.selected,normalizeCode:v=>v,MIN_INDICATOR_WARMUP_COVERAGE:.9,readyMa20:0};vm.createContext(ctx);vm.runInContext(block+'\nresult={ready:readyMa20,required:effectiveMa20Required,total:ma20Scope.length};',ctx);return ctx.result;}
assert.equal(check(304,304,50).ready,304);
assert.equal(check(304,200,300).required,274);
assert.equal(check(304,200,300).ready,200);
assert.equal(check(304,273,0).ready>=check(304,273,0).required,false);
assert.equal(check(304,274,0).ready>=check(304,274,0).required,true);
assert.equal(check(0,0,100).ready>=check(0,0,100).required,false);
assert.match(text,/const warmupGateReady[\s\S]{0,200}readyMa20 >= effectiveMa20Required/);
console.log("MA20 out-of-scope rows cannot inflate readiness; 90% boundary and empty scope PASS");
