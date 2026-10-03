'use strict';
const assert=require('node:assert/strict');
const {createQualificationHost:create}=require('../lib/shared-stock-qualification-host.cjs');
let now=Date.parse('2026-10-02T00:00:00Z'),opened=0,requests=0,steps=0,closed=0,budget=true,isOpen=true;
const options={runtimeDir:'unused',apiKey:'test-only',readSymbols:()=>['3163','3163'],clock:()=>now,budgetAvailable:()=>budget,
 calendar:async()=>[{trade_date:new Date(now+28800000).toISOString().slice(0,10),is_open:isOpen,payload:{calendar_contract:'market-calendar-contract-v1'}}],
 openStore:async()=>{opened++;return {close:async()=>{closed++;},refresh:async opts=>{steps++;assert.deepEqual(opts.symbols,['3163']);const r=await opts.fetchTicker('3163');assert.equal(r.body.symbol,'3163');return {status:'CACHED',request_count:1,state:{records:{}}};}};},
 fetchImpl:async(url,opts)=>{requests++;assert.ok(url.endsWith('/intraday/ticker/3163'));assert.equal(opts.headers['X-API-KEY'],'test-only');return new Response(JSON.stringify({symbol:'3163'}),{status:200});}};
(async()=>{
 const host=create(options);assert.equal((await host.runOnce()).status,'CACHED');assert.equal(opened,1);assert.equal(requests,1);
 budget=false;assert.equal((await host.runOnce()).status,'SHARED_PROVIDER_COOLDOWN');assert.equal(requests,1);
 now=Date.parse('2026-10-02T06:00:00Z');assert.equal((await host.runOnce()).status,'OUTSIDE_SOURCE_WINDOW');assert.equal(closed,1);await host.stop();
 now=Date.parse('2026-10-03T00:00:00Z');budget=true;isOpen=false;
 const weekend=create(options);assert.equal((await weekend.runOnce()).status,'MARKET_CLOSED');assert.equal(opened,1);await weekend.stop();
 let calendarCalls=0;const bad=create({...options,calendar:async()=>{calendarCalls++;throw Error('unverified');}});
 assert.equal((await bad.runOnce()).status,'BLOCKED');assert.equal((await bad.runOnce()).status,'HOST_BACKOFF');assert.equal(calendarCalls,1);assert.equal(requests,1);await bad.stop();
 isOpen=true;let reply;
 const rate=create({...options,fetchImpl:async()=>new Response('',{status:429,headers:{'retry-after':'120'}}),openStore:async()=>({close:async()=>{},refresh:async opts=>{reply=await opts.fetchTicker('3163');return {status:'BACKOFF',request_count:1};}})});
 assert.equal((await rate.runOnce()).status,'BACKOFF');assert.equal(reply.retryAfterMs,120000);await rate.stop();
 const oversized=create({...options,fetchImpl:async()=>new Response('x'.repeat(65537)),openStore:async()=>({close:async()=>{},refresh:async opts=>{await assert.rejects(opts.fetchTicker('3163'),/BODY_BOUND/);return {status:'BACKOFF',request_count:1};}})});
 await oversized.runOnce();await oversized.stop();
 console.log('PASS: shared collector host calendar/window/budget gates, deduplicated universe, bounded body, Retry-After and failure pacing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
