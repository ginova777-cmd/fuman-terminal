'use strict';
const assert=require('node:assert/strict');
const {build}=require('../lib/mother-shared-water-producer.cjs');
const identity={trade_date:'2026-10-06',canonical_run_id:'canonical',mother_pool_run_id:'mother',writer_run_id:'writer',generation:'generation',snapshot_sequence:1,producer_version:'test-only',verification_run_id:'test-run'};
function input(){return {identity,prioritySymbols:['1216','1303'],snapshotBytes:Buffer.from(JSON.stringify({...identity,symbols:['1216','2330']})),evidenceRows:[],resolve:()=>null,checkedAt:'2026-10-06T05:00:00Z',validUntil:'2026-10-06T05:00:30Z'};}
let cases=0;const test=fn=>{fn();cases++;};
test(()=>{const r=build(input());assert.equal(r.status,'BLOCKED');assert.equal(r.unknown_count,2);assert.equal(r.requested_count,2);assert.equal(r.source_asof,null);assert.deepEqual(r.priority_not_in_snapshot,['1303']);assert.deepEqual(r.snapshot_not_in_priority,['2330']);assert.equal(r.strategy3_scan_ready,false);});
test(()=>{const i=input(),before=JSON.stringify(i);build(i);assert.equal(JSON.stringify(i),before);});
test(()=>{const i=input();i.evidenceRows=[{symbol:'1216',last_trade_at:'2026-10-06T04:59:50Z',heartbeat_healthy:true,ack:true}];const r=build(i);assert.equal(r.water_available_count,0);assert.equal(r.rows[0].source_status,'UNKNOWN');});
for(const mutate of [i=>i.prioritySymbols.push('1216'),i=>i.prioritySymbols=[],i=>i.evidenceRows=[{symbol:'9999'}],i=>i.validUntil='2026-10-06T05:05:00Z',i=>i.snapshotBytes=Buffer.from(JSON.stringify({...identity,generation:'wrong',symbols:['1216']}))])test(()=>{const i=input();mutate(i);assert.throws(()=>build(i));});
console.log(JSON.stringify({ok:true,cases,mode:'isolated',production_connected:false}));
