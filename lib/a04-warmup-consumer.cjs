'use strict';
const {select}=require('./verify-a04-warmup.cjs');
const {hash,identityFields}=require('./mother-pool-module-write-set');
const DECISION='MP-A04-OWNER-DECISION-20261013';
const reject=reason=>({symbols:[],candidates:[],scope:'WARMUP_ONLY',complete:false,failed_checks:[reason]});
// Only a locally configured binding is trusted; never accept one from the artifact.
function read(payload,{now=new Date().toISOString(),trustedBinding}={}){
 try{
  const e=payload?.a04WarmupEvidence,w=e?.write_set,p=w?.plan;
  if(e?.contract!=='a04_warmup_subscription_v1'||e.owner_decision!==DECISION||e.scope!=='WARMUP_ONLY'||e.complete!==false||w?.module_id!=='A04')return reject('A04_ENVELOPE_INVALID');
  const t=Date.parse(now),created=Date.parse(p?.created_at),date=new Date(t+28800000).toISOString().slice(0,10);
  if(!Number.isFinite(created)||created>t||t-created>30*60*1000||w.trade_date!==date)return reject('A04_CONSUMER_TIME');
  if(payload.trade_date!==w.trade_date||payload.canonical_run_id!==w.canonical_run_id||payload.mother_pool_run_id!==w.mother_pool_run_id||payload.mother_pool_snapshot_sequence!==w.snapshot_sequence)return reject('A04_ARTIFACT_IDENTITY');
  if(w.contract!=='mother_pool_module_write_set_v1'||w.plan_hash!==hash(p)||w.ack?.committed!==true||w.ack.plan_hash!==w.plan_hash||w.ack.module_id!=='A04'||!identityFields.every(k=>w[k]!=null&&w.ack[k]===w[k]))return reject('A04_WRITE_SET_PROOF');
  const committed=Date.parse(w.ack.committed_at);
  if(!Number.isFinite(committed)||committed<created||committed>t)return reject('A04_ACK_TIME');
  const requested=p.requested_symbols,actual=w.ack.written_symbols;
  if(!Array.isArray(requested)||!Array.isArray(actual)||actual.length!==requested.length||new Set(actual).size!==actual.length||!requested.every(s=>actual.includes(s)))return reject('A04_ACK_SET');
  // Recheck read freshness against consumer wall clock, not just producer time.
  if(!Array.isArray(p.rows)||p.rows.some(r=>!Number.isFinite(Date.parse(r?.history_read_at))||Date.parse(r.history_read_at)>t||t-Date.parse(r.history_read_at)>30*60*1000))return reject('A04_READ_EXPIRED');
  const identity=Object.fromEntries(identityFields.map(k=>[k,w[k]]));
  return {...select({...identity,module_id:'A04',...p},{identity,asOf:p.created_at,trustedBinding}),scope:'WARMUP_ONLY',complete:false};
 }catch{return reject('A04_CONSUMER_INVALID');}
}
function attach(payload,writeSet,options){
 const next={...payload,a04WarmupEvidence:{contract:'a04_warmup_subscription_v1',owner_decision:DECISION,scope:'WARMUP_ONLY',complete:false,write_set:writeSet}};
 // Publish only verified nonempty candidates; clear any previous evidence on failure.
 if(!read(next,options).symbols.length)next.a04WarmupEvidence=null;
 return next;
}
module.exports={read,attach};
