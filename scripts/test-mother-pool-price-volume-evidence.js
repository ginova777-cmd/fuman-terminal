'use strict';
const assert=require('node:assert/strict'),{collect}=require('../lib/mother-pool-price-volume-evidence');
const date='2026-09-17',time=date+'T01:00:00Z';
const snapshot={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:date,
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:'isolated',mother_pool_run_id:'isolated',snapshot_sequence:1,
 snapshot_type:'OPENING_SNAPSHOT',effective_at:time,status:'complete',complete:true,exit_code:0,first_blocker:null,
 symbol_count:1,symbols:['2330'],removed_symbols:[],symbol_membership:[{symbol:'2330',mother_pool_run_id:'isolated',
 mother_pool_snapshot_sequence:1,membership_status:'ACTIVE',membership_effective_at:time}]};
const candles=Array.from({length:23},(_,i)=>({symbol:'2330',market:'TSE',tradeDate:date,
 candleTime:new Date(Date.parse(time)+i*60000).toISOString(),candleSeenAt:new Date(Date.parse(time)+(i+1)*60000).toISOString(),
 source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',synthetic:false,volumeStrategyUsable:true,
 open:100,high:110,low:99,close:100+i*.1,volume:i===22?40:10}));
const args={candles,snapshot,asOf:date+'T01:23:00Z'};
const r=collect(args),detail=r.details[0];
const sessions=Array.from({length:20},(_,i)=>new Date(Date.parse('2026-09-16T00:00:00Z')-i*86400000).toISOString().slice(0,10)).reverse();
// Isolated calendar/source fixture, never a claimed natural historical capture.
const response={symbol:'2330',exchange:'TWSE',market:'TSE',type:'EQUITY',timeframe:'1',data:sessions.flatMap(d=>[
 {date:d+'T09:21:00+08:00',open:100,high:101,low:99,close:100,volume:10},
 {date:d+'T09:22:00+08:00',open:100,high:101,low:99,close:100.1,volume:10}])};
const fetchedAt=date+'T00:00:00Z';
const normalized=require('../lib/mother-pool-historical-minute-adapter').adapt({response,symbol:'2330',tradeDate:date,fetchedAt,asOf:args.asOf,sessionDates:sessions});
const historical={contract:'mother_pool_historical_minute_fetch_evidence_v1',symbol:'2330',trade_date:date,calendar_verified:true,
 requested_sessions:sessions,calendar:{checked_at:fetchedAt,sha256:'a'.repeat(64)},result:{status:'HISTORY_FETCHED',raw:response,normalized,fetched_at:fetchedAt}};
const {verify}=require('../lib/verify-mother-pool-price-volume-evidence');
const simulated={role:'anon',dbReadback:true};
const connected=collect({...args,readHistory:()=>historical});
assert.equal(connected.details[0].history_status,'HISTORICAL_INPUT_VALIDATED');
assert.equal(connected.details[0].history.length,40);
assert.equal(connected.details[0].volume.same_minute_sample_count,20);
assert.equal(connected.details[0].volume_admission.allowed,true);
assert.equal(connected.details[0].formal_event_allowed,false);
assert.equal(verify(connected,connected,simulated).readback_verified,true);
const corruptHistory=structuredClone(connected);corruptHistory.details[0].history[0].is_synthetic=true;
assert.equal(verify(corruptHistory,corruptHistory,simulated).readback_verified,false);
const futureHistory=structuredClone(historical);futureHistory.result.fetched_at=date+'T09:00:00Z';
assert.equal(collect({...args,readHistory:()=>futureHistory}).details[0].reason,'HISTORICAL_SOURCE_INVALID');
assert.equal(verify(r,r,simulated).readback_verified,true);
assert.equal(verify(r,r).readback_verified,false);
const altered=structuredClone(r);altered.details[0].volume.primary_ratio=99;
assert.equal(verify(altered,altered,simulated).readback_verified,false);
assert.equal(verify(r,{...r,snapshot_sequence:2},simulated).readback_verified,false);
for(const mutate of [x=>x.canonical_run_id='wrong',x=>x.snapshot_sequence=0,
 x=>x.details[0].current[0].is_synthetic=true,x=>x.details[0].current[0].available_at='2026-09-18T00:00:00Z',
 x=>x.details[0].current[0].volume_raw_unit='UNKNOWN',x=>x.details[0].price.timestamp='2026-09-17T01:00:00Z',
 x=>x.as_of=date+'T01:30:00Z']){
 const x=structuredClone(r);mutate(x);assert.equal(verify(x,x,simulated).readback_verified,false);
}
assert.equal(detail.status,'CALCULATION_EVIDENCE_ONLY');assert.deepEqual(detail.failed_checks,[]);
assert.equal(detail.volume.primary_ratio,4);assert.equal(detail.volume.volume_anomaly_event,true);
assert.equal(detail.formal_event_allowed,false);assert.equal(r.complete,false);assert.equal(r.publish_allowed,false);
assert.equal(detail.history_status,'HISTORICAL_SOURCE_NOT_CONNECTED');
assert.equal(detail.volume_admission.allowed,false);
assert.ok(detail.volume_admission.reasons.includes('INSUFFICIENT_SAMPLE'));
const falseApproval=structuredClone(r);falseApproval.details[0].volume_admission.allowed=true;
assert.equal(verify(falseApproval,falseApproval,simulated).readback_verified,false);
const early=collect({...args,candles:candles.slice(0,2),asOf:date+'T01:02:00Z'});
assert.equal(early.details[0].volume.primary_ratio,null);assert.equal(early.details[0].volume.volume_anomaly_event,false);
assert.equal(collect({...args,asOf:date+'T01:30:00Z'}).details[0].reason,'LATEST_CANDLE_NOT_FRESH');
assert.equal(collect({...args,candles:[]}).details[0].reason,'NATURAL_CANDLES_MISSING');
assert.equal(collect({...args,candles:candles.filter((_,i)=>i!==5)}).details[0].reason,'NONCONTIGUOUS_ROLLING_CANDLES');
const broken=structuredClone(r);broken.details[0].current.splice(4,1);
assert.equal(verify(broken,broken,simulated).readback_verified,false);
assert.throws(()=>collect({...args,snapshot:{...snapshot,run_id:'mixed'}}),/SNAPSHOT_INVALID/);
assert.throws(()=>collect({...args,snapshot:{...snapshot,effective_at:date+'T01:24:00Z'}}),/SNAPSHOT_INVALID/);
console.log('PASS Mother Pool volume/price evidence: calculations, warmup, stale/missing source, fixed as-of snapshot, no publication');
