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
module.exports={verifyLoaded};
