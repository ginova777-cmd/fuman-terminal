"use strict";
const fs = require("fs");
const path = require("path");
const CONTRACT = "opening_limit_order_operation_flow_contract_v1";
const ROOT = path.resolve(__dirname, "..");
function read(rel) { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch (error) { return ""; } }
function has(text, needle) { return String(text ? text : "").indexOf(needle) !== -1; }
function all(text, needles) { return needles.every(function (needle) { return has(text, needle); }); }
function need(condition, failures, name) { if (!condition) failures.push(name); }
function main() {
  const failures = [];
  const warnings = [];
  const files = {
    morningRunner: "ops/Run-OpeningLimitOrderMorningReadonly.ps1",
    progressiveRunner: "ops/Run-OpeningLimitOrder0840ProgressiveReadonly.ps1",
    runner0855: "ops/Run-OpeningLimitOrder0855Readonly.ps1",
    verifier0900: "ops/Run-OpeningLimitOrder0900Verifier.ps1",
    candidateVerifier: "scripts/verify-opening-limit-order-candidate-readonly.js",
    verifier0855: "scripts/verify-opening-limit-order-0855-readonly.js",
    closedLoopVerifier: "scripts/verify-opening-limit-order-closed-loop.js"
  };
  const texts = {};
  Object.keys(files).forEach(function (key) {
    const rel = files[key];
    if (!fs.existsSync(path.join(ROOT, rel))) failures.push(key + "_missing");
    texts[key] = read(rel);
  });
  const morning = texts.morningRunner;
  const progressive = texts.progressiveRunner;
  const runner0855 = texts.runner0855;
  const verifier0900 = texts.verifier0900;
  const candidate = texts.candidateVerifier;
  const verifier0855 = texts.verifier0855;
  const closedLoop = texts.closedLoopVerifier;
  need(all(morning, ["Run-OpeningLimitOrder0840ProgressiveReadonly.ps1", "-WaitUntil0840", "不掛單", "不 publish"]), failures, "morning_runner_drifted_from_0840_readonly_entry");
  need(all(progressive, ["opening-limit-order-0845-futopt-readback", "opening-limit-order-0850-preflight", "opening-limit-order-0855-summary", "Run-OpeningLimitOrder0855Readonly.ps1", "Run-OpeningLimitOrder0900Verifier.ps1", "opening-limit-order-morning-readonly"]), failures, "progressive_runner_drifted_from_full_morning_chain");
  need(all(progressive, ["uses_0900_data = $false", "creates_order = $false", "creates_formal_candidate = $false", "formal_candidate_count = 0", "publish_allowed = $false", "requires_second_confirm_before_action = $true"]), failures, "progressive_runner_readonly_guard_drifted");
  need(all(runner0855, ["opening-limit-order-0850-preflight", "opening-limit-order-0855-candidates", "opening-limit-order-0855-summary", "$displayCandidateRows = @($rankedCandidateRows | Select-Object -First 80)", "for ($index = 0; $index -lt $displayCandidateRows.Count; $index++)", "candidate_count = $candidateRows.Count", "formal_candidate_count = 0", "publish_allowed = $false"]), failures, "runner0855_display_vs_full_candidate_contract_drifted");
  need(all(verifier0900, ["[string]$TradeDate", "OpeningLimitOrder0900Verifier", "verify-opening-limit-order-0855-readonly.js", "opening-limit-order-0900-verifier"]), failures, "verifier0900_contract_drifted");
  if (has(verifier0900, "Invoke-FumanWeekdayGuard")) failures.push("verifier0900_uses_formal_source_window_guard");
  need(all(candidate, ["const REQUIRED_PREOPEN_SLOTS = [\"0845\", \"0850\"]", "async function loadPreopenRowsBySymbols", "async function loadStockFutureStrengthRows", "v_fugle_daytrade_near_one_contract", "v_fugle_daytrade_preopen_snapshot_contract", "v_stock_future_live_contract", "fallback_preopen_near_snapshot", "0845_0850_natural_evidence", "stock_future_live_ready", "stock_future_strength_source", "futures_score_ready", "futures_score_ready_cases"]), failures, "candidate_verifier_futures_fallback_contract_drifted");
  need(all(candidate, ["function futuresScore(preopen)", "function industryFuturesComboScore(report, preopen)", "const FUTURES_SCORE_CAP = 30", "const INDUSTRY_FUTURES_COMBO_SCORE = 20", "opening_report_score_cap", "formal_candidate_by_report_allowed: false"]), failures, "candidate_scoring_contract_drifted");
  need(has(candidate, "output.ok = output.readback_counts.futures_score_ready_cases > 0 || snapshots.length > 0 || nearRows.length > 0"), failures, "preopen_evidence_should_not_fail_when_live_view_times_out");
  need(all(verifier0855, ["opening-limit-order-0845-futopt-readback", "futuresScoreReadyCases", "futures_score_ready_cases", "futures_score_positive_count", "industry_futures_combo_score_positive_count", "fallback_strength_cases", "preopen_evidence_ready", "futopt_receipt_ready_but_no_symbol_score_ready", "stock_future_live_timeout_without_near_snapshot_fallback", "futopt_score_ready_but_summary_futures_score_all_zero"]), failures, "verifier0855_futures_score_readback_contract_drifted");
  need(all(closedLoop, ["opening_limit_order_closed_loop_readiness_v1", "Run-OpeningLimitOrderMorningReadonly.ps1", "Run-OpeningLimitOrder0900Verifier.ps1", "allow-late-repair", "preflight_completed_after_0855", "summary_completed_after_0900", "creates_order === false", "creates_formal_candidate === false", "publish_allowed === false"]), failures, "closed_loop_verifier_contract_drifted");
  const ok = failures.length === 0;
  const output = {
    ok: ok,
    contract: CONTRACT,
    checked_at: new Date().toISOString(),
    source_root: ROOT,
    flow_contract: {
      readonly_only: true,
      no_order: true,
      no_formal_candidate: true,
      no_publish: true,
      morning_chain: ["08:40", "08:45", "08:50", "08:55", "09:00", "closed-loop"],
      futures_live_timeout_fallback_required: true,
      fallback_source: "0845_0850_natural_evidence",
      fallback_strength_status: "fallback_preopen_near_snapshot",
      display_limit_can_be_80_but_candidate_receipt_must_remain_full: true
    },
    checked_files: files,
    warnings: warnings,
    failed_checks: failures,
    first_blocker: failures[0] ? failures[0] : null
  };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = ok ? 0 : 1;
}
main();
