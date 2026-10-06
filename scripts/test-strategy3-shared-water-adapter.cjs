'use strict';
const assert=require('node:assert/strict');
const {evaluate,symbolsHash}=require('../lib/strategy3-shared-water-adapter.cjs');
const now=Date.parse('2026-10-06T05:00:00Z');
const symbols=Array.from({length:20},(_,i)=>String(i).padStart(4,'0'));
const expected={contract_version:'draft-test-1',producer_version:'isolated-test',scope_definition_version:'draft-test-1',trade_date:'2026-10-06',canonical_run_id:'canonical-test',mother_pool_run_id:'snapshot-test',writer_run_id:'writer-test',generation:'snapshot-generation-test',snapshot_sequence:1,requested_symbols:symbols};
const proof=()=>Object.fromEntries(['verified','raw_hash_verified','identity_verified','native_latest_verified','pipeline_caught_up','subscription_generation_verified','continuity_verified','no_new_trade_verified'].map(k=>[k,true]));
function fixture(){return {...expected,contract:'mother-pool-shared-water-acceptance-v1',verification_run_id:'test',scope:'full_priority_pool',requested_symbols_sha256:symbolsHash(symbols),requested_count:20,unique_count:20,checked_at:'2026-10-06T05:00:00Z',source_asof:'2026-10-06T04:59:59Z',valid_until:'2026-10-06T05:00:30Z',status:'PASS',first_blocker:null,failed_checks:[],fresh_count:20,no_new_trade_count:0,unknown_count:0,unavailable_count:0,water_available_count:20,water_available_coverage:1,water_available_threshold:0.95,rows:symbols.map(symbol=>({symbol,trade_date:expected.trade_date,source_status:'FRESH',source:'fixture-only',last_trade_at:'2026-10-06T04:59:50Z',quote_event_at:'2026-10-06T04:59:50Z',evidence_asof:'2026-10-06T04:59:59Z',evidence_valid_until:'2026-10-06T05:00:30Z',raw_evidence_ref:'fixture',transport_evidence_ref:'fixture',payload_sha256:'a'.repeat(64)}))};}
let cases=0;
function run(r,pass,verifyEvidence=proof){const before=JSON.stringify(r);const out=evaluate(r,{nowMs:now,expected,verifyEvidence});assert.equal(out.water_gate_pass,pass,JSON.stringify(out));assert.equal(out.strategy3_scan_ready,false);assert.equal(out.formal_entry_authorization,false);assert.equal(JSON.stringify(r),before);cases++;}
run(fixture(),true);
const quiet=fixture();quiet.rows[0].source_status='NO_NEW_TRADE';quiet.rows[0].last_trade_at='2026-10-06T04:00:00Z';quiet.fresh_count=19;quiet.no_new_trade_count=1;run(quiet,true);
run(quiet,false,()=>({verified:true}));run(quiet,false,()=>({...proof(),continuity_verified:false}));run(quiet,false,()=>({...proof(),pipeline_caught_up:false}));run(quiet,false,()=>({...proof(),subscription_generation_verified:false}));run(quiet,false,()=>({...proof(),native_latest_verified:false}));run(quiet,false,null);
for(const mutate of [r=>r.generation='other',r=>r.requested_symbols_sha256='bad',r=>r.rows.pop(),r=>r.rows[1].symbol=r.rows[0].symbol,r=>r.valid_until='2026-10-06T04:59:59Z',r=>r.checked_at='2026-10-06T05:01:00Z',r=>r.scope='producer_formal_subset',r=>r.fresh_count=19,r=>r.rows[0].quote_event_at='2026-10-06T04:00:00Z',r=>r.rows[0].source_status='DISCONNECTED',r=>r.rows[0].trade_date='2026-10-05',r=>r.water_available_threshold=0.90]){const r=fixture();mutate(r);run(r,false);}
const boundary=fixture();boundary.rows[0].source_status='UNKNOWN';boundary.fresh_count=19;boundary.unknown_count=1;boundary.water_available_count=19;boundary.water_available_coverage=0.95;run(boundary,true);
boundary.rows[1].source_status='UNKNOWN';boundary.fresh_count=18;boundary.unknown_count=2;boundary.water_available_count=18;boundary.water_available_coverage=0.90;run(boundary,false);
run({...fixture(),requested_symbols:[],rows:[],requested_count:0,unique_count:0},false);
run(null,false);
const v11={...fixture(),contract_version:'1.1.0'},expected11={...expected,contract_version:'1.1.0'};
const published=()=>({...proof(),native_event_verified:true,publication_verified:true,native_latest_verified:false,pipeline_caught_up:false});
assert.equal(evaluate(v11,{nowMs:now,expected:expected11,verifyEvidence:published}).water_gate_pass,true);cases++;
assert.equal(evaluate(v11,{nowMs:now,expected:expected11,verifyEvidence:()=>({...published(),publication_verified:false})}).water_gate_pass,false);cases++;
const quiet11={...quiet,contract_version:'1.1.0'};assert.equal(evaluate(quiet11,{nowMs:now,expected:expected11,verifyEvidence:published}).water_gate_pass,false);cases++;
assert.equal(evaluate(v11,{nowMs:now,expected,verifyEvidence:published}).water_gate_pass,false);cases++;
assert.equal(symbolsHash(['0010','0001']),symbolsHash(['0001','0010']));
assert.throws(()=>symbolsHash(['0010','0010']));
console.log(JSON.stringify({ok:true,cases,mode:'isolated',production_connected:false,evidence_resolver:'fixture_only_not_production'}));
