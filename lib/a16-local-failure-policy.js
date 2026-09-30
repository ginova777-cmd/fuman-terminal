'use strict';
// Only evidence-local errors may allow the next symbol. Transport failures stop.
function isLocalEvidenceFailure(reason) {
 return /^(A16_WRITE_INTENT_CONFLICT|A16_WRITE_INTENT_REVALIDATION_FAILED|A16_CHECKPOINT_REVALIDATION_FAILED)$/.test(String(reason||'')) || /^A16_(JOURNAL_JSON_INVALID|JSON_READ_FAILED):/.test(String(reason||''));
}
function shouldStop(failure,status) {return [401,403,429].includes(status)||Boolean(failure&&!isLocalEvidenceFailure(failure));}
function saveArtifact({atomic,path,receiptDir,symbol,artifact,failure,checkedAt}) {
 if(isLocalEvidenceFailure(failure)) {
  // Preserve original artifact and immutable intent; candidate is diagnostic only.
  atomic(path.join(receiptDir,symbol+'-failure.json'),{trade_date:artifact.receipt.trade_date,generation:artifact.generation,mode:artifact.mode,symbol,checked_at:checkedAt,complete:false,error:failure,error_name:'Error',candidate:artifact});
 } else atomic(path.join(receiptDir,symbol+'.json'),artifact);
}
module.exports={isLocalEvidenceFailure,shouldStop,saveArtifact};
