'use strict';
const assert=require('node:assert/strict');
const {verifySnapshotReadback:verify}=require('../lib/mother-pool-snapshot-readback');
const time='2026-09-17T02:00:00Z',run='fixture';
const member={symbol:'2330',trade_date:'2026-09-17',mother_pool_run_id:run,mother_pool_snapshot_sequence:1,
 membership_status:'ACTIVE',membership_effective_at:time,added_at:time,removed_at:null,source_reason:'fixture',source_updated_at:time};
const s={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:run,mother_pool_run_id:run,
 snapshot_sequence:1,snapshot_type:'INTRADAY_FULL_SNAPSHOT',generated_at:time,effective_at:time,source_max_updated_at:time,
 status:'complete',complete:true,exit_code:0,first_blocker:null,previous_run_id:'',symbol_count:1,
 symbols:['2330'],added_symbols:['2330'],removed_symbols:[],symbol_membership:[member]};
const row={...s,...member};delete row.symbol_membership;
assert.equal(verify(s,[row],{role:'anon'}).complete,true);
for(const patch of [{snapshot_sequence:2},{canonical_run_id:'wrong'},{symbol_count:2},{complete:false},
 {symbols:[]},{membership_status:'REMOVED'},{source_updated_at:'2026-09-16T02:00:00Z'},
 {source_reason:'changed'},{mother_pool_run_id:'other'}])assert.equal(verify(s,[{...row,...patch}],{role:'anon'}).complete,false);
assert.equal(verify(s,[],{role:'anon'}).complete,false);
assert.equal(verify(s,[row,row],{role:'anon'}).complete,false);
assert.equal(verify(s,[row],{role:'service_role'}).complete,false);
const empty={...s,symbol_count:0,symbols:[],added_symbols:[],symbol_membership:[]};
assert.equal(verify(empty,[{...empty,symbol:null}],{role:'anon'}).complete,true);
assert.equal(verify(empty,[],{role:'anon'}).complete,false);
console.log('PASS snapshot readback: exact fields, mixed identity, duplicates, missing rows, role and empty summary');
