'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const rt=fs.mkdtempSync(path.join(os.tmpdir(),'preopen-stage-')),date='2026-10-13',asOf=date+'T08:50:05+08:00';
const identity={trade_date:date,canonical_run_id:'test',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1},symbols=['2330'];
const raw=['08:45','08:50','08:55','08:59'].map(slot=>{const t=date+'T'+slot+':00+08:00';return {symbol:'2330',trade_date:date,observed_at:t,trial_price:100,is_trial:true,payload:{trade_date:date,run_id:'preopen_snapshot_history_v2:20261013',generation_id:'2330:'+t,observed_at:t,trial_event_at:t,source:'fugle_daytrade_source_writer:preopen_websocket',writer_contract:'preopen_snapshot_history_v2',trial_event_time_source:'provider_trial_event'}};});
const checkpoint=require('../lib/mother-pool-module-input-checkpoint'),closure=require('../lib/mother-pool-preopen-closure');
let count=0;
function input(rows=raw.slice(0,2)){return require('../lib/mother-pool-natural-trial').collect({identity,symbols,history:{rows,readback:{status:'READ',source:'fugle_preopen_snapshot_history',trade_date:date,observed_at:asOf}},asOf});}
function save(plan){return checkpoint.save({directory:path.join(rt,'data/module-input-checkpoints',date),identity,inputs:[plan],observedAt:asOf});}
function check(ref,stamp=asOf){return closure.collect({moduleId:'A14',identity,symbols,references:{},asOf:stamp,runtime:rt,stageInputCheckpoint:ref});}
const plan=input(),ref=save(plan),result=check(ref);
assert.equal(result.rows[0].dependencies.A13.status,'READY');assert.equal(result.rows[0].dependencies.A13.final_complete,false);assert.equal(result.rows[0].readiness_scope,'PREOPEN_STAGE_ONLY');assert.equal(result.rows[0].status,'DATA_GAP','Missing other parents must still block');count++;
for(const rows of [raw.slice(0,1),raw,raw.slice(0,2).map(x=>({...x,trade_date:'2026-10-12'})),raw.slice(0,2).map(x=>({...x,payload:{...x.payload,trial_event_time_source:'quote_seen_at'}}))]){assert.equal(check(save(input(rows))).rows[0].dependencies.A13.reason,'STAGE_TRIAL_SOURCE_INVALID');count++;}
assert.equal(check({...ref,content_sha256:'0'.repeat(64)}).rows[0].dependencies.A13.reason,'MODULE_INPUT_CHECKPOINT_MISMATCH');count++;
assert.equal(check(null).rows[0].dependencies.A13.reason,'STAGE_CHECKPOINT_REQUIRED');count++;
assert.equal(check(ref,date+'T08:59:00+08:00').rows[0].dependencies.A13.reason,'PARENT_REFERENCE_INVALID','Stage checkpoint cannot replace final parent receipt');count++;
assert.equal(closure.verify(result.rows,{...identity,module_id:'A14',observed_at:asOf,writer_write_set:{plan:result}}),false,'Stage cannot be final proof');count++;
console.log(JSON.stringify({status:'PASS',checks:count,test_only:true}));
