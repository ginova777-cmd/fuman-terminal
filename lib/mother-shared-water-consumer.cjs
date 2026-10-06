'use strict';
const {verifyMembership}=require('./mother-shared-water-membership.cjs');
const {createVerifier,sha}=require('./mother-shared-water-evidence.cjs');
const {evaluate}=require('./strategy3-shared-water-adapter.cjs');
function expectedFromSource({sourceStatus,snapshotBytes,tradeDate,producerVersion}){
 const p=sourceStatus?.payload;
 if(sourceStatus?.source_name!=='fugle_daytrade_source'||!p||p.trade_date!==tradeDate||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!/^[a-f0-9]{40}$/.test(producerVersion||''))throw Error('EXPECTED_SOURCE_IDENTITY_INVALID');
 if(!Buffer.isBuffer(snapshotBytes)||snapshotBytes.length>4*1024*1024)throw Error('EXPECTED_SNAPSHOT_BYTES_INVALID');
 const s=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(snapshotBytes));
 if(s.status!=='complete'||s.complete!==true||s.trade_date!==tradeDate||s.canonical_run_id!==p.canonical_run_id||s.mother_pool_run_id!==p.mother_pool_run_id||s.snapshot_sequence!==p.mother_pool_snapshot_sequence||s.generation!==s.mother_pool_run_id||!Number.isInteger(s.snapshot_sequence)||s.snapshot_sequence<1)throw Error('EXPECTED_SOURCE_SNAPSHOT_MISMATCH');
 const requested=require('./mother-shared-water-priority-scope.cjs').readScope(p.shared_water_priority_scope,{tradeDate,writerRunId:p.writer_run_id,expectedCount:p.priority_pool_symbols});
 const members=require('./mother-shared-water-producer.cjs').canonicalSymbols(s.symbols);
 if(s.symbol_count!==members.length)throw Error('EXPECTED_SNAPSHOT_COUNT_MISMATCH');
 return {trade_date:tradeDate,canonical_run_id:s.canonical_run_id,mother_pool_run_id:s.mother_pool_run_id,writer_run_id:p.writer_run_id,generation:s.generation,snapshot_sequence:s.snapshot_sequence,producer_version:producerVersion,contract_version:'1.1.0',scope_definition_version:'full-priority-fixed-membership-v1',requested_symbols:requested,requested_symbols_sha256:sha(Buffer.from(JSON.stringify(requested))),snapshot_symbols_sha256:sha(Buffer.from(JSON.stringify(members))),snapshot_bytes_sha256:sha(snapshotBytes)};
}
// Prepared integration only. A caller pins expected identity independently;
// source grade, receipt self-identification and successful HTTP are insufficient.
function verifyLoaded(loaded,{expected,nowMs}){
 const blocked=code=>({water_gate_pass:false,strategy3_scan_ready:false,formal_entry_authorization:false,failed_checks:[code],first_blocker:code});
 if(loaded?.transport_complete!==true||!Buffer.isBuffer(loaded.receipt_bytes)||typeof loaded.resolve!=='function'||loaded.diagnostics?.receipt_sha256!==sha(loaded.receipt_bytes))return blocked('RECEIPT_TRANSPORT_UNVERIFIED');
 let receipt;try{receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(loaded.receipt_bytes));}catch{return blocked('RECEIPT_BYTES_INVALID');}
 const membership=verifyMembership(receipt,{resolve:loaded.resolve,expectedPriority:expected?.requested_symbols,expectedIdentity:expected});
 if(!membership.membership_verified)return {...blocked(membership.failed_checks[0]),failed_checks:membership.failed_checks,membership_verified:false};
 return {...evaluate(receipt,{expected,nowMs,verifyEvidence:createVerifier({resolve:loaded.resolve,nowMs:()=>nowMs})}),membership_verified:true};
}
// Discover within an independently pinned scope, then verify the exact returned
// run. The pointer supplies only the per-publication ID; scope/version/list
// expectations remain caller-owned and cannot be replaced by receipt values.
async function readVerified({url,key,expected,now=Date.now,fetchImpl=fetch}){
 const pinned=structuredClone(expected);
 if(!pinned||pinned.verification_run_id!==undefined)throw Error('DISCOVERY_SCOPE_REQUIRED');
 const loaded=await require('./mother-shared-water-remote-evidence.cjs').loadArchive({url,key,expectedIdentity:pinned,now,fetchImpl});
 const result=verifyLoaded(loaded,{expected:{...pinned,verification_run_id:loaded.diagnostics.run_id},nowMs:now()});
 return {...result,verification_run_id:loaded.diagnostics.run_id,receipt_sha256:loaded.diagnostics.receipt_sha256,transport_diagnostics:loaded.diagnostics};
}
module.exports={verifyLoaded,readVerified,expectedFromSource};
