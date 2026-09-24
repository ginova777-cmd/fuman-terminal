"use strict";

const dateKey = value => String(value || "").replace(/\D/g, "").slice(0, 8);

// The nightly strategy owns its complete run; an older aggregate calendar
// cannot revoke it. A different date, partial run, or fallback still fails closed.
function strategy5MobileAuthority(payload, today) {
  const p = payload || {}, q = p.run_quality_at_publish || {}, t = p.transport || {};
  const day = dateKey(today), runId = String(p.runId || "");
  const rows = Array.isArray(p.matches) ? p.matches : [];
  const total = Number(p.expectedTotal), count = Number(p.resultCount);
  if (!/^\d{8}$/.test(day) || !new RegExp(`^strategy5-${day}-\\d{14}$`).test(runId)
    || dateKey(p.tradeDate) !== day || dateKey(p.sourceDate) !== day
    || p.ok !== true || p.complete !== true || p.fullScan !== true
    || p.qualityStatus !== "complete" || p.evidenceStatus !== "complete"
    || p.unattendedStatus !== "YES" || p.publishAllowed !== true || q.publishAllowed !== true
    || p.preservePreviousGood !== false || q.preservePreviousGood !== false
    || p.fallbackUsed !== false || q.fallbackUsed !== false || t.fallbackUsed !== false
    || p.fallback?.used === true || p.blockedReason || p.scanner_block_reason || q.blockedReason
    || !Array.isArray(p.issues) || p.issues.length !== 0
    || p.selectionCoverage?.ok !== true || p.source_status_at_run?.ok !== true
    || q.runId !== runId || t.runId !== runId
    || !Number.isInteger(total) || total < 1500 || Number(p.scannedCount) !== total
    || !Number.isInteger(count) || count < 0 || Number(q.readbackCount) !== count
    || Number(t.resultReadbackCount) !== count || Number(p.count) !== count
    || Number(p.returnedCount) !== rows.length || rows.length > count
    || (count > 0 && rows.length === 0)) return null;
  return { key: "strategy5", runId, tradeDate: day, sourceDate: day,
    moduleStatus: count === 0 ? "0-result" : "complete", todayAuthoritative: true,
    formalDisplayAllowed: true, displayMode: count === 0 ? "TODAY_ZERO_RESULT_COMPLETE" : "TODAY_COMPLETE",
    displayBlockReason: "", pendingNotDue: false, evidenceStatus: "complete",
    publishAllowed: true, preservePreviousGood: false, fallback: false };
}

module.exports = { strategy5MobileAuthority };
