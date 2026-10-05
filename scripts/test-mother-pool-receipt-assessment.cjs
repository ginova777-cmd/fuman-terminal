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

const {assess,REALTIME_CHECKS}=require('../lib/mother-pool-receipt-assessment.cjs');
const checks=Object.fromEntries([...REALTIME_CHECKS,'snapshot_generation_bound','snapshot_generation_unchanged'].map(k=>[k,true]));
const result={trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,checked_at:'2026-09-17T01:00:00Z',closed_loop_ok:false,complete:false,snapshot_binding:bind(),checks,components:{mother_pool:{rows:1}}};
const calendar={date:s.trade_date,isTradingDay:true,source:'cache',reason:'regular_weekday',calendar_evidence:{rows:[{Date:'1150101',Name:'test holiday'}],year:2026,source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetched_at:'2026-09-17T00:00:00Z'}};
const before=JSON.stringify(result);
assert.equal(assess(result,{calendar}).integrity_status,'PASS');
assert.equal(assess(result,{calendar}).realtime_status,'PASS');
assert.equal(JSON.stringify(result),before,'assessment must not change legacy verdict');
for(const [stamp,status] of [['2026-09-17T00:59:59Z','NOT_DUE'],['2026-09-17T01:00:00Z','PASS'],['2026-09-17T05:29:59Z','PASS'],['2026-09-17T05:30:00Z','NOT_DUE'],['invalid','UNKNOWN'],['2026-09-18T01:00:00Z','UNKNOWN']])assert.equal(assess({...result,checked_at:stamp},{calendar}).realtime_status,status);
for(const patch of [{date:'2026-09-16'},{source:'weekend_fallback'},{source:'stale_cache'},{override:true},{error:'failed'},{calendar_evidence:null},{calendar_evidence:{...calendar.calendar_evidence,fetched_at:'2026-09-01T00:00:00Z'}},{calendar_evidence:{...calendar.calendar_evidence,fetched_at:'2026-09-18T00:00:00Z'}}])assert.equal(assess(result,{calendar:{...calendar,...patch}}).realtime_status,'UNKNOWN');
assert.equal(assess(result,{calendar:{...calendar,isTradingDay:false,reason:'twse_closed_day'}}).realtime_status,'UNKNOWN','calendar verdict must match original evidence');
for(const key of REALTIME_CHECKS)assert.equal(assess({...result,checks:{...checks,[key]:false}},{calendar}).realtime_status,'FAIL');
assert.equal(assess({...result,snapshot_binding:null},{calendar}).integrity_status,'UNKNOWN');
assert.equal(assess({...result,snapshot_binding:{...result.snapshot_binding,symbols_sha256:'0'.repeat(64)}},{calendar}).integrity_status,'FAIL');
assert.equal(assess({...result,components:{mother_pool:{rows:2}}},{calendar}).integrity_status,'FAIL');
assert.equal(assess({...result,canonical_run_id:'wrong'},{calendar}).integrity_status,'FAIL');
assert.equal(assess({...result,checks:{...checks,snapshot_generation_unchanged:false}},{calendar}).integrity_status,'FAIL');
console.log('PASS independent integrity, hash corruption, identity, count, session boundaries, stale/missing calendar, live failures and unchanged legacy result');
