"use strict";
const assert=require("node:assert/strict");
const {historyBudget}=require("./daytrade-5m-previous-session");
(async()=>{
 let calls=0,delays=0;
 const limited=historyBudget(async()=>{calls++;return {status:200};},{limit:2,sleep:async()=>{delays++;}});
 const values=await Promise.allSettled([limited("a"),limited("b"),limited("c")]);
 assert.equal(calls,2);assert.equal(delays,1);assert.match(values[2].reason.message,/DEFERRED_BUDGET/);
 calls=0;
 const circuit=historyBudget(async()=>{calls++;return {status:429};},{sleep:async()=>{}});
 const result=await Promise.allSettled([circuit("a"),circuit("b"),circuit("c")]);
 assert.equal(calls,1);assert.match(result[1].reason.message,/CIRCUIT_OPEN/);assert.match(result[2].reason.message,/CIRCUIT_OPEN/);
 console.log("PASS history request budget, serialized pacing, 429 circuit stops queued requests; no network calls.");
})().catch(e=>{console.error(e);process.exitCode=1;});
