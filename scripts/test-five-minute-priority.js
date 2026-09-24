'use strict';
const assert=require('node:assert/strict');
const {collect,verify}=require('../lib/mother-pool-five-minute-priority');
function fixture(identity,minute=45){
 const f=require('./test-five-minute-module').fixture(identity,minute);
 const last=f.history.filter(row=>row.symbol===f.snapshot.symbols[1]).at(-1);
 Object.assign(last,{open:120,high:121,low:119,close:120});
 f.history=require('./daytrade-intraday-5m-v4').calculate(f.history,f.receipt.run_id,f.asOf);
 f.snapshot.symbol_membership=f.snapshot.symbols.map(symbol=>({symbol,mother_pool_run_id:identity.mother_pool_run_id,mother_pool_snapshot_sequence:identity.snapshot_sequence,membership_effective_at:f.snapshot.effective_at,membership_status:'ACTIVE'}));
 return f;
}
if(require.main===module){
 const identity={trade_date:'2026-09-18',canonical_run_id:'fugle_daytrade_source:20260918:canonical',writer_run_id:'a10:1',generation_id:'g1',mother_pool_run_id:'s1',snapshot_generation:'s1',snapshot_sequence:1};
 const f=fixture(identity),plan=collect(f),r={...identity,observed_at:f.asOf,writer_write_set:{plan}};let checks=0;
 assert(verify(plan.rows,r));checks++;
 assert.equal(plan.rows[0].priority_reason,'WAIT_5M_CONFIRMATION');assert.equal(plan.rows[0].warmup_rank,2);
 assert.equal(plan.rows[1].priority_reason,'CONFIRMED_STRONG_5M');assert.equal(plan.rows[1].warmup_rank,1);checks++;
 for(const mutate of [p=>p.rows[0].warmup_rank=99,p=>p.rows[0].priority_only=false,p=>p.rows[0].formal_candidate_allowed=true,p=>p.rows[0].publish_allowed=true,p=>p.rows[0].kd.k+=1,p=>p.rows[0].priority_reason='CONFIRMED_STRONG_5M_FAKE',p=>p.rows[0].source_history[0].is_synthetic=true,p=>p.rows[0].source_history[0].calculated_at='2026-09-18T14:00:00+08:00',p=>p.source_evidence.snapshot.generation='other',p=>p.source_evidence.snapshot.symbols.push('9999'),p=>p.rows.pop(),p=>p.rows[0].source_updated_at='2026-09-18T06:00:00+08:00']){
  const bad=structuredClone(plan);mutate(bad);assert(!verify(bad.rows,{...r,writer_write_set:{plan:bad}}));checks++;
 }
 const missing=collect({...f,receipt:null,history:[]});assert(missing.rows.every(x=>x.priority_reason==='DATA_GAP_5M'&&!x.bonus_eligible&&!x.formal_candidate_allowed));assert(!verify(missing.rows,{...r,writer_write_set:{plan:missing}}));checks++;
 console.log(JSON.stringify({checks,scope:'isolated_A10_priority_only',production_complete:false}));
}
module.exports={fixture};
