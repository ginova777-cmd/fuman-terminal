'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CandleLifecycle}=require('./candle-lifecycle.cjs');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'mp-lifecycle-')),tests=[];
const t=Date.parse('2026-10-06T09:00:00+08:00');
const row={symbol:'2330',market:'TSE',tradeDate:'2026-10-06',candleTime:new Date(t).toISOString(),candleSeenAt:new Date(t+10000).toISOString(),source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',restRepairRow:false,intradayOddLot:false,synthetic:false,volumeStrategyUsable:true,open:100,high:102,low:99,close:101,volume:12};
const options={directory:base,tradeDate:'2026-10-06',epoch:'fixture'};let c=new CandleLifecycle(options);
function test(name,fn){fn();tests.push({name,status:'PASS'});}
test('forming input freezes independently of caller',()=>{assert.equal(c.apply({sequence:1,rows:[row],nowMs:t+10000}).length,0);row.close=100;assert.equal(Object.values(c.state.rows)[0].raw.close,101);row.close=101;});
test('restart then clock only completes without new WS',()=>{c=new CandleLifecycle(options);assert.equal(c.apply({sequence:2,nowMs:t+59999}).length,0);const e=c.apply({sequence:3,nowMs:t+60000});assert.equal(e.length,1);assert.equal(e[0].kind,'UPSERT');assert.equal(e[0].payload.updated_at,row.candleSeenAt);});
test('duplicate raw does not repeat publication',()=>assert.equal(c.apply({sequence:4,rows:[row],nowMs:t+120000}).length,0));
test('older minute revision invalidates then republishes',()=>{const e=c.apply({sequence:5,rows:[{...row,volume:15}],nowMs:t+3600000});assert.deepEqual(e.map(x=>x.kind),['INVALIDATE','UPSERT']);assert.equal(e[1].payload.volume,15);});
test('quality loss retracts previous valid candle',()=>{const e=c.apply({sequence:6,rows:[{...row,volumeStrategyUsable:false}],nowMs:t+3600000});assert.equal(e[0].kind,'INVALIDATE');assert.equal(e[0].payload,null);assert.equal(Object.values(c.state.rows)[0].status,'INVALID');});
test('invalid identity does not advance state',()=>{assert.throws(()=>c.apply({sequence:7,rows:[{...row,tradeDate:'2026-10-07'}],nowMs:t+3600000}),/IDENTITY/);assert.equal(c.state.sequence,6);});
test('before rename crash restarts at prior cursor',()=>{assert.throws(()=>c.apply({sequence:7,rows:[row],nowMs:t+3600000,fault:'BEFORE_RENAME'}),/CRASH/);c=new CandleLifecycle(options);assert.equal(c.state.sequence,6);});
test('after rename crash preserves cursor and durable outbox',()=>{assert.throws(()=>c.apply({sequence:7,rows:[row],nowMs:t+3600000,fault:'AFTER_RENAME'}),/CRASH/);c=new CandleLifecycle(options);assert.equal(c.state.sequence,7);assert(c.state.outbox.length>0);});
test('ack removes only existing delivered IDs',()=>{assert.throws(()=>c.ack(['unknown']),/ACK_UNKNOWN/);c.ack(c.state.outbox.map(e=>e.event_id));assert.equal(new CandleLifecycle(options).state.outbox.length,0);});
test('clock regression rejects',()=>assert.throws(()=>c.apply({sequence:8,nowMs:t}),/CLOCK/));
fs.writeFileSync(path.join(__dirname,'evidence/lifecycle-tests.json'),JSON.stringify({status:'PASS',tests,synthetic:true,limitations:['single offline owner','bounded full-state persistence; not runtime incremental storage','downstream invalidation consumer still required']},null,2));console.log(JSON.stringify({status:'PASS',count:tests.length}));
