'use strict';
const assert=require('node:assert/strict');
const {collect,verify}=require('../lib/mother-pool-preopen-quality');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {hash}=require('../lib/mother-pool-module-write-set');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const identity={trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'sg',snapshot_sequence:1},asOf='2026-09-29T01:00:00Z';
async function persist(input){return persistModuleRound(input,{savePlan:async()=>{},saveEvidence:async()=>{},persist:async body=>{const d=JSON.parse(body.p_document);return {...identity,module_id:input.module_id,committed:true,plan_hash:d.plan_hash,committed_at:asOf,written_symbols:input.requested_symbols};}});}
(async()=>{
 const parents={};for(const id of ['A15','A16','A17'])parents[id]=await persist({...identity,module_id:id,created_at:asOf,requested_symbols:['2330'],rows:[{symbol:'2330',status:'READY',data_gap_reason:null,source:'isolated-parent',source_contract:registry.modules[id],source_updated_at:asOf,is_synthetic:false,replay:false,look_ahead:false}]});
 const input={identity,symbols:['2330'],parents,asOf},good=collect(input),ws=await persist(good),round={...identity,observed_at:asOf,writer_write_set:ws};
 assert.equal(good.rows[0].ready_branches,3);assert(verify(good.rows,round));
 for(const id of ['A15','A16','A17']){
  const missing=structuredClone(parents);delete missing[id];const p=collect({...input,parents:missing});assert.equal(p.rows[0].status,'DATA_GAP');assert.equal(p.rows[0].first_blocker,id);
  const changed=structuredClone(parents);changed[id].generation_id='other';assert.equal(collect({...input,parents:changed}).rows[0].status,'DATA_GAP');
  const gap=structuredClone(parents);gap[id].plan.rows[0].status='DATA_GAP';gap[id].plan.rows[0].data_gap_reason='INSUFFICIENT_SAMPLE';gap[id].plan.data_gap_symbols=['2330'];gap[id].plan_hash=hash(gap[id].plan);gap[id].ack.plan_hash=gap[id].plan_hash;assert.equal(collect({...input,parents:gap}).rows[0].status,'DATA_GAP');
 }
 const tampered=structuredClone(good.rows);tampered[0].branches.A16.status='DATA_GAP';assert.equal(verify(tampered,round),false);
 const absent=collect({...input,parents:{}});const absentWs=await persist(absent);assert.equal(verify(absent.rows,{...round,writer_write_set:absentWs}),false);
 assert.equal(verify([...good.rows,...good.rows],round),false);
 const surface=()=>({query_identity:identity,missing:[],extra:[],pages:[{query_identity:identity,http_status:200,page_index:0,page_size:500,offset:0,content_range:'0-0/1',rows:good.rows.map(row=>({...identity,...structuredClone(row)}))}]});
 const full={...round,module_id:'A18',contract:registry.modules.A18,run_id:'isolated',status:'verified',source_contract_ok:true,db_readback_ok:true,anon_readback_ok:true,failed_checks:[],natural_evidence:true,requested:1,written:1,readback:1,unique_symbols:1,db_readback:surface(),anon_readback:surface()};
 const gate=require('../lib/verify-mother-pool-module-round').createVerifier('A18');assert(gate.validRound(full));
 const bad=structuredClone(full);bad.anon_readback.pages[0].rows[0].branches.A16.plan_hash='wrong';assert.equal(gate.validRound(bad),false);
 const missingParent=structuredClone(full);delete missingParent.writer_write_set.plan.source_evidence.parents.A16;missingParent.writer_write_set.plan_hash=hash(missingParent.writer_write_set.plan);missingParent.writer_write_set.ack.plan_hash=missingParent.writer_write_set.plan_hash;assert.equal(gate.validRound(missingParent),false);
 console.log('PASS A18 aggregation: all three committed parents, missing/gap/cross-generation rejection, tamper rejection, persistence adapter. Parent business verifiers remain separately required. Isolated only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
