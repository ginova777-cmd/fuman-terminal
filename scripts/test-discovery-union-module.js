'use strict';
const assert=require('node:assert/strict');
const {collect,inspectParent}=require('../lib/mother-pool-discovery-union-producer');
const {verify}=require('../lib/verify-mother-pool-discovery-union');
const {hash,identityFields}=require('../lib/mother-pool-module-write-set');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const original=require('./test-discovery-module').input;
function fixture(identity=original.identity){
 const input=JSON.parse(JSON.stringify(original).replaceAll('2330','2454'));input.identity=identity;
 input.previous.plan_hash=hash(input.previous.plan);input.previous.ack.plan_hash=input.previous.plan_hash;
 const asOf='2026-09-18T10:01:00+08:00',date=identity.trade_date;
 const price=require('../lib/mother-pool-discovery-producer').collect(input);
 const source=(symbol,value)=>({symbol,event_at:asOf,classification:require('./test-industry-mapping-module').classification(symbol),trade_value:value,
  trade_value_evidence:{value,unit:'TWD',source:'fugle.websocket.aggregates.total.tradeValue',event_at:asOf,is_synthetic:false,calculation:'provider_reported_cumulative'},change_percent:2,volume_ratio_5:2});
 const previous={...identity,writer_run_id:'industry-previous',updated_at:date+'T10:00:00+08:00',symbols:['2454','3443'],net_flow_proxy:0,average_change_percent:1};
 const flow={...identity,industry:'IC設計',updated_at:asOf,symbols:['2454','3443'],net_flow_proxy:600000000,breadth_percent:100,flow_share_percent:100,flow_rank:1,sudden_inflow_rank:1,comparison:{comparable:true},previous_round_evidence:previous,persistent_large_inflow:true,sudden_large_inflow:true,industry_volume_expansion_confirmed:true,industry_price_rise_continuing:true};
 const discovery={...identity,updated_at:asOf,requested_symbols:['2454','3443'],source_rows:[source('2454',400000000),source('3443',200000000)],industry_heatmap:[flow]};
 const industry=require('../lib/mother-pool-industry-flow-producer').collect({identity,discovery,asOf}).find(p=>p.module_id==='B08');
 return {price,industry,asOf:date+'T10:01:02+08:00',identity};
}
function writeSet(input){
 const plan={created_at:input.created_at,requested_symbols:input.requested_symbols,data_gap_symbols:input.rows.filter(r=>r.status==='DATA_GAP').map(r=>r.symbol),special_evidence:input.special_evidence||{},source_evidence:input.source_evidence,rows:input.rows};
 const id=Object.fromEntries(identityFields.map(k=>[k,input[k]])),plan_hash=hash(plan);
 return {contract:'mother_pool_module_write_set_v1',module_id:input.module_id,module_contract:registry.modules[input.module_id],...id,plan,plan_hash,
  ack:{...id,module_id:input.module_id,committed:true,committed_at:input.created_at,plan_hash,written_symbols:[...input.requested_symbols]}};
}
function artifact(plan){return {...plan,observed_at:plan.created_at,writer_write_set:writeSet(plan)};}
if(require.main===module){
 const f=fixture(),parents={B04:writeSet(f.price),B08:writeSet(f.industry)},input={identity:f.identity,parents,asOf:f.asOf};
 const plan=collect(input),a=artifact(plan);assert.equal(verify(plan.rows,a),true);
 assert.deepEqual(plan.requested_symbols,['2454','3443']);assert.deepEqual(plan.rows[0].candidate_sources,['B04','B08']);
 assert.deepEqual(plan.rows[1].candidate_sources,['B08']);assert.equal(plan.special_evidence.union_summary.overlap_count,1);
 for(const change of [p=>{p.B04.writer_run_id='wrong';},p=>{p.B08.ack.committed=false;},p=>{p.B08.ack.written_symbols.pop();},p=>{p.B04.plan.rows=[];},p=>{p.B08.plan.rows[0].sudden_inflow=false;}]){const bad=structuredClone(parents);change(bad);assert.throws(()=>collect({...input,parents:bad}));}
 for(const change of [rows=>rows.pop(),rows=>rows.push(rows[0]),rows=>{rows[0].source_flags.bullish_gain_volume=false;},rows=>{rows[0].candidate_sources=['B04'];},rows=>{rows[0].included=false;},rows=>{rows[0].dedupe_key='wrong';},rows=>{rows[0].parent_plan_hashes.B04='wrong';}]){const bad=structuredClone(plan.rows);change(bad);assert.equal(verify(bad,a),false);}
 const tampered=structuredClone(parents);tampered.B04.plan.rows[0].discovery_flags.bullish_gain_volume=false;tampered.B04.plan_hash=hash(tampered.B04.plan);tampered.B04.ack.plan_hash=tampered.B04.plan_hash;
 const falsePlan=collect({...input,parents:tampered});assert.equal(verify(falsePlan.rows,artifact(falsePlan)),false,'self-consistent hashes cannot replace independent parent arithmetic');
 const gapInput=structuredClone(f.industry);gapInput.rows[0].status='DATA_GAP';gapInput.rows[0].data_gap_reason='missing source';
 const gap=collect({...input,parents:{...parents,B08:writeSet(gapInput)}});assert.equal(gap.rows[0].included,false);assert.equal(gap.rows[0].status,'DATA_GAP');assert.equal(verify(gap.rows,artifact(gap)),false);
 const changedInput=structuredClone(original);changedInput.identity=f.identity;changedInput.sources[0].changePercent=1;changedInput.sources[0].source_evidence.quote.price=101;
 const noHit=require('../lib/mother-pool-discovery-producer').collect(changedInput);
 const extra=collect({...input,parents:{B04:writeSet(noHit),B08:parents.B08}});
 assert.equal(extra.rows.find(r=>r.symbol==='2330').included,false);assert.equal(extra.rows.find(r=>r.symbol==='2330').reject_reason,'NO_DISCOVERY_SIGNAL');assert.equal(verify(extra.rows,artifact(extra)),true);
 console.log(JSON.stringify({status:'passed',scope:'isolated_B09_producer_and_independent_verifier',production_complete:false}));
}
module.exports={fixture,writeSet};
