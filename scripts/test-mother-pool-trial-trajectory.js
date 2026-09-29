'use strict';
const assert=require('node:assert/strict'),{collect,verify}=require('../lib/mother-pool-trial-trajectory');
const date='2026-09-29',asOf=date+'T01:00:00Z';
const identity={trade_date:date,canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
const raw=['08:45','08:50','08:55','08:59'].map((slot,i)=>({symbol:'2330',trade_date:date,observed_at:`${date}T${slot}:00+08:00`,trial_price:100+i,is_trial:true,payload:{trial_event_at:`${date}T${slot}:00+08:00`,source:'fugle_daytrade_source_writer:preopen_websocket',writer_contract:'preopen_snapshot_history_v2',trial_event_time_source:'provider_trial_event'}}));
const readback={status:'READ',source:'fugle_preopen_snapshot_history',trade_date:date,observed_at:asOf};
const build=rows=>collect({identity,symbols:['2330','2317'],history:{rows,readback},asOf});
for(const invalid of [undefined,'','invalid-date','2026-09-30T01:00:00Z']){
 const bad=collect({identity,symbols:['2330'],history:{rows:raw,readback},asOf:invalid});
 assert.equal(bad.rows[0].status,'DATA_GAP');assert.equal(verify(bad.rows[0],{...identity,observed_at:invalid}),false);
}
const good=build(raw),round={...identity,observed_at:asOf};
assert.equal(good.rows[0].status,'READY');assert(verify(good.rows[0],round));
assert.equal(good.rows[1].status,'DATA_GAP');assert.equal(verify(good.rows[1],round),false);
assert.deepEqual(good.rows[0].price_changes.map(x=>x.change),[1,1,1]);
for(const mutate of [r=>{r.pop();},r=>r.push(structuredClone(r[0])),r=>{r[0].trade_date='2026-09-28';},r=>{r[0].payload.trial_event_time_source='quote_seen_at';},r=>{r[0].payload.synthetic=true;},r=>{r[0].observed_at=date+'T08:46:00+08:00';}]){
 const rows=structuredClone(raw);mutate(rows);assert.equal(build(rows).rows[0].status,'DATA_GAP');
}
for(const malformed of [null,42,[],false])assert.equal(build([...raw,malformed]).rows[0].status,'DATA_GAP');
const tampered=structuredClone(good.rows[0]);tampered.trajectory[0].price=999;assert.equal(verify(tampered,round),false);
const reordered=structuredClone(good.rows[0]);reordered.raw_trials=reordered.raw_trials.map(r=>Object.fromEntries(Object.entries(r).reverse()));assert(verify(reordered,round));
assert.equal(verify(good.rows[0],{...round,observed_at:date+'T00:58:00Z'}),false);
console.log('PASS A17 raw provenance, four slots, missing/duplicate/stale/synthetic/future/tampered evidence and JSONB key order');
(async()=>{
 const input=collect({identity,symbols:['2330'],history:{rows:raw,readback},asOf});
 const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
 const {hash}=require('../lib/mother-pool-module-write-set');
 const ws=await persistModuleRound(input,{savePlan:async()=>{},saveEvidence:async()=>{},persist:async body=>{
  const doc=JSON.parse(body.p_document);return {...identity,module_id:'A17',committed:true,committed_at:asOf,plan_hash:doc.plan_hash,written_symbols:['2330']};
 }});
 const rows=input.rows.map(r=>({...identity,...structuredClone(r)}));
 const surface=()=>({query_identity:identity,missing:[],extra:[],pages:[{query_identity:identity,http_status:200,page_index:0,page_size:500,offset:0,content_range:'0-0/1',rows:structuredClone(rows)}]});
 const r={...round,module_id:'A17',contract:require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json').modules.A17,run_id:'isolated',status:'verified',source_contract_ok:true,db_readback_ok:true,anon_readback_ok:true,failed_checks:[],natural_evidence:true,requested:1,written:1,readback:1,unique_symbols:1,writer_write_set:ws,db_readback:surface(),anon_readback:surface()};
 const gate=require('../lib/verify-mother-pool-module-round').createVerifier('A17');
 assert(gate.validRound(r));
 // Even consistently tampering with producer and both readbacks cannot pass
 // business verification when the raw source provenance is invalid.
 const bad=structuredClone(r);
 const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 for(const row of [bad.writer_write_set.plan.rows[0],bad.db_readback.pages[0].rows[0],bad.anon_readback.pages[0].rows[0]]){
  row.raw_trials[0].payload.trial_event_time_source='quote_seen_at';row.source_hash=hash(stable(row.raw_trials));
 }
 bad.writer_write_set.plan_hash=hash(bad.writer_write_set.plan);bad.writer_write_set.ack.plan_hash=bad.writer_write_set.plan_hash;
 assert.equal(gate.validRound(bad),false);
 console.log('PASS isolated A17 persistence adapter and DB/anon module verifier; no production writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
