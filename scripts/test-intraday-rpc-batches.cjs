'use strict';
const assert=require('node:assert/strict');const {readLatest}=require('../lib/daytrade-intraday-rpc-batches.cjs');
const symbols=Array.from({length:12},(_,i)=>String(1101+i));
function rows(group){return group.flatMap(symbol=>Array.from({length:200},(_,i)=>({symbol,candle_time:new Date(Date.parse('2026-10-01T01:00:00Z')+i*60000).toISOString(),close:100})));}
function response(data,total=data.length){return new Response(JSON.stringify(data),{headers:{'content-range':data.length?`0-${data.length-1}/${total}`:'*/0'}});}
(async()=>{
 let active=0,max=0,calls=0;
 const result=await readLatest({symbols,send:async body=>{calls++;active++;max=Math.max(max,active);assert(body.symbols.length<=4);await new Promise(r=>setTimeout(r,5));active--;return response(rows(body.symbols));}});
 assert.equal(result.length,2400);assert.equal(new Set(result.map(r=>r.symbol)).size,12);assert.equal(max,2);assert.equal(calls,3);
 await assert.rejects(readLatest({symbols,send:async body=>response(rows(body.symbols).slice(0,500),800)}),/TRUNCATED/);
 await assert.rejects(readLatest({symbols,send:async()=>response([{symbol:'9999',candle_time:'2026-10-01T01:00:00Z'}])}),/IDENTITY/);
 assert.deepEqual(await readLatest({symbols:['1101'],send:async()=>response([])}),[]);
 let clock=0;await assert.rejects(readLatest({symbols,now:()=>clock+=100,budgetMs:50,send:()=>{throw Error('UNEXPECTED_SEND');}}),/BUDGET/);
 console.log('PASS complete 2400 rows, max two requests, truncation/identity/budget rejection and genuine empty response');
})().catch(e=>{console.error(e);process.exitCode=1;});
