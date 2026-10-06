'use strict';
const assert=require('node:assert/strict');
const {freshFixture,materialize}=require('./test-mother-shared-water-evidence.cjs');
const {createVerifier}=require('../lib/mother-shared-water-evidence.cjs');
const now=Date.parse('2026-10-06T05:00:00Z');
function verify(version,age=6,mutate=()=>{}){
 const f=freshFixture();f.receipt.contract_version=version;
 const trade=now-age*1000,received=trade+100;
 f.native.payload.lastTrade.time=trade*1000;f.native.payload.lastUpdated=trade*1000;f.native.received_at=new Date(received).toISOString();
 f.transport.events[0].received_at=new Date(trade-1000).toISOString();f.transport.events[1].received_at=f.native.received_at;
 f.row.last_trade_at=f.row.quote_event_at=f.publication.row.last_trade_time=new Date(trade).toISOString();
 f.row.evidence_valid_until=new Date(Math.min(now+20000,trade+120000)).toISOString();
 f.publication.collector_head_sha256='a'.repeat(64);mutate(f);
 const bytes=materialize(f);return createVerifier({resolve:ref=>bytes[ref],nowMs:()=>now})(f.row,f.receipt);
}
let p=verify('1.1.0');assert.equal(p.verified,true);assert.equal(p.publication_verified,true);assert.equal(p.native_latest_verified,false);assert.equal(p.pipeline_caught_up,false);
assert.equal(verify('1.0.0').verified,false);
assert.equal(verify('1.1.0',90).verified,true);
assert.equal(verify('1.1.0',121).verified,false);
assert.equal(verify('1.1.0',6,f=>f.publication.row.price=99).verified,false);
assert.equal(verify('1.1.0',6,f=>f.native.is_synthetic=true).verified,false);
assert.equal(verify('1.1.0',6,f=>f.row.source_status='NO_NEW_TRADE').verified,false);
console.log(JSON.stringify({ok:true,cases:7,contract_version:'1.1.0',owner_approved_fresh_idle_separation:true,deployed:false}));
