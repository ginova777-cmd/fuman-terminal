"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME, "data", "opening-limit-order");
const CONTRACT = "opening_limit_order_0830_report_ranking_readonly_v1";
const SCORE_POLICY = "priority_observation_plus_hot_sector_rank_boost_only_no_candidate_by_report";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dashDate(value) {
  const c = compact(value);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : "";
}
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { return { __error: error?.message || String(error) }; }
}
function arr(value) { return Array.isArray(value) ? value : []; }
function num(value, fallback = NaN) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function sameDateRunId(runId, tradeDate) { return String(runId || "").includes(compact(tradeDate)); }

const tradeDate = dashDate(arg("trade-date", taipeiDate()));
const suffix = compact(tradeDate);
const candidatePath = arg("candidates", path.join(DATA_DIR, `opening-limit-order-0855-candidates-${suffix}.json`));
const candidate = readJson(candidatePath);
const failed = [];
const rowFailures = [];

if (!tradeDate) failed.push("trade_date_invalid");
if (candidate.__error) failed.push(`candidate_file_unreadable:${candidate.__error}`);
if (!candidate.__error && dashDate(candidate.trade_date) !== tradeDate) failed.push("candidate_trade_date_mismatch");

const guard = candidate.action_guard || {};
if (guard.creates_order !== false) failed.push("action_guard_creates_order_not_false");
if (guard.creates_formal_candidate !== false) failed.push("action_guard_creates_formal_candidate_not_false");
if (guard.publish_allowed !== false) failed.push("action_guard_publish_allowed_not_false");
if (guard.requires_second_confirm_before_action !== true) failed.push("second_confirm_guard_missing");

const report = candidate.opening_report_readback || {};
if (num(report.overseas_strength_files_accepted, 0) < 19) failed.push("opening_report_files_below_19");
if (num(report.mapped_symbol_count, 0) <= 0) failed.push("opening_report_mapped_symbols_missing");
if (num(report.priority_observation_symbol_count, 0) <= 0) failed.push("opening_report_priority_observation_missing");
if (num(report.strong_sector_symbol_count, 0) <= 0) failed.push("opening_report_strong_sector_missing");
for (const runId of arr(report.run_ids)) if (!sameDateRunId(runId, tradeDate)) rowFailures.push(`opening_report_run_id_date_mismatch:${runId}`);

let candidateCount = 0;
let boostedCandidateCount = 0;
let reportOnlyCandidateCount = 0;
let missingBoostCount = 0;
let scoreMismatchCount = 0;
let staleReportEvidenceCount = 0;
for (const row of arr(candidate.rows)) {
  const symbol = String(row.symbol || "unknown");
  const evidence = row.evidence || {};
  const isCandidate = row.status === "OPEN_LIMIT_ORDER_CANDIDATE";
  const reasons = arr(row.reasons);
  if (!isCandidate) continue;
  candidateCount += 1;
  if (!reasons.length) rowFailures.push(`${symbol}:candidate_without_local_strategy_reason`);
  if (reasons.length === 1 && reasons[0] === "opening_report_0830_industry_bias") {
    reportOnlyCandidateCount += 1;
    rowFailures.push(`${symbol}:opening_report_only_candidate_forbidden`);
  }
  const reportObserved = evidence.opening_report_priority_observation === true;
  const boost = num(evidence.opening_report_rank_boost, num(row.opening_report_rank_boost, 0));
  const base = num(row.entry_score_base, NaN);
  const score = num(row.entry_score, NaN);
  if (reportObserved) {
    boostedCandidateCount += 1;
    if (!(boost > 0)) { missingBoostCount += 1; rowFailures.push(`${symbol}:opening_report_rank_boost_missing`); }
    if (evidence.opening_report_score_policy !== SCORE_POLICY) rowFailures.push(`${symbol}:opening_report_score_policy_mismatch`);
    if (!arr(evidence.opening_report_run_ids).length) rowFailures.push(`${symbol}:opening_report_run_id_missing`);
    for (const runId of arr(evidence.opening_report_run_ids)) if (!sameDateRunId(runId, tradeDate)) {
      staleReportEvidenceCount += 1;
      rowFailures.push(`${symbol}:opening_report_run_id_date_mismatch:${runId}`);
    }
    if (arr(evidence.opening_report_industries).length === 0) rowFailures.push(`${symbol}:opening_report_industries_missing`);
    if (arr(evidence.opening_report_priority_ranks).length === 0) rowFailures.push(`${symbol}:opening_report_priority_ranks_missing`);
    if (Number.isFinite(base) && Number.isFinite(score)) {
      const expected = Math.min(100, base + boost);
      if (score !== expected) { scoreMismatchCount += 1; rowFailures.push(`${symbol}:entry_score_not_base_plus_report_boost:${base}+${boost}!=${score}`); }
    }
  } else if (boost > 0) {
    rowFailures.push(`${symbol}:boost_without_opening_report_priority_observation`);
  }
}

if (candidateCount <= 0) failed.push("candidate_rows_missing");
if (boostedCandidateCount <= 0) failed.push("no_candidate_received_opening_report_rank_boost");

const output = {
  ok: failed.length === 0 && rowFailures.length === 0,
  contract: CONTRACT,
  trade_date: tradeDate,
  checked_at: new Date().toISOString(),
  candidate_path: candidatePath,
  opening_report_readback: {
    files_accepted: num(report.overseas_strength_files_accepted, 0),
    mapped_symbol_count: num(report.mapped_symbol_count, 0),
    priority_observation_symbol_count: num(report.priority_observation_symbol_count, 0),
    strong_sector_symbol_count: num(report.strong_sector_symbol_count, 0),
    run_id_count: arr(report.run_ids).length,
  },
  candidate_count: candidateCount,
  boosted_candidate_count: boostedCandidateCount,
  report_only_candidate_count: reportOnlyCandidateCount,
  missing_boost_count: missingBoostCount,
  score_mismatch_count: scoreMismatchCount,
  stale_report_evidence_count: staleReportEvidenceCount,
  score_policy: SCORE_POLICY,
  action_guard: guard,
  failed_checks: failed,
  row_failures: rowFailures,
  first_blocker: failed[0] || rowFailures[0] || null,
};

console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;
