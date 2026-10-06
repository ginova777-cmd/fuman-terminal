'use strict';
const {verifyMembership}=require('./mother-shared-water-membership.cjs');
const {createVerifier,sha}=require('./mother-shared-water-evidence.cjs');
const {evaluate}=require('./strategy3-shared-water-adapter.cjs');
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
module.exports={verifyLoaded,readVerified};
