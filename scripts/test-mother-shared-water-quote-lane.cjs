'use strict';
const assert=require('node:assert/strict');const {createLane}=require('../lib/mother-shared-water-quote-lane.cjs');
const row=seconds=>({symbol:'1216',trade_date:'2026-10-06',quote_seen_at:'2026-10-06T01:00:'+String(seconds).padStart(2,'0')+'Z',last_trade_time:'2026-10-06T01:00:00Z'});
(async()=>{
 const lane=createLane(),events=[];let release;
 const wait=new Promise(r=>release=r);
 const a=lane.run([row(10)],async()=>{events.push('new:start');await wait;events.push('new:done');return 1;});
 const b=lane.run([row(5)],async()=>events.push('old:WRONG'));
 const rejected=assert.rejects(b,/OLDER_EVENT/);
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['new:start']);release();await a;await rejected;assert.deepEqual(events,['new:start','new:done']);
 await lane.run([row(15)],async()=>events.push('later'));assert.equal(events.at(-1),'later');
 const failed=createLane();await assert.rejects(failed.run([row(1)],async()=>{throw Error('timeout');}),/timeout/);
 await assert.rejects(failed.run([row(2)],async()=>{throw Error('must not send');}),/UNCONFIRMED/);
 console.log(JSON.stringify({ok:true,cases:4,mode:'serialized_full_and_incremental_lane',database_requests:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
