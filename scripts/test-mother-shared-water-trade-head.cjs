'use strict';
const assert=require('node:assert/strict'),{createCapture}=require('../lib/mother-shared-water-capture.cjs');
const at='2026-10-06T04:59:55Z',time=Date.parse(at)*1000;
const aggregate=(t=time-5000000)=>({event:'data',channel:'aggregates',id:'a',data:{symbol:'1216',date:'2026-10-06',lastUpdated:time,lastTrade:{time:t,price:70}}});
const trade=(serial=100,t=time-1000000)=>({event:'data',channel:'trades',id:'t',data:{symbol:'1216',serial,time:t,price:70,volume:1000}});
function ready(options={}){const c=createCapture({connectionId:'c',...options});c.request('aggregates','1216');c.request('trades','1216');c.observe({event:'authenticated'},at);c.observe({event:'subscribed',data:[{channel:'aggregates',symbol:'1216',id:'a'},{channel:'trades',symbol:'1216',id:'t'}]},at);c.observe(aggregate(),at);return c;}
let cases=0;function test(fn){fn();cases++;}
test(()=>{const c=ready();assert.equal(c.snapshot(at).rows.length,1);c.observe(trade(),at);const s=c.snapshot(at);assert.equal(s.rows.length,0);assert.equal(s.trade_heads.length,1);assert.equal(s.continuity_verified,false);assert.equal(JSON.parse(s.trade_heads[0].raw_utf8).subscription_id,'t');});
test(()=>{const c=ready();c.observe(trade(),at);assert.equal(c.observe(aggregate(),at),false);assert.equal(c.snapshot(at).last_error,'AGGREGATE_BEHIND_TRADE_HEAD');assert.equal(c.observe(aggregate(time-1000000),at),true);});
test(()=>{const c=ready(),p=trade();c.observe(p,at);const before=JSON.stringify(c.snapshot(at).trade_heads);c.observe(p,at);assert.equal(JSON.stringify(c.snapshot(at).trade_heads),before);assert.equal(JSON.parse(c.snapshot(at).native_windows[0].raw_utf8).event_count,3);p.data.price=99;assert.equal(JSON.parse(c.snapshot(at).trade_heads[0].raw_utf8).payload.price,70);});
test(()=>{const c=ready();c.observe(trade(),at);const p=trade();p.data.price=71;c.observe(p,at);assert.equal(c.snapshot(at).trade_heads.length,0);assert.equal(c.snapshot(at).rows.length,0);assert.equal(c.snapshot(at).last_error,'TRADE_ORDER_OR_SERIAL_CONFLICT');});
test(()=>{const c=ready();c.observe(trade(100),at);assert.equal(c.observe(trade(300),at),true);assert.equal(c.snapshot(at).trade_heads.length,1);});
test(()=>{const c=ready();c.observe(trade(),at);c.close();assert.equal(c.snapshot(at).trade_heads.length,0);});
test(()=>{const c=ready();c.observe(trade(),at);c.observe({event:'unsubscribed',data:{id:'t'}},at);assert.equal(c.snapshot(at).trade_heads.length,0);assert.equal(c.snapshot(at).rows.length,0);});
test(()=>{const c=ready();const p=trade();p.id='wrong';c.observe(p,at);assert.equal(c.snapshot(at).rows.length,0);assert.equal(c.snapshot(at).last_error,'TRADE_SUBSCRIPTION_UNVERIFIED');});
test(()=>{const c=ready();c.observe(null,at);assert.equal(c.snapshot(at).authenticated,false);assert.equal(c.snapshot(at).rows.length,0);});
test(()=>{const c=ready();const p=trade();p.data.isTrial=true;c.observe(p,at);assert.equal(c.snapshot(at).trade_heads.length,0);assert.equal(c.snapshot(at).rows.length,1);});
test(()=>{const c=ready();c.observe(trade(100,time+1),at);assert.equal(c.snapshot(at).last_error,'NATIVE_TRADE_INVALID');assert.equal(c.snapshot(at).rows.length,0);});
console.log(JSON.stringify({ok:true,cases,mode:'isolated',production_connected:false,no_new_trade_enabled:false}));
