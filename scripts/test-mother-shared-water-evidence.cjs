'use strict';
const assert=require('node:assert/strict');
const {createVerifier,sha}=require('../lib/mother-shared-water-evidence.cjs');
const now=Date.parse('2026-10-06T05:00:00Z');
function fixture(){
 const id={symbol:'1216',trade_date:'2026-10-06',connection_id:'test-connection',subscription_id:'test-subscription'};
 const native={...id,contract:'mother-native-aggregate-evidence-v1',channel:'aggregates',received_at:'2026-10-06T04:59:55Z',is_synthetic:false,payload:{symbol:'1216',date:'2026-10-06',isTrial:false,lastUpdated:Date.parse('2026-10-06T04:59:54Z')*1000,lastTrade:{time:Date.parse('2026-10-06T04:55:00Z')*1000,price:70}}};
 const transport={...id,contract:'mother-transport-evidence-v1',events:[{sequence:1,kind:'ACK',channel:'aggregates',symbol:'1216',received_at:'2026-10-06T04:59:50Z'},{sequence:2,kind:'AGGREGATE',received_at:native.received_at}]};
 const publication={...id,contract:'mother-publication-evidence-v1',writer_run_id:'writer-test',generation:'generation-test',reader_role:'anon',row_count:1,write_completed_at:'2026-10-06T04:59:56Z',readback_at:'2026-10-06T04:59:57Z',collector_head_checked_at:'2026-10-06T04:59:58Z',row:{symbol:'1216',trade_date:'2026-10-06',last_trade_time:'2026-10-06T04:55:00Z',price:70}};
 const receipt={trade_date:'2026-10-06',writer_run_id:'writer-test',generation:'generation-test'};
 const row={symbol:'1216',trade_date:'2026-10-06',source_status:'NO_NEW_TRADE',last_trade_at:'2026-10-06T04:55:00Z',evidence_asof:'2026-10-06T04:59:59Z',evidence_valid_until:'2026-10-06T05:00:20Z',raw_evidence_ref:'raw',transport_evidence_ref:'transport',publication_evidence_ref:'publication'};
 row.source='Fugle.websocket.aggregates';
 publication.trade_head_status='NOT_CAPTURED';publication.collector_trade_head_sha256=null;
 publication.collector_capture_at='2026-10-06T04:59:58Z';
 return {native,transport,publication,receipt,row};
}
function materialize(f){const readback=Buffer.from(JSON.stringify([f.publication.row]));f.publication.readback_ref??='readback';f.publication.readback_bytes_sha256=sha(readback);const raw=Buffer.from(JSON.stringify(f.native));const hash=sha(raw);f.transport.events.at(-1).raw_sha256??=hash;f.publication.raw_sha256??=hash;f.publication.collector_head_sha256??=hash;const t=Buffer.from(JSON.stringify(f.transport)),p=Buffer.from(JSON.stringify(f.publication));Object.assign(f.row,{payload_sha256:hash,transport_sha256:sha(t),publication_sha256:sha(p)});return {raw,transport:t,publication:p,readback};}
function freshFixture(){const f=fixture();f.row.source_status='FRESH';f.row.last_trade_at='2026-10-06T04:59:54Z';f.row.quote_event_at=f.row.last_trade_at;f.native.payload.lastTrade.time=Date.parse(f.row.last_trade_at)*1000;f.publication.row.last_trade_time=f.row.last_trade_at;return f;}
module.exports={fixture,freshFixture,materialize};
if(require.main===module){
let cases=0;
function test(mutate,pass,byteMutate){const f=freshFixture();mutate(f);const store=materialize(f);if(byteMutate)byteMutate(store);const input=JSON.stringify(f);const result=createVerifier({resolve:r=>store[r],nowMs:()=>now})(f.row,f.receipt);assert.equal(result.verified,pass,JSON.stringify(result));assert.equal(result.continuity_verified,false);assert.equal(result.no_new_trade_verified,false);assert.equal(JSON.stringify(f),input);cases++;}
test(()=>{},true);
test(f=>{delete f.native.payload.isTrial;f.native.payload.lastTrade.time+=353;f.native.payload.lastUpdated+=353;},true);
test(f=>{f.row.source_status='FRESH';f.row.last_trade_at='2026-10-06T04:59:54Z';f.row.quote_event_at=f.row.last_trade_at;f.native.payload.lastTrade.time=Date.parse(f.row.last_trade_at)*1000;f.publication.row.last_trade_time=f.row.last_trade_at;},true);
for(const mutate of [
 f=>f.native.connection_id='',f=>f.transport.connection_id='wrong',f=>f.publication.subscription_id='old',
 f=>f.transport.events[0].kind='HEARTBEAT',f=>f.transport.events[0].symbol='9999',
 f=>f.transport.events[1].sequence=4,f=>f.transport.events[0].kind='DISCONNECTED',
 f=>f.native.payload.lastUpdated=Date.parse('2026-10-06T04:55:00Z')*1000,
 f=>f.native.payload.lastTrade.time=Date.parse('2026-10-05T04:55:00Z')*1000,
 f=>f.native.payload.isTrial=true,f=>f.native.is_synthetic=true,
 f=>f.row.evidence_valid_until='2026-10-06T05:03:00Z',f=>f.row.evidence_valid_until='2026-10-06T04:59:59Z',
 f=>f.publication.reader_role='service_role',f=>f.publication.row.price=71,
 f=>f.publication.generation='wrong',f=>f.publication.collector_head_sha256='a'.repeat(64),
 f=>f.publication.readback_at='2026-10-06T05:01:00Z',f=>f.native.payload.lastTrade.time=123,
 f=>f.row.source_status='NO_NEW_TRADE',f=>f.transport.events[1].raw_sha256='f'.repeat(64)
])test(mutate,false);
for(const forged of [false,true]){const f=fixture();if(forged)Object.assign(f.transport,{continuity_verified:true,sequence_scope:'provider_serial'});const store=materialize(f),r=createVerifier({resolve:x=>store[x],nowMs:()=>now})(f.row,f.receipt);assert.equal(r.verified,false);assert.ok(r.failed_checks.includes('NO_NEW_TRADE_CONTINUITY_UNPROVEN'));cases++;}
test(()=>{},false,store=>store.raw=Buffer.from('{}'));
test(()=>{},false,store=>delete store.transport);
console.log(JSON.stringify({ok:true,cases,mode:'isolated',production_connected:false,natural_evidence:false}));
}
