"use strict";
const CONTRACT=require('../data/contracts/opening_report_authority_v1.json');
function deliveryReceiptMatches(receipt,date,stage,runId) {
  return Boolean(runId && CONTRACT.stages.includes(stage) && receipt?.contract==='opening-report-morning-single-verifier-v1' &&
    receipt.scope==='stage_delivery' && receipt.phase==='delivery' && receipt.require_current===true &&
    receipt.trade_date===date && receipt.stage===stage && receipt.run_id===runId &&
    receipt.canonical_verifier===CONTRACT.canonical_command && receipt.complete===true &&
    receipt.status==='complete' && receipt.exitCode===0 && Array.isArray(receipt.failed_checks) && receipt.failed_checks.length===0 && receipt.first_blocker===null);
}
function receiptFilename(phase,day) {
  if(!['static','preflight','delivery'].includes(phase))throw Error('INVALID_MORNING_VERIFIER_PHASE');
  return `opening-report-morning-contract-${phase==='delivery'?'verifier':phase+'-verifier'}-${day}.json`;
}
module.exports={CONTRACT,deliveryReceiptMatches,receiptFilename};
