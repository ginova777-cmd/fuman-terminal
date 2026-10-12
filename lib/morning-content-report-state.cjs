'use strict';
function reportStateAccepted(receipt, contentOnly = false) {
  if (['REPORT_OK','REPORT_DEGRADED','COMPLETE','complete','WAITING_CANONICAL_VERIFIER'].includes(receipt.report_status)) return true;
  return contentOnly === true && receipt.report_status === 'WAITING_PERSISTENCE_ACK' &&
    receipt.contract === 'opening_report_0830_complete_v1' && receipt.runner_complete === true &&
    receipt.complete === false && receipt.status === 'waiting_persistence_ack' &&
    receipt.first_blocker === 'mother_pool_persistence_ack_pending';
}
module.exports = {reportStateAccepted};
