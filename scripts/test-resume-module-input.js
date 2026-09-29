'use strict';
const assert=require('node:assert/strict'),{resumeInput}=require('../lib/mother-pool-resume-module-input');
const input={module_id:'A01',trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1,created_at:'2026-09-29T00:00:00Z',requested_symbols:['2330'],rows:[{symbol:'2330',status:'DATA_GAP',data_gap_reason:'source missing',source:'test',source_contract:'preopen_a01_identity_receipt_v1',source_updated_at:'2026-09-29T00:00:00Z',is_synthetic:false,replay:false,look_ahead:false}]};
(async()=>{
 for(const mode of ['new','committed','uncertain','timeout_committed','timeout_missing','partial']){
  let document,writes=0,attempt=false,saved=false;
  const remote=()=>({rounds:[{module_id:'A01',trade_date:input.trade_date,writer_run_id:'w',document,committed_at:input.created_at}],rows:document.plan.rows.map(evidence=>({module_id:'A01',trade_date:input.trade_date,writer_run_id:'w',symbol:evidence.symbol,evidence}))});
  const adapter={validatePlan:async d=>{document=d},readCommitted:async()=>mode==='committed'||(writes&&mode==='timeout_committed')?remote():mode==='partial'?{...remote(),rows:[]}:{rounds:[],rows:[]},hasAttempt:async()=>mode==='uncertain'||attempt,saveAttempt:async()=>{attempt=true},persist:async()=>{writes++;assert(attempt);if(mode.startsWith('timeout'))throw Object.assign(Error('timeout'),{name:'TimeoutError'});return {committed:true,...input,plan_hash:document.plan_hash,written_symbols:['2330']};},saveEvidence:async()=>{saved=true}};
  if(['uncertain','timeout_missing','partial'].includes(mode)){await assert.rejects(resumeInput(input,adapter));assert.equal(saved,false);}else{const result=await resumeInput(input,adapter);assert.equal(result.plan.rows[0].status,'DATA_GAP');assert(saved);}
  assert.equal(writes,['new','timeout_committed','timeout_missing'].includes(mode)?1:0);
 }
 console.log('PASS one-input recovery: prior commit reused, uncertain/partial states blocked, timeout exact ACK only, never duplicate POST');
})().catch(e=>{console.error(e);process.exitCode=1;});
