'use strict';
const assert=require('node:assert/strict');
const {collect}=require('../lib/mother-pool-minute-side-batch');
const snapshot={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',mother_pool_run_id:'fixed-snapshot',run_id:'unrelated-writer-run',snapshot_sequence:1,
 snapshot_type:'OPENING_SNAPSHOT',effective_at:'2026-09-17T00:59:00Z',status:'complete',complete:true,exit_code:0,first_blocker:null,
 symbols:['2330'],symbol_count:1,removed_symbols:[],symbol_membership:[{symbol:'2330',mother_pool_run_id:'fixed-snapshot',mother_pool_snapshot_sequence:1,membership_status:'ACTIVE',membership_effective_at:'2026-09-17T00:59:00Z'}]};
const options={snapshot,asOf:'2026-09-17T01:01:00Z',runtimeRoot:'unused',deadlineMs:0};
assert.equal(collect(options).mother_pool_run_id,'fixed-snapshot');
const withoutAlias=structuredClone(snapshot);delete withoutAlias.run_id;
assert.equal(collect({...options,snapshot:withoutAlias}).mother_pool_run_id,'fixed-snapshot');
assert.throws(()=>collect({...options,asOf:'2026-09-17T00:58:00Z'}),/NOT_EFFECTIVE/);
console.log('PASS minute side binds authoritative snapshot identity, not Writer alias; future membership rejected');
