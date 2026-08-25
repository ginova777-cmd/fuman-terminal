"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT = "opening_limit_order_0855_readonly_verifier_v2";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data", "opening-limit-order");

const EXPECTED_RULES = [
  "limit_down_reopened_main_force_cost_high",
  "low_rebound_two_day_up_institution_buy",
  "ma60_support_us_sector_strong",
  "ma240_breakout_us_sector_strong",
  "futopt_near_prev_close_trial_limit_down_us_sector",
  "futopt_basis_or_inverse_convergence",
  "two_day_us_sector_strong_mapped_tw",
  "w_neckline_two_day_hold_overnight_trader_branches",
  "us_sector_key_level_hold_two_days",
  "previous_limit_up_futopt_positive_basis",
];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function taipeiHhmm(value) {
  const timestamp = new Date(value || "");
  if (!Number.isFinite(timestamp.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(timestamp).replace(":", "");
}
function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function dashDate(value) {
  const c = compactDate(value);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : "";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { __read_error: error?.message || String(error) };
  }
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function guardOk(guard) {
  return guard
    && guard.creates_order === false
    && guard.creates_formal_candidate === false
    && guard.publish_allowed === false
    && guard.requires_second_confirm_before_action === true;
}

function main() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate()));
  const compact = compactDate(tradeDate);
  const requireRows = arg("require-rows", "0") === "1";
  const expectedRunId = arg("run-id", "");
  const summaryPath = arg("summary", path.join(DATA_DIR, `opening-limit-order-0855-summary-${compact}.json`));
  const candidatePath = arg("candidates", path.join(DATA_DIR, `opening-limit-order-0855-candidates-${compact}.json`));
  const watchlistPath = arg("watchlist", path.join(DATA_DIR, `opening-limit-order-0855-watchlist-${compact}.json`));
  const preflightPath = arg("preflight", path.join(DATA_DIR, `opening-limit-order-0850-preflight-${compact}.json`));
  const futoptReadbackPath = arg("futopt-readback", path.join(DATA_DIR, `opening-limit-order-0845-futopt-readback-${compact}.json`));

  const failures = [];
  const rowFailures = [];

  if (!tradeDate) failures.push("trade_date_invalid");
  for (const [label, file] of [["preflight", preflightPath], ["summary", summaryPath], ["candidates", candidatePath], ["watchlist", watchlistPath], ["futopt_readback", futoptReadbackPath]]) {
    if (!exists(file)) failures.push(`${label}_file_missing`);
  }

  const preflight = readJson(preflightPath);
  const summary = readJson(summaryPath);
  const candidate = readJson(candidatePath);
  const watchlist = readJson(watchlistPath);
  const futoptReadback = readJson(futoptReadbackPath);
  if (preflight.__read_error) failures.push(`preflight_unreadable:${preflight.__read_error}`);
  if (summary.__read_error) failures.push(`summary_unreadable:${summary.__read_error}`);
  if (candidate.__read_error) failures.push(`candidates_unreadable:${candidate.__read_error}`);
  if (watchlist.__read_error) failures.push(`watchlist_unreadable:${watchlist.__read_error}`);
  if (futoptReadback.__read_error) failures.push(`futopt_readback_unreadable:${futoptReadback.__read_error}`);

  const preflightHhmm = taipeiHhmm(preflight.checked_at);
  const summaryHhmm = taipeiHhmm(summary.checked_at);
  if (!/^\d{4}$/.test(preflightHhmm)) failures.push("preflight_checked_at_invalid");
  else if (preflightHhmm > "0855") failures.push("preflight_completed_after_0855");
  if (!/^\d{4}$/.test(summaryHhmm)) failures.push("summary_checked_at_invalid");
  else if (summaryHhmm > "0900") failures.push("summary_completed_after_0900");
  if (dashDate(preflight.trade_date) !== tradeDate) failures.push("preflight_trade_date_mismatch");
  if (dashDate(summary.trade_date) !== tradeDate) failures.push("summary_trade_date_mismatch");
  if (dashDate(candidate.trade_date) !== tradeDate) failures.push("candidate_trade_date_mismatch");
  if (dashDate(watchlist.trade_date) !== tradeDate) failures.push("watchlist_trade_date_mismatch");
  if (dashDate(futoptReadback.trade_date) !== tradeDate) failures.push("futopt_readback_trade_date_mismatch");

  const runIdReadback = {
    preflight: String(preflight.run_id || ""),
    summary: String(summary.run_id || ""),
    candidates: String(candidate.run_id || ""),
    watchlist: String(watchlist.run_id || ""),
    futopt_readback: String(futoptReadback.run_id || ""),
  };
  const resolvedRunId = expectedRunId || Object.values(runIdReadback).find(Boolean) || "";
  if (!resolvedRunId) failures.push("run_id_missing_all_receipts");
  for (const [label, value] of Object.entries(runIdReadback)) {
    if (!value) failures.push(`${label}_run_id_missing`);
    else if (resolvedRunId && value !== resolvedRunId) failures.push(`${label}_run_id_mismatch`);
  }
  if (expectedRunId && resolvedRunId && resolvedRunId !== expectedRunId) failures.push("expected_run_id_mismatch");

  if (preflight.contract !== "opening_limit_order_0850_preflight_v1") failures.push("preflight_contract_mismatch");
  if (preflight.phase !== "0850_preopen_watchlist_warmup") failures.push("preflight_phase_mismatch");
  if (preflight.candidate_deadline !== "08:55:00 Asia/Taipei") failures.push("preflight_candidate_deadline_mismatch");
  if (preflight.watchlist_path !== watchlistPath) failures.push("preflight_watchlist_path_mismatch");
  if (summary.preflight_path !== preflightPath) failures.push("summary_preflight_path_mismatch");
  if (summary.watchlist_source !== "0850_preflight_reused") failures.push("summary_did_not_reuse_verified_0850_watchlist");
  if (summary.contract !== "opening_limit_order_0855_readonly_runner_v1") failures.push("summary_contract_mismatch");
  if (candidate.contract !== "opening_limit_order_candidate_gate_v1") failures.push("candidate_contract_mismatch");
  if (watchlist.contract !== "opening_limit_order_watchlist_builder_v1") failures.push("watchlist_contract_mismatch");

  if (!guardOk(preflight.action_guard)) failures.push("preflight_action_guard_failed");
  if (preflight.formal_candidate_count !== 0 || preflight.formal_candidate_allowed !== false || preflight.publish_allowed !== false) failures.push("preflight_action_boundary_failed");
  if (!guardOk(summary.action_guard)) failures.push("summary_action_guard_failed");
  if (!guardOk(candidate.action_guard)) failures.push("candidate_action_guard_failed");
  if (candidate.test_override_mode === true) failures.push("candidate_test_override_mode_must_be_false");
  const futoptReady = futoptReadback?.evidence_ok === true || futoptReadback?.ok === true;
  const preopenReadback = candidate.preopen_evidence_readback || {};
  const preopenCounts = preopenReadback.readback_counts || {};
  const futuresScoreReadyCases = Number(preopenCounts.futures_score_ready_cases || 0);
  const stockFutureRows = Number(preopenCounts.stock_future_live_rows || 0);
  const fallbackStrengthCases = Number(preopenCounts.fallback_strength_cases || 0);
  if (futoptReady && candidate.phase_readiness?.preopen_evidence_ready !== true) failures.push("futopt_receipt_ready_but_preopen_evidence_not_ready");
  if (futoptReady && futuresScoreReadyCases <= 0) failures.push("futopt_receipt_ready_but_no_symbol_score_ready");
  if (futoptReady && futuresScoreReadyCases <= 0 && stockFutureRows <= 0 && fallbackStrengthCases <= 0) failures.push("stock_future_live_timeout_without_near_snapshot_fallback");
  if (!guardOk(watchlist.action_guard)) failures.push("watchlist_action_guard_failed");
  if (Number(watchlist?.sources?.opening_report?.files_accepted || 0) < 19) failures.push("opening_report_strength_files_below_19");
  if (summary.formal_candidate_count !== 0) failures.push("summary_formal_candidate_count_not_zero");
  if (summary.formal_candidate_allowed !== false) failures.push("summary_formal_candidate_allowed_not_false");
  if (summary.publish_allowed !== false) failures.push("summary_publish_allowed_not_false");

  const implementedRules = array(candidate.implemented_rules);
  for (const rule of EXPECTED_RULES) {
    if (!implementedRules.includes(rule)) failures.push(`implemented_rule_missing:${rule}`);
  }
  if (implementedRules.length < 10) failures.push("implemented_rules_less_than_10");
  if (candidate.rule_display_contract !== "opening_limit_order_strategy_display_v1") failures.push("candidate_rule_display_contract_missing");
  if (!candidate.rule_definitions || typeof candidate.rule_definitions !== "object") failures.push("candidate_rule_definitions_missing");

  const rows = array(candidate.rows);
  const candidates = rows.filter((row) => row?.status === "OPEN_LIMIT_ORDER_CANDIDATE");
  const summaryCandidates = array(summary.candidates);
  const futuresScorePositiveCount = summaryCandidates.filter((row) => Number(row?.futures_score || row?.evidence?.futures_score || 0) > 0).length;
  const industryFuturesComboScorePositiveCount = summaryCandidates.filter((row) => Number(row?.industry_futures_combo_score || row?.evidence?.industry_futures_combo_score || 0) > 0).length;
  function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function evidencePriorityKey(row) {
    const futoptReady = row?.futopt_positive_basis === true || row?.trial_match_ready === true || row?.inverse_convergence_ready === true;
    return [
      num(row?.opening_report_rank_boost),
      -num(row?.opening_report_rank_tier_sort),
      row?.preferred_broker_top_net_buy === true ? 1 : 0,
      num(row?.broker_score),
      num(row?.industry_futures_combo_score),
      num(row?.futures_score),
      futoptReady ? 1 : 0,
      num(row?.matched_rule_count),
      num(row?.final_score ?? row?.entry_score),
    ];
  }
  function evidencePriorityCompare(a, b) {
    const left = evidencePriorityKey(a);
    const right = evidencePriorityKey(b);
    for (let index = 0; index < left.length; index += 1) {
      if (Math.abs(left[index] - right[index]) > 0.000001) return left[index] > right[index] ? -1 : 1;
    }
    return String(a?.symbol || "").localeCompare(String(b?.symbol || ""));
  }
  if (requireRows && candidates.length === 0) failures.push("candidate_rows_required_but_empty");

  for (const row of summaryCandidates) {
    const reasons = array(row?.reasons);
    if (row?.status === "OPEN_LIMIT_ORDER_CANDIDATE") {
      if (row.ok !== true) rowFailures.push(`${row.symbol || "unknown"}:candidate_ok_not_true`);
      if (reasons.length < 1) rowFailures.push(`${row.symbol || "unknown"}:candidate_without_reason`);
      if (row.candidate_min_matched_rules !== 1) rowFailures.push(`${row.symbol || "unknown"}:candidate_min_matched_rules_not_1`);
      if (Number(row.matched_rule_count) !== reasons.length) rowFailures.push(`${row.symbol || "unknown"}:matched_rule_count_mismatch`);
      if (!Array.isArray(row.matched_strategy_numbers) || row.matched_strategy_numbers.length !== reasons.length) rowFailures.push(`${row.symbol || "unknown"}:matched_strategy_numbers_missing_or_mismatch`);
      if (!Array.isArray(row.matched_strategy_labels) || row.matched_strategy_labels.length !== reasons.length) rowFailures.push(`${row.symbol || "unknown"}:matched_strategy_labels_missing_or_mismatch`);
      if (!String(row.matched_strategy_numbers_text || "").includes("策略")) rowFailures.push(`${row.symbol || "unknown"}:matched_strategy_numbers_text_missing`);
      if (!String(row.matched_strategy_summary_zh || "").includes("策略")) rowFailures.push(`${row.symbol || "unknown"}:matched_strategy_summary_zh_missing`);
      if (!String(row.qualified_label || "").includes("符合")) rowFailures.push(`${row.symbol || "unknown"}:qualified_label_missing`);
    }
  }

  if (Number(summary.candidate_count || 0) !== candidates.length) failures.push("summary_candidate_count_mismatch");
  for (let index = 1; index < summaryCandidates.length; index += 1) {
    if (evidencePriorityCompare(summaryCandidates[index - 1], summaryCandidates[index]) > 0) {
      failures.push("summary_evidence_priority_order_invalid");
      break;
    }
  }
  if (summaryCandidates.length !== Math.min(80, candidates.length)) failures.push("summary_candidate_display_count_mismatch");
  if (futoptReady && summaryCandidates.length > 0 && futuresScoreReadyCases > 0 && futuresScorePositiveCount <= 0) failures.push("futopt_score_ready_but_summary_futures_score_all_zero");
  if (Number(watchlist.formal_candidate_count || 0) !== 0) failures.push("watchlist_formal_candidate_count_not_zero");
  if (watchlist.formal_candidate_allowed !== false) failures.push("watchlist_formal_candidate_allowed_not_false");

  const output = {
    ok: failures.length === 0 && rowFailures.length === 0,
    contract: CONTRACT,
    trade_date: tradeDate,
    run_id: resolvedRunId,
    checked_at: new Date().toISOString(),
    run_id_readback: runIdReadback,
    files: {
      preflight_path: preflightPath,
      summary_path: summaryPath,
      candidate_path: candidatePath,
      watchlist_path: watchlistPath,
      futopt_readback_path: futoptReadbackPath,
    },
    timing: {
      preflight_checked_at: preflight.checked_at || null,
      preflight_taipei_hhmm: preflightHhmm || null,
      preflight_deadline: "08:55",
      summary_checked_at: summary.checked_at || null,
      summary_taipei_hhmm: summaryHhmm || null,
      summary_deadline: "09:00",
    },    rule_contract: {
      implemented_rule_count: implementedRules.length,
      expected_rule_count: EXPECTED_RULES.length,
      candidate_min_matched_rules: 1,
      candidate_policy: "any_one_of_10_rules",
    },
    counts: {
      preflight_watchlist_symbol_count: Number(preflight.watchlist_symbol_count || 0),
      opening_report_strength_files_accepted: Number(watchlist?.sources?.opening_report?.files_accepted || 0),
      watchlist_symbol_count: Number(watchlist.symbol_count || 0),
      watchlist_full_symbol_count: Number(watchlist.full_symbol_count || 0),
      candidate_count: candidates.length,
      data_gap_count: rows.filter((row) => row?.status === "OPEN_LIMIT_ORDER_DATA_GAP").length,
      rejected_count: rows.filter((row) => row?.status === "OPEN_LIMIT_ORDER_REJECTED").length,
      futures_score_positive_count: futuresScorePositiveCount,
      industry_futures_combo_score_positive_count: industryFuturesComboScorePositiveCount,
      futures_score_ready_cases: futuresScoreReadyCases,
      stock_future_live_rows: stockFutureRows,
      fallback_strength_cases: fallbackStrengthCases,
    },
    action_guard: {
      creates_order: false,
      creates_formal_candidate: false,
      publish_allowed: false,
      requires_second_confirm_before_action: true,
      preflight_guard_ok: guardOk(preflight.action_guard),
      summary_guard_ok: guardOk(summary.action_guard),
      candidate_guard_ok: guardOk(candidate.action_guard),
      watchlist_guard_ok: guardOk(watchlist.action_guard),
    },
    candidate_symbols: candidates.map((row) => row.symbol),
    candidate_readback: candidates.slice(0, 80).map((row) => ({
      symbol: row.symbol,
      matched_rule_count: row.matched_rule_count,
      candidate_min_matched_rules: row.candidate_min_matched_rules,
      reasons: row.reasons,
      matched_strategy_numbers: row.matched_strategy_numbers || [],
      matched_strategy_numbers_text: row.matched_strategy_numbers_text || "",
      matched_strategy_summary_zh: row.matched_strategy_summary_zh || "",
      matched_strategy_labels: row.matched_strategy_labels || [],
      qualified_label: row.qualified_label || "",
      entry_score: row.entry_score,
      main_force_cost_top10: row.evidence?.main_force_cost_top10 ?? null,
      futopt_positive_basis: row.evidence?.futopt_positive_basis === true,
      trial_match_ready: row.evidence?.trial_match_ready === true,
      opening_report_industry_bias: row.evidence?.opening_report_industry_bias === true,
      opening_report_industries: row.evidence?.opening_report_industries || [],
      us_sector_up_1d: row.evidence?.us_sector_up_1d === true,
      us_sector_up_2d: row.evidence?.us_sector_up_2d === true,
      daily_signal_date: row.evidence?.daily_signal_date || "",
    })),
    failed_checks: failures,
    row_failures: rowFailures,
    first_blocker: failures[0] || rowFailures[0] || null,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.ok ? 0 : 1;
}

main();

