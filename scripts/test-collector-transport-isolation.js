'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require.resolve('./fugle-websocket-collector.js'),'utf8');
const a=s.indexOf('async function mirrorDaytradeSourceTransport('),b=s.indexOf('function scheduleSourceStatusHeartbeat(',a),saved=[];
const c={COLLECTOR_ROLE:'daytrade',nowIso:()=> '2026-09-29T01:00:00Z',SOURCE_STATUS_HEARTBEAT_RECEIPT_FILE:'isolated',writeJson:(p,r)=>saved.push(r),fetch:()=>{throw Error('Collector must not rewrite source_status');}};
vm.createContext(c);vm.runInContext(s.slice(a,b)+';globalThis.run=mirrorDaytradeSourceTransport;',c);
(async()=>{const r=await c.run({websocketConnected:true,websocketAuthenticated:false,subscribed:20});assert.equal(r.status,'observed');assert.equal(r.source_status_written,false);assert.equal(r.authoritative,false);assert.equal(r.complete,false);assert.equal(r.websocket_authenticated,false);assert.equal(r.attempts,0);assert.equal(saved.length,1);c.COLLECTOR_ROLE='other';assert.equal((await c.run({})).status,'skipped_non_daytrade_collector');console.log('PASS actual Collector heartbeat has no DB read/write or retry, preserves transport truth');})().catch(e=>{console.error(e);process.exitCode=1});
