'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {preserveCloseout}=require('../lib/telegram-closeout-evidence');
const day='2026-09-16',run='pool:6',canonical='fugle_daytrade_source:20260916:canonical';
function previous(){return {trade_date:day,ok:true,complete:true,v4_contract_validated:true,mother_pool_run_id:run,snapshot_sequence:6,five_minute_role:'diagnostic_bonus_not_hard_gate',conditions:{five_minute_confirmation_required:false},checked_at:'2026-09-16T04:30:00Z',mother_pool_snapshot_evidence:{contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:day,canonical_run_id:canonical,mother_pool_run_id:run,snapshot_sequence:6,snapshot_type:'test',effective_at:'2026-09-16T01:00:00Z',complete:true,status:'complete',exit_code:0,symbol_count:1,symbols:['2330'],symbol_membership:[{symbol:'2330',mother_pool_run_id:run,mother_pool_snapshot_sequence:6,membership_effective_at:'2026-09-16T01:00:00Z',membership_status:'ACTIVE'}]}};}
function close(){return {trade_date:day,checked_at:'2026-09-16T04:31:00Z',first_blocker:'outside_trading_window',ok:true};}
test('closeout preserves the validated in-session snapshot',()=>{const r=close();preserveCloseout(r,previous());assert.equal(r.mother_pool_run_id,run);assert.equal(r.snapshot_sequence,6);assert.equal(r.closeout.source_evidence_preserved,true);});
for(const [name,mutate]of Object.entries({missingSnapshot:p=>delete p.mother_pool_snapshot_evidence,wrongDate:p=>p.trade_date='2026-09-15',failed:p=>p.ok=false,unvalidated:p=>p.v4_contract_validated=false,wrongRun:p=>p.mother_pool_run_id='other',wrongSequence:p=>p.snapshot_sequence=7,hardGate:p=>p.conditions.five_minute_confirmation_required=true}))test('reject '+name,()=>{const p=previous();mutate(p);const r=close();preserveCloseout(r,p);assert.equal(r.ok,false);assert.equal(r.closeout.source_evidence_preserved,false);});
// Legacy canonicalSentEvent/uniqueEvents were retired with the old notifier.
// Exercise the current durable event/delivery contract instead, with no network.
const {run:deliver,digest}=require('../lib/telegram-detectors/delivery-pipeline.cjs');
const batch={run_id:'unit-only',source_run_id:'unit-source',trade_date:day,mode:'live'};
const event={stock_id:'2330',trade_date:day,timestamp:'2026-09-16T02:00:00Z',event_type:'VOLUME_ANOMALY_EVENT',primary_ratio:3,data_gap:false,mother_pool_run_id:run,mother_pool_snapshot_sequence:6,membership_status:'ACTIVE'};
async function fixture(events=[event],targetCount=1){
 let db,sends=0;
 const result=await deliver({batch,events,now:'2026-09-16T02:01:00Z',targetCount,
 verifySource:async()=>({complete:true,run_id:batch.run_id,trade_date:day,events_sha256:digest(events),live_point_in_time_proven:true,failed_checks:[]}),
 store:async(k,p)=>{db=JSON.parse(JSON.stringify(p));},readback:async()=>db,
 send:async()=>{sends++;return [{sent:true,target_hash:'unit-target',message_id:1}];}});
 return {result,db,sends};
}
test('current persisted events retain snapshot identity across both DB writes',async()=>{
 const {db,result}=await fixture();assert.equal(result.integration_complete,true);
 assert.equal(db.events[0].mother_pool_snapshot_sequence,6);assert.equal(db.events[0].mother_pool_run_id,run);
 assert.equal(db.events_sha256,digest([event]));
});
test('sparse duplicate cannot erase full source evidence or repeat delivery',async()=>{
 const sparse={...event};delete sparse.mother_pool_run_id;delete sparse.mother_pool_snapshot_sequence;
 const {db,sends}=await fixture([event,sparse]);assert.equal(sends,1);
 assert.equal(db.events[0].mother_pool_snapshot_sequence,6);assert.equal(db.deliveries[0].confirmed_count,1);
});
test('missing target configuration never invents successful delivery',async()=>{
 // Explicit null represents missing configuration rather than the fixture default.
 const missing=await fixture([event],null);
 assert.equal(missing.sends,0);assert.equal(missing.result.integration_complete,false);
 assert.ok(missing.result.failed_checks.includes('NO_DELIVERY_TARGETS'));
});
test('distinct events retain distinct delivery identities',async()=>{
 const {result,sends}=await fixture([event,{...event,timestamp:'2026-09-16T01:59:00Z'}]);
 assert.equal(sends,2);assert.equal(new Set(result.deliveries.map(x=>x.event_id)).size,2);
 assert.equal(new Set(result.deliveries.map(x=>x.dedup_key)).size,2);
});
