'use strict';
const assert=require('node:assert/strict'),{createCapture}=require('../lib/mother-shared-water-capture.cjs');
const c=createCapture({connectionId:'scale'}),at='2026-10-06T04:59:55Z',t=Date.parse(at)*1000;
c.observe({event:'authenticated'},at);
for(let i=1000;i<2800;i++){
 const symbol=String(i);for(const channel of ['trades','aggregates'])c.request(channel,symbol);
 c.observe({event:'subscribed',data:[{channel:'trades',symbol,id:'t'+symbol},{channel:'aggregates',symbol,id:'a'+symbol}]},at);
 c.observe({event:'data',channel:'trades',id:'t'+symbol,data:{symbol,time:t-300000000,serial:100,price:70,volume:1000}},at);
 c.observe({event:'data',channel:'aggregates',id:'a'+symbol,data:{symbol,date:'2026-10-06',lastUpdated:t,lastTrade:{time:t-300000000,price:70},bids:Array.from({length:5},(_,i)=>({price:70-i,size:100})),asks:Array.from({length:5},(_,i)=>({price:71+i,size:100})),total:{tradeVolume:1000,tradeValue:70000000}}},at);
}
c.observe({event:'heartbeat',data:{time:'fixture'}},at);
const full=c.snapshot(at),symbols=Array.from({length:410},(_,i)=>String(1000+i)).concat('9999'),scoped=c.snapshot(at,{symbols});
assert.equal(full.rows.length,1800);assert.equal(scoped.requested_count,411);assert.equal(scoped.rows.length,410);assert.deepEqual(scoped.missing_symbols,['9999']);assert.equal(scoped.trade_heads.length,410);assert.equal(scoped.native_windows.length,410);assert.equal(c.snapshot(at).rows.length,1800);
assert.equal(c.snapshot(at,{symbols:[...symbols].reverse()}).requested_symbols_sha256,scoped.requested_symbols_sha256);
assert.throws(()=>c.snapshot(at,{symbols:['1216','1216']}),/SCOPE_INVALID/);
const fullBytes=Buffer.byteLength(JSON.stringify(full)),scopedBytes=Buffer.byteLength(JSON.stringify(scoped));assert.ok(fullBytes>5242880);assert.ok(scopedBytes<5242880);
console.log(JSON.stringify({ok:true,mode:'isolated_full_capture_scoped_export',full_rows:1800,requested:411,returned:410,missing:['9999'],full_bytes:fullBytes,scoped_bytes:scopedBytes,subscriptions_removed:0,production_connected:false}));
