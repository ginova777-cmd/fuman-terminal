'use strict';
const {hash,identityFields}=require('./mother-pool-stock-module-write-set');
function validate({identity,parents,core,asOf,releaseSha}){
 const sets={};
 for(const id of ['B01','B11'])sets[id]=require('./daytrade-dependency-readback.cjs').verifyParent({moduleId:id,artifact:parents?.[id],identity,asOf});
 if(!core||core.contract!=='daytrade_mother_pool_closed_loop_v1'||core.ok!==true||core.closed_loop_ok!==true||core.verifier_ok!==true||core.read_only!==true||core.failed_checks?.length!==0||core.trade_date!==identity.trade_date||core.canonical_run_id!==identity.canonical_run_id||core.production_sha!==releaseSha||!/^[a-f0-9]{40}$/.test(releaseSha||''))throw Error('B17_CORE_RECEIPT_INVALID');
 const age=Date.parse(asOf)-Date.parse(core.checked_at);
 if(!Number.isFinite(age)||age<0||age>120000)throw Error('B17_CORE_RECEIPT_STALE');
 const binding=core.snapshot_binding;
 for(const [key,value] of Object.entries({mother_pool_run_id:identity.mother_pool_run_id,generation:identity.snapshot_generation,snapshot_sequence:identity.snapshot_sequence}))if(binding?.[key]!==value)throw Error('B17_SNAPSHOT_IDENTITY:'+key);
 const session=core.session_evidence;
 const assessment=require('./mother-pool-receipt-assessment.cjs').assess(core,{calendar:{date:identity.trade_date,isTradingDay:true,source:session?.calendar_source,reason:session?.calendar_reason,calendar_evidence:session?.calendar_evidence}});
 if(assessment.integrity_status!=='PASS'||assessment.realtime_status!=='PASS')throw Error('B17_CORE_ASSESSMENT_FAILED');
 const symbols=sets.B11.plan.requested_symbols;
 if(!symbols.length||symbols.length!==binding.snapshot_readback_count||new Set(symbols).size!==symbols.length||sets.B01.plan.requested_symbols.length!==symbols.length||symbols.some(s=>!sets.B01.plan.requested_symbols.includes(s)))throw Error('B17_PARENT_SYMBOLS_MISMATCH');
 const snapshot=sets.B11.plan.source_evidence.snapshot;
 if(hash(snapshot)!==hash(JSON.parse(Buffer.from(binding.hash_evidence.snapshot.base64, 'base64').toString('utf8'))))throw Error('B17_SNAPSHOT_ORIGINAL_MISMATCH');
 return symbols;
}
function build({identity,parents,core,asOf,releaseSha}){
 const symbols=validate({identity,parents,core,asOf,releaseSha});
 return {...Object.fromEntries(identityFields.map(k=>[k,identity[k]])),module_id:'B17',created_at:asOf,requested_symbols:symbols,
 source_evidence:{parents,core,release_sha:releaseSha},rows:symbols.map(symbol=>({symbol,status:'READY',data_gap_reason:null,source:'MotherPool.closed_loop_read_only',source_contract:'daytrade_mother_pool_closed_loop_v1',event_time:core.checked_at,source_updated_at:core.checked_at,is_synthetic:false,replay:false,look_ahead:false,core_receipt_sha256:hash(core),parent_plan_hashes:Object.fromEntries(['B01','B11'].map(id=>[id,parents[id].writer_write_set.plan_hash])),formal_candidate_allowed:false,publish_allowed:false}))};
}
async function collect({identity,parents,asOf,releaseSha,run}){
 // Reject missing parents before invoking any extra database read.
 for(const id of ['B01','B11'])require('./daytrade-dependency-readback.cjs').verifyParent({moduleId:id,artifact:parents?.[id],identity,asOf});
 const core=await run();return build({identity,parents,core,asOf:new Date().toISOString(),releaseSha});
}
function verify(rows,receipt){try{
 const source=receipt.writer_write_set.plan.source_evidence;
 const plan=build({identity:receipt,parents:source.parents,core:source.core,asOf:receipt.observed_at,releaseSha:source.release_sha});
 if(rows.length!==plan.rows.length)return false;
 return plan.rows.every(expected=>{const row=rows.find(r=>r.symbol===expected.symbol);return row&&Object.keys(expected).every(key=>hash(row[key])===hash(expected[key]));});
}catch{return false;}}
module.exports={validate,build,collect,verify};
