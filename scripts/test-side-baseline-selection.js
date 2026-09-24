'use strict';
const assert=require('node:assert/strict');
const {select,HISTORY}=require('../lib/mother-pool-side-baseline-selection');
const {buildPlan}=require('../lib/mother-pool-minute-side-persistence');
const {createVerifier}=require('../lib/verify-mother-pool-module-round');
const fixture=require('./fixtures/minute-side-r4-plan.json').rounds[0];
const dates=['2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14','2026-09-15','2026-09-16','2026-09-17'];
function prepare(slot){
 const f=structuredClone(fixture),side=f.result.payload.mother_pool_minute_side_evidence;
 const start=Date.parse('2026-09-18T'+slot+':00+08:00');side.as_of=new Date(start+61000).toISOString();
 for(const d of side.details){
  d.latest.timestamp=new Date(start).toISOString();d.latest.side_volume_timestamp=new Date(start+59000).toISOString();
  d.same_minute_historical_baselines={contract:'mother_pool_a16_minute_reference_v1',trade_date:side.trade_date,canonical_run_id:side.canonical_run_id,generation:'a16:verified',symbol:d.symbol,minute:slot,rows:['OUTSIDE_STRENGTH','INSIDE_STRENGTH'].map((type,i)=>({symbol:d.symbol,trade_date:side.trade_date,canonical_run_id:side.canonical_run_id,minute:slot,baseline_type:type,baseline_value:i?0.25:4,sample_count:10,source_trade_dates:dates,unit:'RATIO',status:'READY',data_gap:false,is_synthetic:false}))};
 }
 return f;
}
let checks=0;
for(const slot of ['09:00','09:20','09:21']){
 const f=prepare(slot),p=buildPlan(f.result,f.snapshot),early=slot<='09:20';
 for(const r of p.source_rows){
  assert.equal(r.baseline_method,early?HISTORY:'ROLLING_20M_MEDIAN');
  assert.equal(r.outside_baseline_value,early?4:1.5);assert.equal(r.inside_baseline_value,early?0.25:0.5);checks++;
  for(const id of ['B14','B20']){
   const side=id==='B14'?'outside':'inside',row={...r,baseline_value:r[side+'_baseline_value'],baseline_sample_count:r[side+'_baseline_sample_count'],dynamic_ratio:r[side+'_dynamic_ratio'],side_state:r[side+'_side_state']};
   assert(createVerifier(id).minuteSideFormulaOk(id,row));
   assert(!createVerifier(id).minuteSideFormulaOk(id,{...row,baseline_method:early?'ROLLING_20M_MEDIAN':HISTORY}));checks++;
  }
 }
}
for(const mutation of [d=>{delete d.same_minute_historical_baselines;},d=>{d.same_minute_historical_baselines.symbol='9999';},d=>{d.same_minute_historical_baselines.minute='09:19';},d=>{d.same_minute_historical_baselines.trade_date='2026-09-17';},d=>{d.same_minute_historical_baselines.rows[0].source_trade_dates=[...dates.slice(0,9),'2026-09-18'];},d=>{d.same_minute_historical_baselines.rows[0].sample_count=9;},d=>{d.same_minute_historical_baselines.rows[0].baseline_value=0;}]){
 const f=prepare('09:20'),side=f.result.payload.mother_pool_minute_side_evidence,d=side.details[0];mutation(d);
 const b=select(d,side);assert.equal(b.method,HISTORY);assert.equal(b.outside.baseline,null);assert.equal(b.outside.status,'DATA_GAP');checks++;
}
const directional=prepare('09:20'),d=directional.result.payload.mother_pool_minute_side_evidence.details[0];d.same_minute_historical_baselines.rows[1].sample_count=9;
const b=select(d,directional.result.payload.mother_pool_minute_side_evidence);assert.equal(b.outside.status,'READY');assert.equal(b.inside.status,'DATA_GAP');checks++;
console.log(JSON.stringify({status:'passed',checks,scope:'isolated_side_baseline_time_selection',production_complete:false}));

module.exports={prepare};
