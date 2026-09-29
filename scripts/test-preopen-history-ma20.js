'use strict';
const assert=require('node:assert/strict');
const base='../';
const producer=require(base+'lib/mother-pool-preopen-ma20');
const verify=require(base+'lib/verify-mother-pool-ma20').verify;
const date='2026-09-29',asOf=date+'T08:00:00+08:00';
const identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260929:canonical',mother_pool_run_id:'isolated',snapshot_generation:'isolated',snapshot_sequence:1};
const symbols=['2330'];
const snapshot=require(base+'scripts/test-mother-ma20').snapshot(identity,symbols,asOf);
const calendar={trade_date:date,market:'TW',is_open:true,payload:{checked_at:asOf,calendar_decision:{date,isTradingDay:true,source:'cache',calendar_evidence:{year:2026,source:'cache',source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetched_at:date+'T06:00:00+08:00',rows:[{Date:'1150928',Name:'休市'},{Date:'1150925',Name:'休市'}]}}}};
const rows=Array.from({length:20},(_,i)=>({symbol:'2330',trade_date:'2026-09-24',candle_time:`2026-09-24T13:${10+i}:00+08:00`,open:100,high:101,low:99,close:100,source:'fugle_daytrade_fast_sync:websocket_candles',synthetic:false,volume_strategy_usable:true,payload:{originalSource:'fugle-ws-candles',originalChannel:'candles',candleOrigin:'websocket_candle',sourceCandleSeenAt:`2026-09-24T13:${11+i}:00+08:00`}}));
const input={identity,symbols,snapshot,calendar,asOf,rawEvidence:{contract:'daytrade_preopen_raw_rpc_evidence_v1',observation_trade_date:date,source_rpc:'get_fugle_daytrade_intraday_1m_latest_n',requested_symbols:symbols,observed_at:asOf,rows}};
const receipt=p=>({...identity,observed_at:asOf,writer_write_set:{plan:p}});
for(const p of producer.collect(input)){assert(verify(p.module_id,p.rows,receipt(p)));assert.equal(p.rows[0].ma20,100);const wrong=structuredClone(p.rows);wrong[0].ma20=99;assert(!verify(p.module_id,wrong,receipt(p)));}
for(const mutate of [x=>x.rawEvidence.rows.pop(),x=>x.rawEvidence.rows[0].synthetic=true,x=>x.rawEvidence.rows.push(x.rawEvidence.rows[0]),x=>x.rawEvidence.rows[0].payload.sourceCandleSeenAt='2026-09-30T00:00:00Z',x=>x.rawEvidence.rows[0].trade_date='2026-09-23']){const x=structuredClone(input);mutate(x);const p=producer.collect(x)[0];assert(!verify('A08',p.rows,receipt(p)));}
assert.throws(()=>producer.collect({...input,asOf:date+'T09:00:00+08:00'}));
console.log('PASS historical A08/A09 collect+verifier: original date preserved, recompute, missing/synthetic/duplicate/future/wrong-date rejection, intraday mode rejected');
const wide=structuredClone(input);
wide.symbols=Array.from({length:10},(_,i)=>String(1100+i));
wide.snapshot=require(base+'scripts/test-mother-ma20').snapshot(identity,wide.symbols,asOf);
wide.rawEvidence.requested_symbols=[...wide.symbols];
wide.rawEvidence.rows=wide.symbols.slice(0,9).flatMap(symbol=>rows.map(r=>({...structuredClone(r),symbol})));
let coverage=producer.collect(wide).find(p=>p.module_id==='A09');
assert.equal(coverage.rows[0].coverage_pct,90);
assert(verify('A09',coverage.rows,receipt(coverage)));
wide.rawEvidence.rows=wide.rawEvidence.rows.filter(r=>r.symbol!==wide.symbols[8]);
coverage=producer.collect(wide).find(p=>p.module_id==='A09');
assert.equal(coverage.rows[0].coverage_pct,80);
assert(!verify('A09',coverage.rows,receipt(coverage)));
console.log('PASS historical A09 fixed universe: 9/10 passes, 8/10 rejects');

