'use strict';

// Process success alone is not acceptance. Require the current total receipt
// and every module result to agree on successful completion.
function accepted(results, processResult, receipt, expectedModules) {
  return Array.isArray(results) && results.length === expectedModules.length &&
    new Set(results.map(r => r.module_id)).size === expectedModules.length &&
    results.every(r => expectedModules.includes(r.module_id) && r.complete === true && r.status === 'complete' && r.exit_code === 0) &&
    !processResult.error && processResult.status === 0 &&
    receipt?.status === 'complete' && receipt.complete === true && receipt.exit_code === 0 &&
    receipt.first_blocker === null && Array.isArray(receipt.failed_checks) && receipt.failed_checks.length === 0;
}

module.exports = { accepted };
