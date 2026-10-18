'use strict';
function reportStateAccepted(receipt, contentOnly = false) {
  // Readiness permits independent verification; it is never a completion ACK.
  if (contentOnly === true && ['opening-report-0830-production-v1','opening_report_0830_complete_v1'].includes(receipt.contract) &&
      receipt.content_ready === true && receipt.overseas_sources_ok === true &&
      receipt.expected_industry_count === 15 && receipt.scanned_industry_count === 15 &&
      receipt.terminal_briefing_snapshot?.ok === true &&
      receipt.positive_top3_contract_ok === true && receipt.priority_observation_contract_ok === true) return true;
  if (['REPORT_OK','REPORT_DEGRADED','COMPLETE','complete','WAITING_CANONICAL_VERIFIER'].includes(receipt.report_status)) return true;
  return contentOnly === true && receipt.report_status === 'WAITING_PERSISTENCE_ACK' &&
    receipt.contract === 'opening_report_0830_complete_v1' && receipt.runner_complete === true &&
    receipt.complete === false && receipt.status === 'waiting_persistence_ack' &&
    receipt.first_blocker === 'mother_pool_persistence_ack_pending';
}
module.exports = {reportStateAccepted};
