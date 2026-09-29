'use strict';
const path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const io=require('./mother-pool-a16-io');
const {readReferences}=require('./mother-pool-a16-writer');
const {verify:verifyBaseline}=require('./verify-mother-pool-a16');
const TYPES=['VOLUME','ABS_RETURN','OUTSIDE_STRENGTH','INSIDE_STRENGTH'];
const CONTRACT='preopen_a16_fixed_module_reference_v1';
function evaluate({runtime,tradeDate,symbol,reference,asOf,recalculate=false}){
 let artifact=null,counts=null,reason=null;
 try{
  const now=Date.parse(asOf);
  if(!Number.isFinite(now)||new Date(now+28800000).toISOString().slice(0,10)!==tradeDate||!/^\d{4}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))throw Error('A16_MODULE_IDENTITY_INVALID');
  if(reference?.db_readback_ok!==true||typeof reference.generation!=='string'||!/^[a-zA-Z0-9_-]+$/.test(reference.generation))throw Error(reference?.reason||'A16_REFERENCE_UNVERIFIED');
  artifact=io.read(path.join(runtime,'data','mother-pool-a16',tradeDate,reference.generation,symbol+'.json'));
  const receipt=artifact.receipt,db=artifact.db;
  if(reference.symbol!==symbol||reference.trade_date!==tradeDate||reference.canonical_run_id!==`fugle_daytrade_source:${tradeDate.replace(/-/g,'')}:canonical`||receipt?.symbol!==symbol||receipt.trade_date!==tradeDate||receipt.canonical_run_id!==reference.canonical_run_id)throw Error('A16_MODULE_BASELINE_IDENTITY_MISMATCH');
  if(artifact.mode!=='scheduled'||artifact.generation!==reference.generation||db?.readback_contract!=='a16_db_anon_v2'||db.db_readback_ok!==true||db.anon_readback_ok!==true||db.written_count!==1084||db.readback_count!==1084||db.payload_sha256!==reference.payload_sha256||io.hash(io.compact(receipt))!==reference.payload_sha256)throw Error('A16_MODULE_ARTIFACT_MISMATCH');
  if(!Number.isFinite(Date.parse(receipt.calculated_at))||Date.parse(receipt.calculated_at)>now||new Date(Date.parse(receipt.calculated_at)+28800000).toISOString().slice(0,10)!==tradeDate)throw Error('A16_MODULE_TIME_INVALID');
  if(artifact.verifier?.verification_passed!==true)throw Error('A16_MODULE_VERIFIER_MISSING');
  let checked=artifact.verifier;
  if(recalculate){
  const history=io.read(path.join(runtime,'data','mother-pool-historical-minutes',tradeDate,symbol+'.json'));
  const sideJournals=io.readSide(runtime,symbol,history.requested_sessions||[]);
  checked=verifyBaseline(receipt,{history,sideJournals,symbol,tradeDate,canonicalRunId:reference.canonical_run_id,asOf:receipt.calculated_at});
  }
  if(!checked.verification_passed)throw Error('A16_MODULE_FORMULA:'+checked.failed_checks.join('|'));
  counts=Object.fromEntries(TYPES.map(type=>{const rows=receipt.rows.filter(r=>r.baseline_type===type);return [type,{total:rows.length,ready:rows.filter(r=>r.status==='READY').length,not_applicable:rows.filter(r=>r.status==='NOT_APPLICABLE').length,gaps:rows.filter(r=>r.data_gap).length}];}));
  if(!checked.source_ready||reference.source_ready!==true)throw Error(receipt.first_blocker||'A16_MODULE_INSUFFICIENT_SAMPLE');
 }catch(error){reason=String(error.message||error);}
 return {status:reason?'DATA_GAP':'READY',data_gap_reason:reason,baseline_generation:reference?.generation||null,baseline_payload_sha256:reference?.payload_sha256||null,baseline_calculated_at:artifact?.receipt?.calculated_at||null,baseline_counts:counts};
}
function collect({identity,symbols,asOf,runtime,recalculate=false}){
 const refs=readReferences({runtime,tradeDate:identity.trade_date,symbols});
 return {...identity,module_id:'A16',created_at:asOf,requested_symbols:[...symbols],rows:symbols.map((symbol,i)=>({symbol,...evaluate({runtime,tradeDate:identity.trade_date,symbol,reference:refs[i],asOf,recalculate}),source:'mother_pool_a16_baselines',source_contract:CONTRACT,source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,formal_candidate_allowed:false,publish_allowed:false}))};
}
function verify(rows,round,{runtime=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime'}={}){try{
 const symbols=round.writer_write_set.plan.requested_symbols,expected=collect({identity:round,symbols,asOf:round.observed_at,runtime,recalculate:true});
 return rows.length===symbols.length&&new Set(rows.map(r=>r.symbol)).size===symbols.length&&expected.rows.every(e=>{const r=rows.find(r=>r.symbol===e.symbol);return e.status==='READY'&&r&&Object.entries(e).every(([k,v])=>isDeepStrictEqual(r[k],v));});
}catch{return false;}}
module.exports={collect,verify,evaluate};
