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
    verifier0850Freeze: "scripts/verify-opening-limit-order-0850-freeze.js",
    preferredBrokerVerifier: "scripts/verify-opening-limit-order-preferred-broker-readonly.js",
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
  const verifier0850Freeze = texts.verifier0850Freeze;
  const preferredBrokerVerifier = texts.preferredBrokerVerifier;
  const closedLoop = texts.closedLoopVerifier;
  need(all(morning, ["Run-OpeningLimitOrder0840ProgressiveReadonly.ps1", "-WaitUntil0840", "不掛單", "不 publish"]), failures, "morning_runner_drifted_from_0840_readonly_entry");
  need(all(progressive, ["opening-limit-order-0845-futopt-readback", "opening-limit-order-0850-preflight", "opening-limit-order-0855-summary", "Run-OpeningLimitOrder0855Readonly.ps1", "Run-OpeningLimitOrder0900Verifier.ps1", "opening-limit-order-morning-readonly"]), failures, "progressive_runner_drifted_from_full_morning_chain");
  need(all(progressive, ["uses_0900_data = $false", "creates_order = $false", "creates_formal_candidate = $false", "formal_candidate_count = 0", "publish_allowed = $false", "requires_second_confirm_before_action = $true"]), failures, "progressive_runner_readonly_guard_drifted");
  need(all(runner0855, ["opening-limit-order-0850-preflight", "opening-limit-order-0855-candidates", "opening-limit-order-0855-summary", "$displayCandidateRows = @($rankedCandidateRows | Select-Object -First 80)", "for ($index = 0; $index -lt $displayCandidateRows.Count; $index++)", "candidate_count = $candidateRows.Count", "formal_candidate_count = 0", "publish_allowed = $false"]), failures, "runner0855_display_vs_full_candidate_contract_drifted");
  need(all(runner0855, ["Ranking priority is intentionally evidence-first", "opening_report_rank_boost", "opening_report_rank_tier_sort", "preferred_broker_top_net_buy", "broker_score", "industry_futures_combo_score", "futures_score", "matched_rule_count", "final_score"]), failures, "runner0855_evidence_first_ranking_contract_drifted");
  need(all(morning, ["[string]$RunId", "opening-limit-order-{0}-{1}", "-RunId $RunId"]), failures, "morning_run_id_contract_drifted");
  need(all(progressive, ["[string]$RunId", "run_id = $RunId", "-RunId $RunId", "opening_limit_order_morning_readonly_chain_v1"]), failures, "progressive_run_id_contract_drifted");
  need(all(runner0855, ["[string]$RunId", "$runIdOk", "run_id = $RunId", "Add-Member -NotePropertyName run_id"]), failures, "runner0855_run_id_contract_drifted");
  need(all(verifier0900, ["[string]$RunId", "--run-id=$RunId", "Add-Member -NotePropertyName run_id"]), failures, "verifier0900_run_id_contract_drifted");
  need(all(verifier0850Freeze, ["expectedRunId", "predictionFreeze", "prediction_freeze_contract_invalid", "prediction_not_immutable"]), failures, "verifier0850_freeze_run_id_contract_drifted");
  need(all(closedLoop, ["taskLastResult", "task_0840_last_result_not_zero", "predictionFreeze", "prediction_freeze_not_immutable", "verifier_0900_late_repair_not_scheduled_pass", "run_id_missing_all_runtime_receipts"]), failures, "closed_loop_scheduled_run_id_contract_drifted");
  need(all(verifier0850Freeze, ["opening_limit_order_0850_freeze_verifier_v1", "08:50 Asia/Taipei", "monitor_and_rank_only", "ranked_predictions_drifted_from_0850", "summary_predictions_drifted_from_0850"]), failures, "verifier0850_freeze_immutability_contract_drifted");
  need(all(preferredBrokerVerifier, ["evidencePriorityKey", "evidence_priority_order_invalid", "preferred_broker_top_net_buy", "broker_score", "industry_futures_combo_score", "futures_score", "matched_rule_count", "evidence_priority_ranked_first"]), failures, "preferred_broker_verifier_evidence_first_ranking_contract_drifted");
  need(all(verifier0900, ["[string]$TradeDate", "OpeningLimitOrder0900Verifier", "verify-opening-limit-order-0850-freeze.js", "opening-limit-order-0900-verifier"]), failures, "verifier0900_contract_drifted");
  if (has(verifier0900, "Invoke-FumanWeekdayGuard")) failures.push("verifier0900_uses_formal_source_window_guard");
  need(all(candidate, ["const REQUIRED_PREOPEN_SLOTS = [\"0845\", \"0850\"]", "async function loadPreopenRowsBySymbols", "async function loadStockFutureStrengthRows", "v_fugle_daytrade_near_one_contract", "v_fugle_daytrade_preopen_snapshot_contract", "v_stock_future_live_contract", "fallback_preopen_near_snapshot", "0845_0850_natural_evidence", "stock_future_live_ready", "stock_future_strength_source", "futures_score_ready", "futures_score_ready_cases"]), failures, "candidate_verifier_futures_fallback_contract_drifted");
  need(all(candidate, ["function futuresScore(preopen)", "function industryFuturesComboScore(report, preopen)", "const FUTURES_SCORE_CAP = 30", "const INDUSTRY_FUTURES_COMBO_SCORE = 20", "opening_report_score_cap", "formal_candidate_by_report_allowed: false"]), failures, "candidate_scoring_contract_drifted");
  need(all(candidate, ["LIMIT_UP_NEXT_DAY_TRIAL_SHORT_MIN_PCT", "LIMIT_UP_NEXT_DAY_TRIAL_SHORT_MAX_PCT", "LIMIT_UP_NEXT_DAY_TRIAL_LONG_FLAT_MIN_PCT", "LIMIT_UP_NEXT_DAY_TRIAL_LONG_DOWN_MIN_PCT", "LIMIT_UP_KD_PREOPEN_HIGH_SHORT", "LIMIT_UP_KD_PREOPEN_FLAT_DOWN_LONG", "LIMIT_UP_NEXT_DAY_TRIAL_OUTSIDE_RANGE_NO_TRADE", "n(slot.trial_price) > 0"]), failures, "predictor_limit_up_next_day_trial_scenario_drifted");
  need(all(candidate, ["openingShortSignal", "opening-short-postclose-", "LIMIT_UP_KD_PREOPEN_HIGH_SHORT", "LIMIT_UP_KD_PREOPEN_FLAT_DOWN_LONG", "LIMIT_UP_KD_PREOPEN_TRIAL_DATA_GAP"]), failures, "predictor_opening_short_postclose_receipt_drifted");
  need(has(candidate, "output.ok = output.readback_counts.futures_score_ready_cases > 0 || snapshots.length > 0 || nearRows.length > 0"), failures, "preopen_evidence_should_not_fail_when_live_view_times_out");
  need(all(verifier0850Freeze, ["opening-limit-order-0845-futopt-readback", "readonly_action_guard_invalid", "prediction_row_contract_invalid"]), failures, "verifier0850_freeze_readback_contract_drifted");
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
      evidence_first_ranking_required: true,
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
