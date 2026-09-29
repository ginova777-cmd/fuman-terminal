"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function validate({attempt, frozen, leaders, consumed}, date, stage, nightIssues) {
  const issues = [], run = frozen?.run_id;
  const fail = (ok, code) => { if (!ok) issues.push(code); };
  fail(attempt?.ok === false && attempt.within_0830_preflight_window === false
    && attempt.overseas_detector_stderr_tail === "outside_0830_preflight_window", "not_expired_retry");
  fail(Boolean(run) && [attempt, frozen, leaders, consumed].every(r => r?.run_id === run && r.date === date), "frozen_identity_mismatch");
  fail(frozen?.ok === true && leaders?.ok === true && consumed?.ok === true, "frozen_source_not_verified");
  fail(attempt?.stage === stage && frozen?.stage === stage && leaders?.stage === stage, "frozen_stage_mismatch");
  fail(leaders?.detection_policy === (stage === "us_0820" ? "us_only_tx_night_0820_v1" : "asia_only_0850_v1"), "frozen_policy_mismatch");
  fail(consumed?.contract === "opening-report-0830-overseas-preflight-v1"
    && consumed.source_receipt_run_id === run && consumed.industry_count === 15, "prior_consumption_not_verified");
  const cutoff = frozen?.recovery?.cutoff_at || require("./opening-report-stage-contract").cutoff(date, stage);
  const start = frozen?.recovery?.started_at || `${date}T08:00:00+08:00`;
  fail([frozen, leaders].every(r => Number.isFinite(Date.parse(r?.checked_at))
    && Date.parse(r.checked_at) >= Date.parse(start) && Date.parse(r.checked_at) <= Date.parse(cutoff)), "frozen_capture_outside_window");
  // Consumption is repeated on resume; only source capture timestamps are frozen.
  fail(Number.isFinite(Date.parse(consumed?.checked_at)) && Date.parse(consumed.checked_at) >= Date.parse(frozen?.checked_at), 'consumption_before_frozen_source');
  fail(frozen?.cutoff === leaders?.cutoff && leaders?.cutoff === consumed?.source_cutoff, "frozen_cutoff_mismatch");
  const industries = leaders?.industries || [];
  fail(industries.length === 15 && Array.isArray(frozen?.items) && frozen.items.length >= 4, "frozen_industry_scan_incomplete");
  fail(industries.flatMap(r => r.leaders || []).every(r => require("./opening-report-stage-contract").allowed(r.yahoo_symbol, stage)), "frozen_market_scope_mismatch");
  fail(require("./opening-report-asia-freshness").summarizeReceiptFreshness(leaders || {}, date).stale_promoted_count === 0, "frozen_stale_source_promoted");
  fail(Array.isArray(nightIssues) && nightIssues.length === 0, "night_raw_evidence_invalid");
  return issues;
}
function resolvePreflight(directory, date) {
  const day = date.replace(/-/g, "");
  const files = {
    attempt: path.join(directory, `opening-report-0830-preflight-receipt-${day}.json`),
    frozen: path.join(directory, `opening-report-0830-market-snapshot-${day}.json`),
    leaders: path.join(directory, `opening-report-0830-overseas-leaders-${day}.json`),
    consumed: path.join(directory, `overseas-preflight-${day}.json`),
  };
  const attempt = read(files.attempt);
  if (attempt.ok === true) return attempt;
  try {
    const evidence = { attempt, frozen: read(files.frozen), leaders: read(files.leaders), consumed: read(files.consumed) };
    const { frozen } = evidence;
    const cutoff = frozen.recovery?.cutoff_at || require("./opening-report-stage-contract").cutoff(date, frozen.stage);
    const nightIssues = require("./opening-report-night-futures").verify(frozen.night_futures, {date, runId: frozen.run_id, cutoff});
    const issues = validate(evidence, date, frozen.stage, nightIssues);
    if (issues.length) return {...attempt, recovery_failed_checks: issues};
    return {...attempt, ok:true, report_status:"RECOVERED_FROZEN_EVIDENCE", execution_mode:"audited_frozen_evidence_recovery",
      original_attempt_ok:false, original_attempt_preserved:true, recovery_verified_at:new Date().toISOString(),
      recovery_evidence:Object.fromEntries(Object.entries(files).map(([key,file]) => [key,{file,sha256:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}]))};
  } catch(error) { return {...attempt, recovery_failed_checks:[error.message]}; }
}
module.exports = { validate, resolvePreflight };
