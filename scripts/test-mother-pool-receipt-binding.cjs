'use strict';
const assert=require('node:assert/strict');
const {bindReceipt,validateReceipt}=require('../lib/mother-pool-receipt-binding');
const time='2026-09-17T02:00:00Z',run='fixture';
const member={symbol:'2330',trade_date:'2026-09-17',mother_pool_run_id:run,generation:run,mother_pool_snapshot_sequence:1,
 membership_status:'ACTIVE',membership_effective_at:time,added_at:time,removed_at:null,source_reason:'fixture',source_updated_at:time};
const s={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:run,generation:run,mother_pool_run_id:run,generation:run,
 snapshot_sequence:1,snapshot_type:'INTRADAY_FULL_SNAPSHOT',generated_at:time,effective_at:time,source_max_updated_at:time,
 status:'complete',complete:true,exit_code:0,first_blocker:null,previous_run_id:'',symbol_count:1,
 symbols:['2330'],added_symbols:['2330'],removed_symbols:[],symbol_membership:[member]};
const row={...s,...member};delete row.symbol_membership;

const proof={...Object.fromEntries(['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence'].map(k=>[k,s[k]])),status:'complete',complete:true,exit_code:0,failed_checks:[],first_blocker:null,verified_at:'2026-09-17T02:01:00Z',read_role:'anon',query_identity:{trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,mother_pool_run_id:run,generation:run,snapshot_sequence:1},pages:[{http_status:200,offset:0,rows:1,content_range:'0-0/1',row_data:[row]}]};
function bind(snapshot=s,readback=proof,symbols=['2330']){return bindReceipt({snapshotRaw:JSON.stringify(snapshot),readbackRaw:JSON.stringify(readback),tradeDate:s.trade_date,canonicalRunId:s.canonical_run_id,symbols});}
const binding=bind(),receipt={...binding,mother_pool_rows:1,complete:true,failed_checks:[],first_blocker:null,verified_at:'2026-09-17T02:02:00Z'};
assert.equal(validateReceipt(receipt,binding,['2330']).ok,true);
for(const patch of [{generation:'other'},{snapshot_sequence:2},{trade_date:'2026-09-16'},{canonical_run_id:'other'},{complete:false},{symbols_sha256:'a'.repeat(64)},{receipt_generation_verified:false},{snapshot_readback_count:2},{snapshot_readback_verified_at:'2099-01-01T00:00:00Z'}])assert.equal(validateReceipt({...receipt,...patch},binding,['2330']).ok,false);
for(const patch of [{complete:false},{read_role:'service_role'},{generation:'other'},{verified_at:'2099-01-01T00:00:00Z'},{verified_at:'2026-09-17T01:59:00Z'},{pages:[]}])assert.throws(()=>bind(s,{...proof,...patch}));
assert.throws(()=>bind(s,proof,['2317']));assert.throws(()=>bind(s,proof,['2330','2330']));
const removed={...member,symbol:'2317',membership_status:'REMOVED',removed_at:time};const ss={...s,removed_symbols:['2317'],symbol_membership:[member,removed]};const rr=ss.symbol_membership.map(m=>{const r={...ss,...m};delete r.symbol_membership;return r;});const pp={...proof,pages:[{http_status:200,offset:0,rows:2,content_range:'0-1/2',row_data:rr}]};assert.equal(bind(ss,pp).snapshot_readback_count,1);
console.log('PASS: producer/consumer same generation, exact active membership, removed members, tampered evidence, role, counts and time; no network.');
