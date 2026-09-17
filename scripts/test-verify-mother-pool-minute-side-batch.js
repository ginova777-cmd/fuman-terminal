'use strict';
const assert=require('node:assert/strict'),{verify}=require('../lib/verify-mother-pool-minute-side-batch');
const b={contract:'mother_pool_minute_side_batch_v1',trade_date:'2026-09-17',canonical_run_id:'fugle_daytrade_source:20260917:canonical',
 mother_pool_run_id:'snapshot',snapshot_sequence:1,as_of:'2026-09-17T01:01:00Z',requested:1,source_ready:1,
 publish_allowed:false,creates_order:false,baseline_verified:false,details:[{symbol:'2330',status:'SOURCE_READY',side_event_age_seconds:30,
 latest:{stock_id:'2330',trade_date:'2026-09-17',timestamp:'2026-09-17T01:00:00Z',side_volume_timestamp:'2026-09-17T01:00:30Z',
 aggregation:'ONE_MINUTE',volume_unit:'LOTS',is_synthetic:false,complete:true,
 classification_source:'Fugle.aggregates.total.exact_trade_counter_boundaries',start_boundary_identity:'zero',end_boundary_identity:'native',
 outside_1m:7,inside_1m:2,unknown_1m:1,total_1m:10}}]};
Object.assign(b.details[0],{rolling_20m_rows:[],rolling_20m_observed_count:0,rolling_20m_missing_count:20});
const emptyBaseline={sample_count:0,zero_denominator_count:0,invalid_count:0,baseline:null,status:'INSUFFICIENT_SAMPLE'};
b.details[0].rolling_baseline={method:'ROLLING_20M_MEDIAN',minimum_samples:10,outside:{...emptyBaseline},inside:{...emptyBaseline}};
const context={role:'anon',dbReadback:true};assert.equal(verify(b,b,context).readback_verified,true);assert.equal(verify(b,b,context).complete,false);
const withRolling=structuredClone(b);
withRolling.as_of='2026-09-17T01:02:00Z';
Object.assign(withRolling.details[0],{rolling_20m_rows:[structuredClone(b.details[0].latest)],rolling_20m_observed_count:1,rolling_20m_missing_count:19});
Object.assign(withRolling.details[0].latest,{timestamp:'2026-09-17T01:01:00Z',side_volume_timestamp:'2026-09-17T01:01:30Z'});
withRolling.details[0].rolling_baseline.outside.sample_count=1;
withRolling.details[0].rolling_baseline.inside.sample_count=1;
assert.equal(verify(withRolling,withRolling,context).readback_verified,true);
for(const mutate of [x=>x.rolling_20m_missing_count=0,x=>x.rolling_20m_rows.push(x.rolling_20m_rows[0]),
 x=>x.rolling_20m_rows[0].total_1m=99,x=>x.rolling_20m_rows[0].stock_id='9999',
 x=>x.rolling_20m_rows[0].timestamp=x.latest.timestamp,x=>x.rolling_baseline.outside.baseline=3.5,
 x=>x.rolling_baseline.inside.status='READY',x=>x.rolling_baseline.outside.zero_denominator_count=1]){
 const x=structuredClone(withRolling);mutate(x.details[0]);assert.equal(verify(x,x,context).readback_verified,false);
}
for(const mutate of [x=>x.details[0].latest.total_1m=11,x=>x.details[0].latest.is_synthetic=true,
 x=>x.details[0].side_event_age_seconds=0,x=>x.source_ready=2,x=>x.details.push(x.details[0])]){
 const x=structuredClone(b);mutate(x);assert.equal(verify(x,x,context).readback_verified,false);
}
assert.equal(verify(b,{...b,as_of:'other'},context).readback_verified,false);
assert.equal(verify(b,b,{role:'owner',dbReadback:true}).readback_verified,false);
for(const mutate of [x=>x.details[0]=null,x=>x.details[0]=[],x=>x.details[0].symbol='bad',
 x=>x.snapshot_sequence=0,x=>x.as_of='2026-09-18T01:01:00Z',x=>delete x.details]){
 const x=structuredClone(b);mutate(x);assert.equal(verify(x,x,context).readback_verified,false);
}
// Both actual event timestamps are yesterday but the payload claims today's date.
const previousDay=structuredClone(b);
previousDay.details[0].latest.timestamp='2026-09-16T01:00:00Z';
previousDay.details[0].latest.side_volume_timestamp='2026-09-16T01:00:30Z';
assert(verify(previousDay,previousDay,context).failed_checks.includes('EVENT_TIME_INVALID:2330'));
console.log('PASS independent side readback arithmetic/time/source/count/identity/role guards; no overall COMPLETE');
