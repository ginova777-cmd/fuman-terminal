"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {valid}=require('../lib/strategy3-recovery-publish-evidence');
function sample(){return {contract:'strategy3-recovery-publish-evidence-v1',acceptance_scope:'after_close_three_surface_recovery',ok:true,source_readback_complete:true,complete:false,status:'ready_to_publish',run_id:'run',trade_date:'2026-09-24',verifier_ok:true,failed_checks:[],first_blocker:null,coverage_ratio:.91,database_readback:{run_rows:1,result_rows:7},result_count:7,three_surface_readback:Object.fromEntries(['api','desktop_terminal','mobile_fragment'].map(k=>[k,{runId:'run',count:7}]))};}
test('verified display source is publishable without declaring final completion or morning admission',()=>assert.equal(valid(sample(),'run','2026-09-24'),true));
test('partial coverage, DB mismatch, stale surfaces and failed verification reject publication',()=>{
 for(const change of [e=>e.coverage_ratio=.8,e=>e.database_readback.result_rows=6,e=>e.three_surface_readback.mobile_fragment.runId='old',e=>e.complete=true,e=>e.failed_checks=['source_gap'],e=>e.verifier_ok=false]){const e=sample();change(e);assert.equal(valid(e,'run','2026-09-24'),false);}
});
