"use strict";
const { isDeepStrictEqual } = require("util");

async function verifyExistingSnapshot({ readSnapshot, final, stage, stageContract, tradeDate, runId }) {
  const key = "opening_report_0830_terminal_briefing_" + stage;
  const failed = reason => ({ ok: false, key, tradeDate, preserve_previous_good: true, reason_code: reason });
  if (!final || final.run_id !== runId || final.date !== tradeDate || !final.delivery_content_hash
      || !Array.isArray(final.display_top3) || !final.night_futures) return failed("resume_terminal_expected_identity_missing");
  let row;
  try {
    row = await readSnapshot(key, { tradeDate, allowLatestFallback: false, timeoutMs: 10000, maxAttempts: 1 });
  } catch (_) { return failed("resume_terminal_readback_failed"); }
  if (!row) return failed("resume_terminal_readback_unavailable");
  const p = row.payload;
  const dateKey = value => String(value || "").replace(/-/g, "");
  if (row.snapshotId !== runId || dateKey(row.tradeDate) !== dateKey(tradeDate)
      || p?.ok !== true || p.run_id !== runId || p.date !== tradeDate
      || p.stage !== stage || p.stage_contract !== stageContract
      || p.delivery_content_hash !== final.delivery_content_hash
      || !isDeepStrictEqual(p.display_top3, final.display_top3)
      || !isDeepStrictEqual(p.night_futures, final.night_futures)
      || p.night_futures_summary !== final.night_futures_summary) return failed("resume_terminal_snapshot_identity_mismatch");
  return { ok: true, key, tradeDate, attempts: 1, report_run_id: runId,
    delivery_content_hash: p.delivery_content_hash, independent_db_readback: true,
    reused_existing: true, snapshot_written: false, checked_at: new Date().toISOString(),
    reason_code: "resume_terminal_existing_snapshot_verified" };
}
module.exports = { verifyExistingSnapshot };
