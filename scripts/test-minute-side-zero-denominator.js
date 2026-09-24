'use strict';
const assert=require('node:assert/strict');
const fixture=require('./fixtures/minute-side-r4-plan.json').rounds[0];
const {buildPlan}=require('../lib/mother-pool-minute-side-persistence');
const {createVerifier}=require('../lib/verify-mother-pool-module-round');
for(const [inside,outside,b14,b20] of [[0,100,'OUTSIDE_ONLY','RATIO_VALID'],[100,0,'RATIO_VALID','INSIDE_ONLY'],[0,0,'NO_VALID_SIDE_VOLUME','NO_VALID_SIDE_VOLUME'],[100,200,'RATIO_VALID','RATIO_VALID']]){
 const f=structuredClone(fixture),d=f.result.payload.mother_pool_minute_side_evidence.details.find(x=>x.latest);
 Object.assign(d.latest,{inside_1m:inside,outside_1m:outside,unknown_1m:0,total_1m:inside+outside});
 d.rolling_baseline={method:'ROLLING_20M_MEDIAN',outside:{sample_count:20,baseline:2},inside:{sample_count:20,baseline:0.5}};
 const p=buildPlan(f.result,f.snapshot),r=p.source_rows.find(x=>x.symbol===d.symbol);
 assert.equal(r.outside_side_state,b14);assert.equal(r.inside_side_state,b20);
 for(const moduleId of ['B14','B20']){
  const direction=moduleId==='B14'?'outside':'inside';
  const row={...r,baseline_value:r[direction+'_baseline_value'],baseline_sample_count:r[direction+'_baseline_sample_count'],dynamic_ratio:r[direction+'_dynamic_ratio'],side_state:r[direction+'_side_state']};
  const rawField='raw_'+direction+'_ratio',strengthField=direction+'_strength',zero=moduleId==='B14'?inside===0:outside===0;
  assert.equal(createVerifier(moduleId).minuteSideFormulaOk(moduleId,row),true);
  if(zero){assert.equal(row[rawField],null);assert.equal(row[strengthField],null);assert.equal(row.dynamic_ratio,null);assert.equal(createVerifier(moduleId).minuteSideFormulaOk(moduleId,{...row,[rawField]:0,[strengthField]:0,dynamic_ratio:0}),false);}
  else assert.equal(createVerifier(moduleId).minuteSideFormulaOk(moduleId,{...row,dynamic_ratio:null}),false);
 }
}
console.log(JSON.stringify({status:'passed',scope:'isolated_side_zero_denominator',production_complete:false}));
