"use strict";
// Shared by snapshot publication and delta receipts; watch-only evidence is not membership.
function isPublishedMotherMember(row) {
  const metrics = row?.metrics || row?.payload?.motherPoolMetrics || {};
  const formal = row?.basePool?.eligible === true || row?.payload?.basePoolEligible === true
    || row?.payload?.formal_pool_eligible === true || row?.payload?.is_daytrade_allowed === true;
  const pending = row?.warmingPending === true || row?.payload?.warming_pending === true;
  const forced = row?.terminalForcedAdmission === true || row?.payload?.terminal_forced_admission === true;
  return forced || ((formal || pending) && Number(metrics.price) > 0);
}
module.exports = { isPublishedMotherMember };
