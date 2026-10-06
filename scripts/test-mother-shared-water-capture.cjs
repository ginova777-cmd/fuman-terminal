'use strict';
const assert=require('node:assert/strict'),{createCapture}=require('../lib/mother-shared-water-capture.cjs');
const at='2026-10-06T04:59:55Z';
function ready(options={}){const c=createCapture({connectionId:'c',...options});c.request('aggregates','1216');c.observe({event:'authenticated'},at);c.observe({event:'subscribed',data:{channel:'aggregates',symbol:'1216',id:'s'}},at);return c;}
const packet=()=>({event:'data',channel:'aggregates',id:'s',data:{symbol:'1216',date:'2026-10-06',lastTrade:{time:1791262495000000,price:70},lastUpdated:1791262795000000}});
let count=0;function test(fn){fn();count++;}
test(()=>{const c=ready(),p=packet();assert.equal(c.observe(p,at),true);p.data.lastTrade.price=99;const s=c.snapshot(at);assert.equal(JSON.parse(s.rows[0].raw_utf8).payload.lastTrade.price,70);assert.equal(s.stored,false);s.rows.length=0;assert.equal(c.snapshot(at).rows.length,1);});
test(()=>{const c=ready();c.observe(packet(),at);c.close();assert.equal(c.snapshot(at).rows.length,0);assert.equal(c.observe(packet(),at),false);});
test(()=>{const c=ready();c.observe(packet(),at);c.observe({event:'unsubscribed',data:{id:'s'}},at);assert.equal(c.snapshot(at).rows.length,0);});
test(()=>{const c=ready();c.observe(packet(),at);c.observe({event:'error'},at);assert.equal(c.snapshot(at).rows.length,0);});
test(()=>{const c=ready({maxBytes:10});assert.equal(c.observe(packet(),at),false);assert.equal(c.snapshot(at).last_error,'CAPTURE_BYTE_LIMIT');});
test(()=>{const c=ready();const p=packet();p.id='wrong';assert.equal(c.observe(p,at),false);});
test(()=>{const c=createCapture({connectionId:'c'});c.request('aggregates','1216');assert.equal(c.observe(packet(),at),false);});
test(()=>{const c=ready();const p=packet();delete p.channel;assert.equal(c.observe(p,at),false);});
test(()=>{const c=ready();c.observe(packet(),at);c.request('aggregates','1216');assert.equal(c.snapshot(at).rows.length,0);});
console.log(JSON.stringify({ok:true,cases:count,mode:'isolated',production_connected:false}));
