"use strict";

function dateKey(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }

// Strategy4 owns its after-close authority; an aggregate intraday calendar
// must not label a verified same-day daily-K run as previous-good.
function strategy4MobileAuthority(payload, today) {
  const p = payload || {};
  const q = p.run_quality_at_publish || {};
  const day = dateKey(today);
  const runId = String(p.runId || "");
  const rows = Array.isArray(p.matches) ? p.matches : [];
  const total = Number(p.expectedTotal);
  const count = Number(p.resultCount);
  const valid = /^\d{8}$/.test(day)
    && new RegExp(`^strategy4-${day}-\\d{14}$`).test(runId)
    && dateKey(p.tradeDate) === day && dateKey(p.sourceDate) === day
    && p.complete === true && p.publishAllowed === true
    && p.qualityStatus === "complete" && q.acceptedTargetDateCompleteRun === true
    && p.fallbackUsed === false && q.fallbackUsed === false
    && p.mustPreserveLatest === false && q.preservePreviousGood === false
    && !p.blockedReason && !(Array.isArray(p.issues) && p.issues.length)
    && total >= 1500 && Number(p.scannedCount) === total
    && Number.isInteger(count) && count >= 0 && Number(p.readbackCount) === count
    && Number(p.count) === rows.length && rows.length === Math.min(count, 70)
    && rows.every(row => row.runId === runId && dateKey(row.scanDate) === day);
  if (!valid) return null;
  return { key: "strategy4", runId, tradeDate: day, sourceDate: day,
    moduleStatus: count === 0 ? "0-result" : "complete", todayAuthoritative: true,
    formalDisplayAllowed: true, displayMode: count === 0 ? "TODAY_ZERO_RESULT_COMPLETE" : "TODAY_COMPLETE",
    displayBlockReason: "", pendingNotDue: false, evidenceStatus: "complete", publishAllowed: true, fallback: false };
}

module.exports = { strategy4MobileAuthority };
