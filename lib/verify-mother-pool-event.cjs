'use strict';
const E=require('./mother-pool-event-evidence.cjs');
const {identityFields,hash}=require('./mother-pool-module-write-set');
const {inspectParent}=require('./mother-pool-discovery-union-producer');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Recompute the requested event from persisted parent rows using existing independent formula verifiers.
function verifyEvent(event,rows,identity,asOf){
 const r=rows[event.module_id];E.need(r,'EVENT_PARENT_REQUIRED');let type,time,price,direction;
 if(['B13','B19'].includes(event.module_id)){
  E.need(require('./verify-mother-pool-anomaly-row').verify(event.module_id,{...r,trade_date:identity.trade_date},asOf)&&r.event_detected,'EVENT_FORMULA');
  type=event.module_id==='B13'?'PRICE_SPIKE_UP':'PRICE_SPIKE_DOWN';direction=event.module_id==='B13'?'long':'short';time=r.event_time;price=r.current.at(-1).close;
 }else if(event.module_id==='B22'){
  E.need(require('./verify-mother-pool-tongzi').verify(r,{...identity,observed_at:asOf}),'TONGZI_FORMULA');
  const e=r.tongzi.events.find(x=>x.event_id===event.event_id);E.need(e,'TONGZI_EVENT_MISSING');({type,event_timestamp:time,event_price:price,direction}=e);
 }else if(event.module_id==='B23'){
  E.need(require('./verify-mother-pool-point-in-time').verify({...r,trade_date:identity.trade_date},asOf),'POINT_FORMULA');
  E.need(event.type==='NEW_INTRADAY_HIGH'?r.new_high:event.type==='NEW_INTRADAY_LOW'&&r.new_low,'POINT_EVENT');
  type=event.type;direction=type==='NEW_INTRADAY_HIGH'?'long':'short';time=r.event_time;price=r.current_price;
 }else if(event.module_id==='B21'){
  const p=rows.B23;E.need(p&&require('./verify-mother-pool-point-in-time').verify({...p,trade_date:identity.trade_date},asOf),'VWAP_POINT_REQUIRED');
  const v=require('./daytrade-volume-value-ranking').evaluateVolume(r.volume_evidence,identity.trade_date,E.clock(asOf));
  const a=require('./daytrade-trade-value-evidence').evaluateTradeValue(r.trade_value_evidence,identity.trade_date,E.clock(asOf));
  E.need(v.status==='ready'&&a.status==='ready'&&v.event_at===a.event_at&&v.volume_shares>0&&Math.abs(r.vwap-a.trade_value_twd/v.volume_shares)<1e-6,'VWAP_FORMULA');
  const pct=(p.current_price-r.vwap)/r.vwap*100;E.need(Math.abs(pct)>0.05,'VWAP_DIRECTION');
  type=pct>0?'VWAP_ABOVE_VWAP':'VWAP_BELOW_VWAP';direction=pct>0?'long':'short';time=v.event_at;price=p.current_price;
 }else throw Error('EVENT_MODULE_NOT_DIRECTIONAL');
 E.need(event.type===type&&event.direction===direction&&event.event_timestamp===time&&event.event_price===price,'EVENT_RECOMPUTATION_MISMATCH');
 E.need(event.source_contract===r.source_contract||event.module_id==='B21'&&event.source_contract==='intraday_vwap_v1'||event.module_id==='B22'&&event.source_contract===r.tongzi.events.find(x=>x.event_id===event.event_id).source_contract,'EVENT_SOURCE_CONTRACT');
 if(event.module_id!=='B22')E.need(event.event_id===[identity.trade_date,event.symbol,event.module_id,type,time].join('|'),'EVENT_ID');
 const calculation=['B13','B19'].includes(event.module_id)?{baseline_method:r.baseline_method,baseline_value:r.baseline_value,sample_count:r.sample_count,ratio:r.ratio,value:r.return_1m}:event.module_id==='B22'?{level:r.tongzi.levels.P2,reference_bar_hash:r.tongzi.levels.bar_hash,crossing:r.tongzi.events.find(e=>e.event_id===event.event_id)}:event.module_id==='B21'?{vwap:r.vwap,volume:r.volume_evidence,trade_value:r.trade_value_evidence}:{high:r.day_high_so_far,low:r.day_low_so_far,current_price:r.current_price};
 E.need(equal(event.calculation_evidence,calculation),'CALCULATION_EVIDENCE_MISMATCH');
}
function verify({root,bundleRef,currentFile,now}){
 const b=E.read(root,bundleRef),state=E.live(root,currentFile),at=E.clock(now);
 E.need(b.contract==='b24_event_evidence_v1'&&b.scope==='TEST_ONLY','ISOLATED_EVIDENCE_REQUIRED');
 E.need(typeof b.epoch==='string'&&b.epoch.length>0,'EPOCH_REQUIRED');
 E.need(state.scope==='TEST_ONLY'&&b.epoch===state.epoch&&b.generation_id===state.generation_id&&b.snapshot_generation===state.snapshot_generation,'CURRENT_IDENTITY_CHANGED');
 E.need(identityFields.every(k=>b[k]!=null),'IDENTITY_REQUIRED');
 E.need(Array.isArray(b.events)&&b.events.length===2&&new Set(b.events.map(e=>e.event_id)).size===2&&new Set(b.events.map(e=>e.module_id)).size===2,'TWO_DISTINCT_EVENTS_REQUIRED');
 const required=[...new Set(b.events.flatMap(e=>e.module_id==='B21'?['B21','B23']:[e.module_id]))].sort();
 E.need(equal(Object.keys(b.sources||{}).sort(),required),'EXACT_DEPENDENCIES_REQUIRED');
 const rows={};
 for(const id of required){
  const refs=b.sources[id],w=E.read(root,refs.write_set),db=E.read(root,refs.db),anon=E.read(root,refs.anon),cp=E.read(root,refs.checkpoint),proof=E.read(root,refs.proof);
  const key=id+':'+b.symbol,live=state.sources?.[key];
  E.need(live&&live.revision===refs.revision&&live.proof_sha256===refs.proof.sha256&&live.gap===false,'SOURCE_REVISED_OR_GAP');
  E.need(identityFields.filter(k=>k!=='writer_run_id').every(k=>w[k]===b[k]),'SOURCE_IDENTITY');
  const r=inspectParent(w,id,w,now).get(b.symbol);E.need(r&&r.status==='READY','NECESSARY_SOURCE_GAP');
  E.need(at-E.clock(r.source_updated_at)>=0&&at-E.clock(r.source_updated_at)<=120000,'SOURCE_FRESHNESS_120S');
  E.need(db.length===1&&anon.length===1&&equal(db[0],r)&&equal(anon[0],r),'INDEPENDENT_READBACK_MISMATCH');
  E.need(cp.contract==='b24_event_checkpoint_v1'&&cp.scope==='TEST_ONLY'&&cp.symbol===b.symbol&&cp.module_id===id&&cp.plan_hash===w.plan_hash&&cp.write_set_sha256===refs.write_set.sha256&&cp.epoch===b.epoch&&identityFields.every(k=>cp[k]===w[k]),'CHECKPOINT_BINDING');
  E.need(proof.contract==='b24_event_readback_proof_v1'&&proof.scope==='TEST_ONLY'&&proof.checkpoint_sha256===refs.checkpoint.sha256&&proof.db_sha256===refs.db.sha256&&proof.anon_sha256===refs.anon.sha256&&proof.row_hash===hash(r)&&proof.plan_hash===w.plan_hash,'PROOF_BINDING');
  E.need(E.clock(proof.verified_at)<=at&&E.clock(proof.verified_at)>=E.clock(w.ack.committed_at),'PROOF_TIME');rows[id]=r;
 }
 if(b.provenance_mode==='ORIGINAL_WRITER')require('./verify-b24-writer-provenance.cjs').verify({root,refs:b.writer_provenance,identity:b,rowsByModule:rows,now});
 else E.need(b.provenance_mode==null,'UNKNOWN_PROVENANCE_MODE');
 for(const e of b.events){
  E.need(e.symbol===b.symbol&&e.trade_date===b.trade_date&&e.canonical_run_id===b.canonical_run_id&&e.source_contract_ok===true,'EVENT_IDENTITY');
  // Event combination history is 180s; current source freshness remains 120s.
  E.need(at-E.clock(e.event_timestamp)>=0&&at-E.clock(e.event_timestamp)<=180000,'EVENT_WINDOW_180S');
  verifyEvent(e,rows,b,now);
 }
 const combinations=require('./verify-mother-pool-combinations').combinations(b.events,now);
 E.need(combinations.length===1&&combinations[0].eligible_for_notifier,'DIRECTION_OR_WINDOW');
 const decision=require('./mother-pool-b24-cooldown').decide({events:b.events,now,qualityGate:true,freshnessPassed:true,notifierEligible:true});E.need(decision.allowed,decision.reason);
 return {contract:'b24_event_verified_v1',scope:'TEST_ONLY',status:'EVENT_VERIFIED',bundle_ref:bundleRef,epoch:b.epoch,identity:Object.fromEntries(identityFields.map(k=>[k,b[k]])),symbol:b.symbol,occurrence_id:decision.occurrence_id,events:b.events,combination:combinations[0],verified_at:now,full_market_acceptance:'NOT_EVALUATED'};
}
module.exports={verify};
