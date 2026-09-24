'use strict';
const assert=require('node:assert/strict');
const {verifySnapshotReadback:verify}=require('../lib/mother-pool-snapshot-readback');
const time='2026-09-17T02:00:00Z',run='fixture';
const member={symbol:'2330',trade_date:'2026-09-17',mother_pool_run_id:run,generation:run,mother_pool_snapshot_sequence:1,
 membership_status:'ACTIVE',membership_effective_at:time,added_at:time,removed_at:null,source_reason:'fixture',source_updated_at:time};
const s={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:run,generation:run,mother_pool_run_id:run,generation:run,
 snapshot_sequence:1,snapshot_type:'INTRADAY_FULL_SNAPSHOT',generated_at:time,effective_at:time,source_max_updated_at:time,
 status:'complete',complete:true,exit_code:0,first_blocker:null,previous_run_id:'',symbol_count:1,
 symbols:['2330'],added_symbols:['2330'],removed_symbols:[],symbol_membership:[member]};
const row={...s,...member};delete row.symbol_membership;
assert.equal(verify(s,[row],{role:'anon'}).complete,true);
assert.equal(verify({...s,generation:undefined},[row],{role:'anon'}).complete,false);
for(const patch of [{generation:'wrong'},{generation:undefined},{snapshot_sequence:2},{canonical_run_id:'wrong'},{symbol_count:2},{complete:false},
 {symbols:[]},{membership_status:'REMOVED'},{source_updated_at:'2026-09-16T02:00:00Z'},
 {source_reason:'changed'},{mother_pool_run_id:'other'}])assert.equal(verify(s,[{...row,...patch}],{role:'anon'}).complete,false);
assert.equal(verify(s,[],{role:'anon'}).complete,false);
assert.equal(verify(s,[row,row],{role:'anon'}).complete,false);
assert.equal(verify(s,[row],{role:'service_role'}).complete,false);
const empty={...s,symbol_count:0,symbols:[],added_symbols:[],symbol_membership:[]};
assert.equal(verify(empty,[{...empty,symbol:null}],{role:'anon'}).complete,true);
assert.equal(verify(empty,[],{role:'anon'}).complete,false);
console.log('PASS snapshot readback: exact fields, mixed identity, duplicates, missing rows, role and empty summary');
const producer=require('../lib/mother-pool-snapshot-module-producer');
const identity={trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,writer_run_id:'writer',generation_id:'writer-generation',mother_pool_run_id:run,snapshot_generation:run,snapshot_sequence:1};
const receipt={read_role:'anon',query_identity:{trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,mother_pool_run_id:run,generation:run,snapshot_sequence:1},pages:[{http_status:200,offset:0,rows:1,content_range:'0-0/1',row_data:[row]}]};
const input={identity,snapshot:s,receipt,asOf:'2026-09-17T02:00:10Z'};
assert.deepEqual(producer.collect(input).requested_symbols,['2330']);
const missing=structuredClone(receipt);delete missing.pages[0].row_data;assert.throws(()=>producer.collect({...input,receipt:missing}),/PAGE_INVALID/);
const partial=structuredClone(receipt);partial.pages[0].content_range='0-0/2';assert.throws(()=>producer.collect({...input,receipt:partial}),/PAGE_MISSING/);
const wrong=structuredClone(receipt);wrong.pages[0].row_data[0].membership_status='REMOVED';assert.throws(()=>producer.collect({...input,receipt:wrong}),/READBACK_INVALID/);
assert.throws(()=>producer.collect({...input,identity:{...identity,snapshot_generation:'other'}}),/WRITER_IDENTITY/);
console.log('PASS B11 producer: raw pages, exact requested membership, partial page and identity rejection');
