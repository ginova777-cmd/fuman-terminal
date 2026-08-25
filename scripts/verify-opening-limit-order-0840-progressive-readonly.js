#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const CONTRACT = "opening_limit_order_0840_progressive_verifier_v1";
const TERMINAL_DIR = process.env.FUMAN_TERMINAL_DIR || "C:\\fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
function compact(date) { return String(date || "").replace(/[^0-9]/g, ""); }
function todayTaipei() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function exists(file) { return fs.existsSync(file); }
function read(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return { __read_error: error.message }; } }
function array(value) { return Array.isArray(value) ? value : []; }
function guardOk(guard) {
  return guard && guard.creates_order === false && guard.creates_formal_candidate === false && guard.publish_allowed === false && guard.requires_second_confirm_before_action === true;
}
function openingReportExpectedTierScore(rank) {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  if (rank <= 1) return 55;
  if (rank <= 2) return 48;
  if (rank <= 3) return 42;
  if (rank <= 4) return 36;
  if (rank <= 8) return 28;
  return 18;
}

function main() {
  const tradeDate = arg("trade-date", todayTaipei());
  const requireRuntime = arg("require-runtime", "1") !== "0";
  const dateCompact = compact(tradeDate);
  const outDir = path.join(RUNTIME_DIR, "data", "opening-limit-order");
  const files = {
    progressive: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0840ProgressiveReadonly.ps1"),
    morning: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrderMorningReadonly.ps1"),
    runner0855: path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0855Readonly.ps1"),
    displayVerifier: path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-display-contract-readonly.js"),
    preCandidates: path.join(outDir, `opening-limit-order-0840-pre-candidates-${dateCompact}.json`),
    futoptReadback: path.join(outDir, `opening-limit-order-0845-futopt-readback-${dateCompact}.json`),
    ranked: path.join(outDir, `opening-limit-order-0855-ranked-watchlist-${dateCompact}.json`),
    candidates: path.join(outDir, `opening-limit-order-0855-candidates-${dateCompact}.json`),
    summary: path.join(outDir, `opening-limit-order-0855-summary-${dateCompact}.json`),
  };

  const failures = [];
  const rowFailures = [];
  for (const [label, file] of Object.entries({ progressive: files.progressive, morning: files.morning, runner0855: files.runner0855, displayVerifier: files.displayVerifier })) {
    if (!exists(file)) failures.push(`${label}_file_missing`);
  }

  const progressive = read(files.progressive);
  const morning = read(files.morning);
  const runner0855 = read(files.runner0855);
  const displayVerifier = read(files.displayVerifier);

  if (!progressive.includes("Wait-UntilTaipeiTime") || !progressive.includes("08:40:00")) failures.push("0840_wait_contract_missing");
  if (!progressive.includes('Wait-UntilTaipeiTime -HHmmss ("{0}:00" -f $slot)')) failures.push("futopt_slot_wait_contract_missing");
  if (!progressive.includes('Wait-UntilTaipeiTime -HHmmss "08:55:00"')) failures.push("0855_wait_contract_missing");
  if (!progressive.includes("opening-limit-order-0840-pre-candidates")) failures.push("0840_pre_candidates_receipt_missing");
  if (!progressive.includes("opening-limit-order-0845-futopt-readback")) failures.push("0845_futopt_receipt_missing");
  if (!progressive.includes("daytrade_futopt_preopen_natural_receipts") || !progressive.includes("evidence_ok = $futoptEvidenceOk")) failures.push("futopt_natural_receipt_readback_contract_missing");
  if (!progressive.includes("opening-limit-order-0855-ranked-watchlist")) failures.push("0855_ranked_receipt_missing");
  if (!progressive.includes("uses_0900_data = $false")) failures.push("0900_data_guard_missing");
  if (!progressive.includes("creates_order = $false") || !progressive.includes("creates_formal_candidate = $false") || !progressive.includes("publish_allowed = $false")) failures.push("action_guard_static_missing");
  if (!progressive.includes("requires_second_confirm_before_action = $true")) failures.push("second_confirm_guard_missing");
  if (!morning.includes("Run-OpeningLimitOrder0840ProgressiveReadonly.ps1") || !morning.includes("-WaitUntil0840")) failures.push("morning_runner_not_using_0840_progressive");
  if (!runner0855.includes("weighted score first") || !runner0855.includes("matched_rule_count") || !runner0855.includes("futopt_positive_basis") || !runner0855.includes("industry_futures_combo_score")) failures.push("0855_weighted_ranking_static_missing");
  if (!runner0855.includes("final_score = $row.entry_score") || !runner0855.includes("score_components") || !runner0855.includes("futures_score") || !runner0855.includes("industry_futures_combo_score")) failures.push("0855_final_score_fields_missing");
  if (!displayVerifier.includes("final_score_order_invalid")) failures.push("display_verifier_final_score_order_missing");
  const scheduledTaskName = "Fuman Opening Limit Order Morning Readonly 0845";
  const scheduledTask = childProcess.spawnSync("schtasks", ["/Query", "/TN", scheduledTaskName, "/V", "/FO", "LIST"], { encoding: "utf8" });
  const scheduledTaskText = String(scheduledTask.stdout || "") + String(scheduledTask.stderr || "");
  if (scheduledTask.status !== 0) failures.push("schedule_task_unreadable");
  else {
    if (!scheduledTaskText.includes("Run-OpeningLimitOrderMorningReadonly.ps1")) failures.push("schedule_not_using_morning_runner");
    if (!/Start Time:\s*(?:上午\s*)?08:40:00/i.test(scheduledTaskText)) failures.push("schedule_not_0840");
    if (!/Scheduled Task State:\s*Enabled/i.test(scheduledTaskText)) failures.push("schedule_not_enabled");
  }
  const candidateVerifier = read(path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-candidate-readonly.js"));
  if (!candidateVerifier.includes("strategy_first_then_positive_overseas_return_rank_tier_futures_weighted_ranking_no_formal_by_report") || !candidateVerifier.includes("OPENING_REPORT_SCORE_TIERS") || !candidateVerifier.includes("function openingReportScoreForRank") || !candidateVerifier.includes("positive_return_rank") || !candidateVerifier.includes("industryFuturesComboScore") || !candidateVerifier.includes("futuresScore") || !candidateVerifier.includes("OPENING_REPORT_SCORE_CAP = 55") || !candidateVerifier.includes("FUTURES_SCORE_CAP = 30") || !candidateVerifier.includes("INDUSTRY_FUTURES_COMBO_SCORE = 20") || !candidateVerifier.includes("function openingReportSectorPositive") || !candidateVerifier.includes("if (!openingReportSectorPositive(report)) return 0")) failures.push("candidate_weighted_score_contract_missing");

  let preCandidates = null;
  let futopt = null;
  let ranked = null;
  let candidatesFile = null;
  let summary = null;
  if (requireRuntime) {
    for (const [label, file] of Object.entries({ preCandidates: files.preCandidates, futoptReadback: files.futoptReadback, ranked: files.ranked, candidates: files.candidates, summary: files.summary })) {
      if (!exists(file)) failures.push(`${label}_runtime_file_missing`);
    }
    preCandidates = readJson(files.preCandidates);
    futopt = readJson(files.futoptReadback);
    ranked = readJson(files.ranked);
    candidatesFile = readJson(files.candidates);
    summary = readJson(files.summary);
    if (preCandidates.__read_error) failures.push(`pre_candidates_unreadable:${preCandidates.__read_error}`);
    if (futopt.__read_error) failures.push(`futopt_readback_unreadable:${futopt.__read_error}`);
    if (ranked.__read_error) failures.push(`ranked_unreadable:${ranked.__read_error}`);
    if (candidatesFile.__read_error) failures.push(`candidates_unreadable:${candidatesFile.__read_error}`);
    if (summary.__read_error) failures.push(`summary_unreadable:${summary.__read_error}`);

    if (preCandidates.trade_date !== tradeDate) failures.push("pre_candidates_trade_date_mismatch");
    if (futopt.trade_date !== tradeDate) failures.push("futopt_trade_date_mismatch");
    if (ranked.trade_date !== tradeDate) failures.push("ranked_trade_date_mismatch");
    if (candidatesFile.trade_date !== tradeDate) failures.push("candidates_trade_date_mismatch");
    if (preCandidates.ok !== true) failures.push("pre_candidates_ok_not_true");
    if (futopt.ok !== true) failures.push("futopt_readback_ok_not_true");
    if (typeof futopt.evidence_ok !== "boolean") failures.push("futopt_evidence_ok_missing");
    if (futopt.status === "READY_FOR_0855_RANKING" && futopt.evidence_ok !== true) failures.push("futopt_fake_ready_without_evidence");
    if (!futopt.slot_receipts || !futopt.slot_receipts["0845"] || !futopt.slot_receipts["0850"]) failures.push("futopt_slot_receipts_missing");
    if (ranked.ok !== true) failures.push("ranked_ok_not_true");
    if (candidatesFile.ok !== true) failures.push("candidates_ok_not_true");
    if (preCandidates.uses_0900_data !== false || futopt.uses_0900_data !== false || ranked.uses_0900_data !== false) failures.push("runtime_uses_0900_data_guard_failed");
    if (!guardOk(preCandidates.action_guard)) failures.push("pre_candidates_action_guard_failed");
    if (!guardOk(futopt.action_guard)) failures.push("futopt_action_guard_failed");
    if (!guardOk(ranked.action_guard)) failures.push("ranked_action_guard_failed");
    if (ranked.formal_candidate_count !== 0 || ranked.formal_candidate_allowed !== false || ranked.publish_allowed !== false) failures.push("ranked_formal_publish_guard_failed");
    if (Number(ranked.candidate_count) !== array(ranked.candidates).length) failures.push("ranked_candidate_count_mismatch");

    const sourceRowsBySymbol = new Map(array(candidatesFile.rows).map((row) => [String(row?.symbol || ""), row]));
    const futoptEvidenceOk = futopt?.evidence_ok === true;
    let previousScore = Number.POSITIVE_INFINITY;
    array(ranked.candidates).forEach((row, index) => {
      const symbol = String(row?.symbol || "");
      const score = Number(row?.final_score ?? row?.entry_score);
      if (Number(row?.rank) !== index + 1) rowFailures.push(`${symbol}:rank_not_sequential`);
      if (!Number.isFinite(score)) rowFailures.push(`${symbol}:final_score_missing`);
      if (Number.isFinite(score) && score > previousScore + 0.000001) rowFailures.push(`${symbol}:final_score_order_invalid`);
      if (!array(row?.matched_strategy_numbers).length) rowFailures.push(`${symbol}:matched_strategy_numbers_missing`);
      if (row?.status === "OPEN_LIMIT_ORDER_CANDIDATE" && !array(row?.matched_strategy_numbers).length) rowFailures.push(`${symbol}:candidate_without_strategy_gate`);
      const components = row?.score_components || {};
      const expectedFinal = Number(components.base_score || 0) + Number(components.opening_report_score || 0) + Number(components.futures_score || 0) + Number(components.industry_futures_combo_score || 0) + Number(components.broker_score || 0);
      if (row?.score_components && Number.isFinite(expectedFinal) && Math.min(100, expectedFinal) !== score) rowFailures.push(`${symbol}:score_components_not_equal_final_score`);
      if (row?.score_components && Number(components.opening_report_score || 0) > 55) rowFailures.push(`${symbol}:opening_report_score_cap_exceeded`);
      if (row?.score_components && Number(components.futures_score || 0) > 30) rowFailures.push(`${symbol}:futures_score_cap_exceeded`);
      if (row?.score_components && Number(components.industry_futures_combo_score || 0) > 20) rowFailures.push(`${symbol}:industry_futures_combo_score_cap_exceeded`);
      const futuresSignal = row?.futopt_positive_basis === true || row?.trial_match_ready === true || row?.inverse_convergence_ready === true;
      if (!futoptEvidenceOk && (Number(components.futures_score || 0) > 0 || Number(components.industry_futures_combo_score || 0) > 0 || futuresSignal)) rowFailures.push(`${symbol}:futopt_score_without_formal_evidence`);
      const sourceRow = sourceRowsBySymbol.get(symbol);
      const evidence = sourceRow?.evidence || {};
      const openingBiases = Array.isArray(evidence.opening_report_biases) ? evidence.opening_report_biases : [];
      const positiveOpeningSector = evidence.opening_report_strong_sector_return_1d === true || openingBiases.includes("positive_detected");
      if (Number(components.opening_report_score || 0) > 0 && !positiveOpeningSector) rowFailures.push(`${symbol}:opening_report_score_without_positive_sector`);
      const industrySignal = positiveOpeningSector;
      if (futuresSignal && industrySignal && Number(components.industry_futures_combo_score || 0) <= 0) rowFailures.push(`${symbol}:industry_futures_combo_score_missing`);
      if (!row?.matched_strategy_numbers_text) rowFailures.push(`${symbol}:matched_strategy_numbers_text_missing`);
      if (!row?.matched_strategy_summary_zh) rowFailures.push(`${symbol}:matched_strategy_summary_zh_missing`);
      previousScore = Number.isFinite(score) ? score : previousScore;
    });
  }
  if (rowFailures.length) failures.push("ranked_row_failures");

  const result = {
    ok: failures.length === 0,
    contract: CONTRACT,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    static_contract: {
      morning_uses_0840_progressive: !failures.includes("morning_runner_not_using_0840_progressive"),
      no_0900_data_before_open: !failures.some((f) => f.includes("0900")),
      final_score_desc_required: !failures.includes("display_verifier_final_score_order_missing"),
      action_guard_required: !failures.some((f) => f.includes("action_guard_static_missing") || f.includes("second_confirm_guard_missing")),
      schedule_0840_ready: !failures.some((f) => f === "schedule_not_0840" || f === "schedule_not_enabled" || f === "schedule_not_using_morning_runner"),
    },
    runtime_readback: requireRuntime ? {
      schedule_task_name: "Fuman Opening Limit Order Morning Readonly 0845",
      schedule_next_run_0840: !failures.includes("schedule_not_0840"),
      pre_candidates_path: files.preCandidates,
      futopt_readback_path: files.futoptReadback,
      ranked_path: files.ranked,
      summary_path: files.summary,
      pre_candidates_ok: preCandidates?.ok === true,
      pre_candidates_symbol_count: preCandidates?.symbol_count ?? null,
      futopt_readback_ok: futopt?.ok === true,
      futopt_evidence_ok: futopt?.evidence_ok ?? null,
      futopt_status: futopt?.status ?? null,
      futopt_first_blocker: futopt?.first_blocker ?? null,
      ranked_ok: ranked?.ok === true,
      ranked_candidate_count: ranked?.candidate_count ?? null,
      summary_candidate_count: summary?.candidate_count ?? null,
      formal_candidate_count: ranked?.formal_candidate_count ?? null,
      publish_allowed: ranked?.publish_allowed ?? null,
    } : null,
    row_failures: rowFailures.slice(0, 80),
    failed_checks: failures,
    first_blocker: failures[0] || null,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
main();









