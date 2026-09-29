'use strict';
const assert=require('node:assert/strict');
const {buildPlan}=require('../lib/mother-pool-minute-side-persistence');
const {reconcile}=require('../lib/mother-pool-minute-side-reconciliation');
const fixture=require('./fixtures/minute-side-r4-plan.json').rounds[0];
const plan=buildPlan(fixture.result,fixture.snapshot);
const ws={...plan,status:'written',written_symbols:plan.source_rows.map(r=>r.symbol),round_written_symbols:plan.round_rows.map(r=>r.symbol)};
let checks=0;
for(const id of ['B14','B20']){
 const side=id==='B14'?'outside':'inside';
 // Independent projection of the published SQL View, from the original plan.
 const rows=plan.source_rows.map(s=>({...s,...plan.round_rows.find(r=>r.symbol===s.symbol),module_id:id,event_time:s.minute_start,written:true,
  baseline_value:s[side+'_baseline_value'],baseline_sample_count:s[side+'_baseline_sample_count'],dynamic_ratio:s[side+'_dynamic_ratio'],side_state:s[side+'_side_state']}));
 const identity={...plan,module_id:id};
 assert.deepEqual(reconcile(ws,rows,rows,identity).failed_checks,[]);checks++;
 for(const mutation of [
  r=>{r.inside_1m+=10;r.total_1m+=10;},
  r=>{r.baseline_value+=1;},r=>{r.dynamic_ratio=0;},
  r=>{r.side_volume_timestamp='2026-09-18T02:20:58Z';},
  r=>{r.start_boundary_identity='wrong';},r=>{r.side_state='OUTSIDE_ONLY';},
  r=>{r.module_id=id==='B14'?'B20':'B14';}
 ]){
  const bad=structuredClone(rows);mutation(bad[0]);
  assert(reconcile(ws,bad,bad,identity).failed_checks.length>0,'both roles must not agree on a wrong producer value');checks++;
 }
 const reordered=structuredClone(rows);reordered[0].side_volume_timestamp=new Date(reordered[0].side_volume_timestamp).toISOString();
 assert.deepEqual(reconcile(ws,reordered,rows,identity).failed_checks,[]);checks++;
 const missing=structuredClone(ws);missing.source_rows.pop();
 assert(reconcile(missing,rows,rows,identity).failed_checks.includes('WRITE_SOURCE_SET_MISMATCH'));checks++;
 const dup=structuredClone(ws);dup.source_rows.push(dup.source_rows[0]);
 assert(reconcile(dup,rows,rows,identity).failed_checks.includes('WRITE_SOURCE_SET_MISMATCH'));checks++;
}
console.log(JSON.stringify({status:'passed',checks,scope:'isolated_writer_plan_vs_both_readbacks',production_complete:false}));
