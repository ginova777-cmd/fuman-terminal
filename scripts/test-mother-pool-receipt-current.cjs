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

const {isCurrent:checkCurrent}=require('../lib/mother-pool-receipt-current.cjs');
const fixedNow=Date.parse('2026-09-17T02:02:00Z');
const isCurrent=(r,s,d)=>checkCurrent(r,s,d,{now:fixedNow});
const binding=bind(),receipt={checked_at:new Date(fixedNow).toISOString(),integrity_status:"PASS",realtime_status:"PASS",closed_loop_ok:true,complete:true,trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,snapshot_binding:binding};
assert.equal(isCurrent(receipt,JSON.stringify(s),s.trade_date),true);
for(const patch of [{generation:'next'},{snapshot_sequence:2},{mother_pool_run_id:'next'},{symbols:['2317']},{complete:false}])assert.equal(isCurrent(receipt,JSON.stringify({...s,...patch}),s.trade_date),false);
assert.equal(isCurrent(receipt,JSON.stringify(s),'2026-09-18'),false);
assert.equal(isCurrent({...receipt,closed_loop_ok:false},JSON.stringify(s),s.trade_date),false);
assert.equal(isCurrent({...receipt,snapshot_binding:{...binding,snapshot_readback_sha256:'a'.repeat(64)}},JSON.stringify(s),s.trade_date),false);
assert.equal(isCurrent(receipt,JSON.stringify(s)+' ',s.trade_date),false);
assert.equal(isCurrent(null,'bad',s.trade_date),false);
console.log('PASS same-count rollover, date, identity, bytes, evidence tampering and incomplete receipt; no network');

const legacy={...receipt}; delete legacy.complete; assert.equal(isCurrent(legacy,JSON.stringify(s),s.trade_date),true);
assert.equal(isCurrent({...receipt,complete:false},JSON.stringify(s),s.trade_date),false);

for(const patch of [{checked_at:null},{checked_at:'bad'},{checked_at:new Date(fixedNow-120001).toISOString()},{checked_at:new Date(fixedNow+1).toISOString()},{realtime_status:'NOT_DUE'},{realtime_status:'UNKNOWN'},{integrity_status:'FAIL'}])assert.equal(isCurrent({...receipt,...patch},JSON.stringify(s),s.trade_date),false);
assert.equal(isCurrent({...receipt,checked_at:new Date(fixedNow-120000).toISOString()},JSON.stringify(s),s.trade_date),true);
console.log('PASS receipt reuse expires after 120 seconds; missing/future/non-PASS assessments reverify');
