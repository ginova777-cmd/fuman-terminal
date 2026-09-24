'use strict';
const assert=require('node:assert/strict'),{collect,verify}=require('../lib/mother-pool-identity-source');
function fixture(){
 const date='2026-09-18',asOf=date+'T06:01:00+08:00';
 const identity={trade_date:date,canonical_run_id:'fugle_daytrade_source:20260918:canonical',writer_run_id:'instance:20260918:g1',generation_id:'g1',mother_pool_run_id:'s1',snapshot_generation:'s1',snapshot_sequence:1};
 const calendar={trade_date:date,market:'TW',is_open:true,payload:{checked_at:date+'T06:00:10+08:00',calendar_decision:{date,isTradingDay:true,source:'cache',calendar_evidence:{source:'cache',fetched_at:date+'T05:00:00+08:00',year:2026,source_url:'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',rows:[{Date:'1150101',Name:'休市'}]}}}};
 const lease={ok:true,status:'claimed',sourceName:'fugle_daytrade_source',hostId:'host',instanceId:'instance',rpcEvidence:{ok:true,claimed:true,source_name:'fugle_daytrade_source',writer_host_id:'host',writer_instance_id:'instance',trade_date:date,heartbeat_at:date+'T06:00:00+08:00',lease_expires_at:date+'T06:05:00+08:00'}};
 return {identity,symbols:['2330','2317'],calendar,lease,asOf};
}
if(require.main===module){
 const f=fixture(),p=collect(f);assert(p.rows.every(r=>r.status==='READY'&&verify(r,{...f.identity,observed_at:f.asOf,writer_write_set:{plan:p}})));let checks=1;
 for(const change of [x=>x.lease.status='lease_optional',x=>x.lease.rpcEvidence.writer_host_id='other',x=>x.lease.rpcEvidence.lease_expires_at=x.asOf,x=>x.identity.writer_run_id='old',x=>x.calendar.payload.calendar_decision.override=true,x=>x.calendar.payload.calendar_decision.calendar_evidence.source='stale_cache',x=>x.calendar.payload.calendar_decision.calendar_evidence.rows.push({Date:'1150918',Name:'休市'}),x=>x.calendar.payload.calendar_decision.calendar_evidence.year=2025,x=>x.calendar.payload.calendar_decision.calendar_evidence.fetched_at='2026-09-01T00:00:00Z',x=>x.calendar.payload.calendar_decision.calendar_evidence.source_url='https://example.com',x=>x.lease.rpcEvidence.heartbeat_at='2026-09-18T07:00:00+08:00']){const bad=structuredClone(f);change(bad);const plan=collect(bad);assert(plan.rows.every(r=>r.status==='DATA_GAP'));assert(!verify(plan.rows[0],{...bad.identity,observed_at:bad.asOf,writer_write_set:{plan}}));checks++;}
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_A01_calendar_and_lease',production_complete:false}));
}
module.exports={fixture};
