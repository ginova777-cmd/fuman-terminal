'use strict';
const assert=require('node:assert/strict'),{b24}=require('../lib/intraday-context-detectors-b19-b24');
const base={symbol:'2330',trade_date:'2026-09-18',canonical_run_id:'canonical',source_contract:'isolated',source_contract_ok:true};
const events=[{...base,event_id:'volume',type:'VOLUME_SPIKE',event_timestamp:'2026-09-18T09:31:00+08:00'},{...base,event_id:'price',type:'PRICE_SPIKE_UP',event_timestamp:'2026-09-18T09:32:00+08:00'}];
assert.equal(b24(events).length,2);assert(b24(events).every(x=>x.type==='EVENT_COMBINATION'&&!x.formal_candidate_allowed&&!x.publish_allowed));
let checks=2;
for(const change of [e=>e.symbol='2317',e=>e.trade_date='2026-09-17',e=>e.canonical_run_id='other',e=>delete e.symbol,e=>delete e.source_contract,e=>e.source_contract_ok=false,e=>e.event_timestamp='invalid',e=>e.event_timestamp='2026-09-18T09:34:01+08:00',e=>e.event_id='volume']){const copy=structuredClone(events);change(copy[1]);assert.deepEqual(b24(copy),[]);checks++;}
assert.deepEqual(b24(events,Infinity),[]);checks++;
assert.deepEqual(b24(events,181),[]);checks++;
const same=structuredClone(events);same[1].event_timestamp='2026-09-18T01:31:00Z';assert(b24(same).every(x=>x.same_bar_event));checks++;
console.log(JSON.stringify({status:'passed',checks,scope:'isolated_B24_identity',production_complete:false}));
