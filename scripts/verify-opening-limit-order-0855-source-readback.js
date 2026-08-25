"use strict";

const fs = require("fs");
const path = require("path");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME, "data", "opening-limit-order");
function sectorUp1d(e) { const biases = Array.isArray(e.opening_report_biases) ? e.opening_report_biases : []; return e.opening_report_strong_sector_return_1d === true || biases.includes("positive_detected"); }
function sectorUp2d(e) { return e.opening_report_sector_up_2d === true || e.overseas_sector_up_2d === true || e.us_sector_up_2d === true; }
const RULES = {
  limit_down_reopened_main_force_cost_high: (e) => e.limit_down_reopened === true && e.main_force_cost_high === true,
  low_rebound_two_day_up_institution_buy: (e) => e.rebound_from_low === true && e.two_day_up === true && e.institution_same_buy_2d === true,
  ma60_support_us_sector_strong: (e) => e.ma60_support_retest === true && sectorUp1d(e),
  ma240_breakout_us_sector_strong: (e) => e.ma240_breakout === true && sectorUp1d(e),
  futopt_near_prev_close_trial_limit_down_us_sector: (e) => e.trial_match_ready === true && e.futopt_near_prev_close_and_up === true && e.trial_match_limit_down === true && sectorUp1d(e),
  futopt_basis_or_inverse_convergence: (e) => e.futopt_positive_basis === true || e.futopt_negative_basis === true || e.futopt_inverse_convergence === true,
  two_day_us_sector_strong_mapped_tw: (e) => sectorUp2d(e),
  prev_low_above_prior_open_overnight_trader_branches: (e) => e.overnight_trader_style?.available === true && e.overnight_trader_style?.matched === true,
  us_sector_key_level_hold_two_days: (e) => sectorUp1d(e) && (Number.isFinite(Number(e.main_force_cost_top10)) || Number.isFinite(Number(e.ma60))),
  previous_limit_up_futopt_positive_basis: (e) => e.previous_limit_up === true && e.futopt_positive_basis === true,
};
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback; }
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function date(value) { const c = compact(value); return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : ""; }
function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return { __error: error?.message || String(error) }; } }
function array(value) { return Array.isArray(value) ? value : []; }
function slotKey(slots) { return array(slots).map((slot) => typeof slot === "string" ? slot : String(slot.capture_slot || "")).filter(Boolean).sort().join(","); }
function validPreopenBasisEvidence(e) {
  const slots = array(e.preopen_slots);
  if (slotKey(e.preopen_required_slots) !== "0845,0850") return false;
  if (slotKey(slots) !== "0845,0850") return false;
  for (const slot of slots) {
    const hasTrial = slot.has_trial_price === true || slot.trial_price !== null && slot.trial_price !== undefined;
    const hasFut = slot.has_fut_price === true || slot.fut_price !== null && slot.fut_price !== undefined;
    if (["POSITIVE", "FLAT"].includes(String(slot.basis_direction || "")) && (!hasTrial || !hasFut)) return false;
    if (["正價差", "平價差"].includes(String(slot.basis_status || "")) && (!hasTrial || !hasFut)) return false;
  }
  return true;
}
const tradeDate = date(arg("trade-date", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())));
const suffix = compact(tradeDate);
const candidatesPath = arg("candidates", path.join(DATA_DIR, `opening-limit-order-0855-candidates-${suffix}.json`));
const cachePath = arg("source-cache", path.join(DATA_DIR, `opening-limit-order-0850-static-sources-${suffix}.json`));
const candidate = read(candidatesPath); const cache = read(cachePath); const failures = []; const rowFailures = [];
if (candidate.__error) failures.push(`candidate_file_unreadable:${candidate.__error}`);
if (cache.__error) failures.push(`source_cache_unreadable:${cache.__error}`);
if (date(candidate.trade_date) !== tradeDate) failures.push("candidate_trade_date_mismatch");
if (cache.contract !== "opening_limit_order_0850_static_sources_v1") failures.push("source_cache_contract_mismatch");
if (date(cache.trade_date) !== tradeDate) failures.push("source_cache_trade_date_mismatch");
for (const row of Array.isArray(candidate.rows) ? candidate.rows : []) {
  const symbol = row.symbol || "unknown"; const evidence = row.evidence || {};
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE") {
    if (!Array.isArray(row.reasons) || !row.reasons.length) rowFailures.push(`${symbol}:candidate_without_reason`);
    for (const reason of row.reasons || []) {
      if (!RULES[reason]) rowFailures.push(`${symbol}:unknown_rule:${reason}`);
      else if (!RULES[reason](evidence)) rowFailures.push(`${symbol}:evidence_not_satisfied:${reason}`);
    }
  }
  if (row.status === "OPEN_LIMIT_ORDER_DATA_GAP" && (!Array.isArray(row.data_gaps) || !row.data_gaps.length)) rowFailures.push(`${symbol}:data_gap_without_reason`);
  if ((row.reasons || []).some((reason) => /futopt|basis|inverse/.test(String(reason))) && !validPreopenBasisEvidence(evidence)) rowFailures.push(`${symbol}:preopen_futopt_trial_basis_contract_failed`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && evidence.opening_report_priority_observation === true && sectorUp1d(evidence) && Number(evidence.opening_report_rank_boost || 0) <= 0) rowFailures.push(`${symbol}:positive_opening_report_rank_boost_missing`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && evidence.opening_report_rank_boost > 0 && !sectorUp1d(evidence)) rowFailures.push(`${symbol}:opening_report_boost_without_positive_sector`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && evidence.opening_report_rank_boost > 0 && evidence.opening_report_score_policy !== "strategy_first_then_positive_overseas_return_rank_tier_futures_weighted_ranking_no_formal_by_report") rowFailures.push(`${symbol}:opening_report_score_policy_missing`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && (!Array.isArray(row.reasons) || !row.reasons.length)) rowFailures.push(`${symbol}:candidate_without_strategy_gate`);
  const components = evidence.score_components || {};
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && evidence.score_weight_contract?.formal_candidate_by_report_allowed !== false) rowFailures.push(`${symbol}:score_weight_contract_missing`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && Number(components.opening_report_score || 0) > 55) rowFailures.push(`${symbol}:opening_report_score_cap_exceeded`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && Number(components.opening_report_score || 0) > 0 && !sectorUp1d(evidence)) rowFailures.push(`${symbol}:opening_report_component_without_positive_sector`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && Number(components.futures_score || 0) > 30) rowFailures.push(`${symbol}:futures_score_cap_exceeded`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && Number(components.industry_futures_combo_score || 0) > 20) rowFailures.push(`${symbol}:industry_futures_combo_score_cap_exceeded`);
  if (row.status === "OPEN_LIMIT_ORDER_CANDIDATE" && !evidence.daily_signal_date) rowFailures.push(`${symbol}:daily_signal_date_missing`);
}
const output = { ok: failures.length === 0 && rowFailures.length === 0, contract: "opening_limit_order_0855_source_readback_v1", trade_date: tradeDate, checked_at: new Date().toISOString(), candidates_path: candidatesPath, source_cache_path: cachePath, static_source_ready: Number(cache?.source_counts?.ready || 0), static_source_failed: Number(cache?.source_counts?.failed || 0), candidate_count: (candidate.rows || []).filter((row) => row.status === "OPEN_LIMIT_ORDER_CANDIDATE").length, data_gap_count: (candidate.rows || []).filter((row) => row.status === "OPEN_LIMIT_ORDER_DATA_GAP").length, action_guard: candidate.action_guard || null, failed_checks: failures, row_failures: rowFailures, first_blocker: failures[0] || rowFailures[0] || null };
console.log(JSON.stringify(output, null, 2)); process.exitCode = output.ok ? 0 : 1;












