'use strict';
const assert=require('node:assert/strict');
const {fixture,freshFixture,materialize}=require('./test-mother-shared-water-evidence.cjs');
const {createVerifier}=require('../lib/mother-shared-water-evidence.cjs');
const {build}=require('../lib/mother-shared-water-producer.cjs');
const {evaluate}=require('../lib/strategy3-shared-water-adapter.cjs');
const now=Date.parse('2026-10-06T05:00:00Z');
function integration(badCount=0,corruptAfter=false,idle=false){
 const identity={trade_date:'2026-10-06',canonical_run_id:'canonical-test',mother_pool_run_id:'mother-test',writer_run_id:'writer-test',generation:'generation-test',snapshot_sequence:1,producer_version:'isolated-test',verification_run_id:'test-only'};
 const symbols=Array.from({length:20},(_,i)=>String(1200+i));const store={},rows=[];
 for(const symbol of symbols){const f=idle?fixture():freshFixture();for(const v of [f.native,f.native.payload,f.transport,f.publication,f.publication.row,f.row])v.symbol=symbol;f.transport.events[0].symbol=symbol;
  f.publication.readback_ref=symbol+'/readback';const blobs=materialize(f);for(const [key,bytes]of Object.entries(blobs))store[symbol+'/'+key]=bytes;
  Object.assign(f.row,{source:'Fugle.websocket.aggregates',raw_evidence_ref:symbol+'/raw',transport_evidence_ref:symbol+'/transport',publication_evidence_ref:symbol+'/publication'});rows.push(f.row);
 }
 for(let i=0;i<badCount;i++)delete store[symbols[i]+'/publication'];
 const resolve=ref=>store[ref];const receipt=build({identity,prioritySymbols:symbols,snapshotBytes:Buffer.from(JSON.stringify({...identity,symbols:[...symbols,'2330']})),evidenceRows:rows,resolve,checkedAt:new Date(now).toISOString(),validUntil:'2026-10-06T05:00:30Z'});
 if(corruptAfter)store[symbols.at(-1)+'/raw']=Buffer.from('{}');
 const expected={...identity,contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',requested_symbols:symbols};
 const result=evaluate(receipt,{nowMs:now,expected,verifyEvidence:createVerifier({resolve,nowMs:()=>now})});
 return {receipt,result};
}
let r=integration();assert.equal(r.receipt.fresh_count,20);assert.equal(r.result.water_gate_pass,true);assert.equal(r.result.strategy3_scan_ready,false);assert.deepEqual(r.receipt.snapshot_not_in_priority,['2330']);
r=integration(1);assert.equal(r.receipt.water_available_coverage,.95);assert.equal(r.result.water_gate_pass,true);
r=integration(2);assert.equal(r.receipt.status,'BLOCKED');assert.equal(r.result.water_gate_pass,false);
r=integration(0,true);assert.equal(r.receipt.status,'PASS');assert.equal(r.result.water_gate_pass,false);assert.ok(r.result.failed_checks.some(x=>x.startsWith('independent_evidence_unverified')));
r=integration(0,false,true);assert.equal(r.receipt.no_new_trade_count,0);assert.equal(r.receipt.unknown_count,20);assert.equal(r.result.water_gate_pass,false);assert.ok(r.receipt.rows.every(row=>row.reason_codes.includes('NO_NEW_TRADE_CONTINUITY_UNPROVEN')));
console.log(JSON.stringify({ok:true,cases:5,mode:'producer_real_resolver_consumer_isolated',fixture_native_data:true,production_connected:false}));
