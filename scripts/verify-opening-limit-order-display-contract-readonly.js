"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT = "opening_limit_order_display_contract_readonly_v1";
const TERMINAL_DIR = process.env.FUMAN_TERMINAL_DIR || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data", "opening-limit-order");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function dashDate(value) {
  const c = compactDate(value);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : "";
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    return "";
  }
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

function has(text, pattern) {
  return pattern.test(text);
}

function main() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate()));
  const compact = compactDate(tradeDate);
  const requireRuntime = arg("require-runtime", "1") !== "0";

  const wrapperPath = path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0850PreflightReadonly.ps1");
  const enginePath = path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0850PreflightReadonly.engine-v2.ps1");
  const runnerPath = path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0855Readonly.ps1");
  const staticPrefilterScriptPath = path.join(TERMINAL_DIR, "scripts", "build-opening-limit-order-static-prefilter.js");
  const summaryPath = arg("summary", path.join(DATA_DIR, `opening-limit-order-0855-summary-${compact}.json`));
  const candidatePath = arg("candidates", path.join(DATA_DIR, `opening-limit-order-0855-candidates-${compact}.json`));
  const preflightPath = arg("preflight", path.join(DATA_DIR, `opening-limit-order-0850-preflight-${compact}.json`));
  const watchlistPath = arg("watchlist", path.join(DATA_DIR, `opening-limit-order-0855-watchlist-${compact}.json`));

  const failures = [];
  const rowFailures = [];

  for (const [label, file] of [["wrapper", wrapperPath], ["engine", enginePath], ["runner", runnerPath], ["static_prefilter_script", staticPrefilterScriptPath]]) {
    if (!exists(file)) failures.push(`${label}_ps1_missing`);
  }

  const wrapper = readText(wrapperPath);
  const engine = readText(enginePath);
  const runner = readText(runnerPath);
  const staticPrefilterScript = readText(staticPrefilterScriptPath);

  if (!has(wrapper, /\[int\]\$Limit\s*=\s*1600/)) failures.push("wrapper_default_limit_not_1600");
  if (!has(engine, /\[int\]\$Limit\s*=\s*1600/)) failures.push("engine_default_limit_not_1600");
  if (!has(runner, /\[int\]\$Limit\s*=\s*1600/)) failures.push("runner_default_limit_not_1600");

  if (!wrapper.includes("ignore user Limit={0}; use full opening watchlist limit=1600")) failures.push("wrapper_limit_160_guard_missing");
  if (!engine.includes("ignore user Limit={0}; use full opening watchlist limit=1600")) failures.push("engine_limit_160_guard_missing");
  if (!runner.includes("ignore user Limit={0}; use full opening watchlist limit=1600")) failures.push("runner_limit_160_guard_missing");

  if (!engine.includes("function ConvertFrom-JsonOutput")) failures.push("engine_json_output_guard_missing");
  if (engine.includes("$sourceWarmup = ConvertFrom-JsonOutput")) failures.push("engine_warmup_stdout_json_parse_still_enabled");
  if (engine.includes("$sourceWarmup = $warmupText | ConvertFrom-Json")) failures.push("engine_warmup_direct_json_parse_still_enabled");
  if (!engine.includes("watchlist_full_symbol_count = $watchlist.full_symbol_count")) failures.push("preflight_full_watchlist_count_missing");

  if (engine.includes("Write-OpeningLimitOrderReadableSummary -StaticPrefilter $staticPrefilter -Limit 40")) failures.push("engine_0850_display_still_limited_40");
  if (has(engine, /Select-Object\s+-First\s+\$Limit/)) failures.push("engine_0850_display_still_uses_limit");
  if (!engine.includes("08:50 開盤入預檢：符合標的 / 符合策略幾")) failures.push("engine_0850_chinese_header_missing");
  if (!engine.includes("已符合策略幾") || !engine.includes("待確認策略幾")) failures.push("engine_0850_chinese_strategy_fields_missing");

  if (runner.includes("Write-OpeningLimitOrderCandidateSummary -Rows $summaryRows -Limit 40")) failures.push("runner_0855_display_still_limited_40");
  if (runner.includes("Select-Object -First 80")) failures.push("runner_summary_still_limited_80");
  if (has(runner, /Select-Object\s+-First\s+\$Limit/)) failures.push("runner_0855_display_still_uses_limit");
  if (!runner.includes("08:55 開盤入觀察候選：符合標的 / 符合策略幾")) failures.push("runner_0855_chinese_header_missing");
  if (!runner.includes("符合策略幾") || !runner.includes("符合策略名稱")) failures.push("runner_0855_chinese_strategy_fields_missing");
  if (!runner.includes("matched_strategy_numbers_text") || !runner.includes("matched_strategy_summary_zh")) failures.push("runner_summary_chinese_fields_missing");
  if (!runner.includes("$rankedCandidateRows")) failures.push("runner_opening_report_rank_sort_missing");
  if (!runner.includes("opening_report_rank_tier_sort")) failures.push("runner_opening_report_rank_tier_missing");
  if (!runner.includes("日報強勢優先觀察")) failures.push("runner_opening_report_strong_sector_label_missing");

  if (!staticPrefilterScript.includes("opening_report_priority_observation")) failures.push("opening_report_priority_observation_not_emitted");
  if (!staticPrefilterScript.includes("strong_sector_return_1d")) failures.push("opening_report_strong_sector_not_emitted");
  if (!staticPrefilterScript.includes("us_sector_trend")) failures.push("opening_report_us_sector_trend_not_emitted");
  if (!staticPrefilterScript.includes("sector_return_1d_pct")) failures.push("opening_report_sector_return_not_emitted");
  if (!staticPrefilterScript.includes("else if (!reportPresent) pendingRules.push")) failures.push("us_sector_pending_not_limited_to_missing_report");

  let summary = {};
  let candidate = {};
  let preflight = {};
  let watchlist = {};

  if (requireRuntime) {
    for (const [label, file] of [["preflight", preflightPath], ["summary", summaryPath], ["candidates", candidatePath], ["watchlist", watchlistPath]]) {
      if (!exists(file)) failures.push(`${label}_file_missing`);
    }

    summary = readJson(summaryPath);
    candidate = readJson(candidatePath);
    preflight = readJson(preflightPath);
    watchlist = readJson(watchlistPath);

    if (summary.__read_error) failures.push(`summary_unreadable:${summary.__read_error}`);
    if (candidate.__read_error) failures.push(`candidates_unreadable:${candidate.__read_error}`);
    if (preflight.__read_error) failures.push(`preflight_unreadable:${preflight.__read_error}`);
    if (watchlist.__read_error) failures.push(`watchlist_unreadable:${watchlist.__read_error}`);

    if (dashDate(summary.trade_date) !== tradeDate) failures.push("summary_trade_date_mismatch");
    if (dashDate(candidate.trade_date) !== tradeDate) failures.push("candidate_trade_date_mismatch");
    if (dashDate(preflight.trade_date) !== tradeDate) failures.push("preflight_trade_date_mismatch");
    if (dashDate(watchlist.trade_date) !== tradeDate) failures.push("watchlist_trade_date_mismatch");

    if (summary.ok !== true) failures.push("summary_ok_not_true");
    if (summary.first_blocker) failures.push(`summary_first_blocker:${summary.first_blocker}`);
    if (!guardOk(summary.action_guard)) failures.push("summary_action_guard_failed");
    if (summary.formal_candidate_count !== 0 || summary.formal_candidate_allowed !== false || summary.publish_allowed !== false) {
      failures.push("summary_formal_or_publish_guard_failed");
    }
    if (!guardOk(candidate.action_guard)) failures.push("candidate_action_guard_failed");
    if (!guardOk(preflight.action_guard)) failures.push("preflight_action_guard_failed");
    if (!guardOk(watchlist.action_guard)) failures.push("watchlist_action_guard_failed");

    const summaryRows = array(summary.candidates);
    const candidateRows = array(candidate.rows).filter((row) => row?.status === "OPEN_LIMIT_ORDER_CANDIDATE");
    if (Number(summary.candidate_count) !== summaryRows.length) failures.push("summary_candidate_count_mismatch_candidates_array");
    if (candidateRows.length !== summaryRows.length) failures.push("summary_does_not_include_all_candidate_rows");
    if (Number(summary.watchlist_symbol_count) !== Number(summary.watchlist_full_symbol_count)) failures.push("summary_watchlist_not_full");
    if (Number(preflight.watchlist_symbol_count) !== Number(preflight.watchlist_full_symbol_count)) failures.push("preflight_watchlist_not_full");
    if (!preflight.static_prefilter || Number(preflight.static_prefilter.opening_report_files_accepted || 0) <= 0) failures.push("preflight_static_opening_report_missing");
    if (Number(preflight.static_prefilter?.opening_report_mapped_symbol_count || 0) <= 0) failures.push("preflight_opening_report_mapped_symbols_missing");
    if (Number(watchlist.symbol_count) !== Number(watchlist.full_symbol_count)) failures.push("watchlist_not_full");

    const rowsWithOpeningReportEvidence = summaryRows.filter((row) => row?.opening_report_priority_observation === true || array(row?.opening_report_industries).length > 0);
    if (rowsWithOpeningReportEvidence.length > 0) {
      const missingTier = rowsWithOpeningReportEvidence.filter((row) => !row?.opening_report_rank_tier || !Number.isFinite(Number(row?.opening_report_rank_tier_sort)));
      const missingBoost = rowsWithOpeningReportEvidence.filter((row) => !Number.isFinite(Number(row?.opening_report_rank_boost)));
      if (missingTier.length) failures.push("summary_opening_report_rows_missing_rank_tier");
      if (missingBoost.length) failures.push("summary_opening_report_rows_missing_rank_boost");
    }

    let previousFinalScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < summaryRows.length; index += 1) {
      const row = summaryRows[index];
      const symbol = String(row?.symbol || "");
      const tier = Number(row?.opening_report_rank_tier_sort);
      const boost = Number(row?.opening_report_rank_boost);
      const finalScore = Number(row?.final_score ?? row?.entry_score);
      if (Number(row?.rank) !== index + 1) rowFailures.push(`${symbol}:rank_not_sequential`);
      if (!Number.isFinite(finalScore)) rowFailures.push(`${symbol}:final_score_missing`);
      if (Number.isFinite(finalScore) && finalScore > previousFinalScore + 0.000001) rowFailures.push(`${symbol}:final_score_order_invalid`);
      if (!Number.isFinite(tier) || tier < 0 || tier > 3) rowFailures.push(`${symbol}:opening_report_rank_tier_invalid`);
      if (!Number.isFinite(boost) || boost < 0) rowFailures.push(`${symbol}:opening_report_rank_boost_invalid`);
      if (Number.isFinite(finalScore)) previousFinalScore = finalScore;
    }
    for (const row of summaryRows) {
      const symbol = String(row?.symbol || "");
      if (!symbol) rowFailures.push("symbol_missing");
      if (!row?.qualified_label) rowFailures.push(`${symbol}:qualified_label_missing`);
      if (!row?.matched_strategy_numbers_text) rowFailures.push(`${symbol}:matched_strategy_numbers_text_missing`);
      if (!row?.matched_strategy_summary_zh) rowFailures.push(`${symbol}:matched_strategy_summary_zh_missing`);
      if (!array(row?.matched_strategy_numbers).length) rowFailures.push(`${symbol}:matched_strategy_numbers_missing`);
      if (!array(row?.matched_strategy_labels).length) rowFailures.push(`${symbol}:matched_strategy_labels_missing`);
      if (!row?.opening_report_rank_tier) rowFailures.push(`${symbol}:opening_report_rank_tier_missing`);
      if (!Number.isFinite(Number(row?.opening_report_rank_tier_sort))) rowFailures.push(`${symbol}:opening_report_rank_tier_sort_missing`);
      if (!Number.isFinite(Number(row?.opening_report_rank_boost))) rowFailures.push(`${symbol}:opening_report_rank_boost_missing`);
    }
  }

  if (rowFailures.length) failures.push("candidate_display_row_failures");

  const result = {
    ok: failures.length === 0,
    contract: CONTRACT,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    ps1_contract: {
      default_limit: 1600,
      user_limit_below_1600_ignored: !failures.some((f) => f.includes("limit_160_guard_missing")),
      display_not_truncated: !failures.some((f) => f.includes("limited") || f.includes("uses_limit")),
      warmup_stdout_json_parse_disabled: !failures.some((f) => f.includes("warmup") && f.includes("parse")),
      final_score_ranked_first: !failures.some((f) => f.includes("final_score_order_invalid")),
    },
    runtime_readback: requireRuntime ? {
      preflight_path: preflightPath,
      watchlist_path: watchlistPath,
      candidate_path: candidatePath,
      summary_path: summaryPath,
      preflight_ok: preflight.ok === true,
      summary_ok: summary.ok === true,
      watchlist_symbol_count: summary.watchlist_symbol_count ?? null,
      watchlist_full_symbol_count: summary.watchlist_full_symbol_count ?? null,
      candidate_count: summary.candidate_count ?? null,
      summary_candidates_count: array(summary.candidates).length,
      formal_candidate_count: summary.formal_candidate_count ?? null,
      formal_candidate_allowed: summary.formal_candidate_allowed ?? null,
      preflight_opening_report_files_accepted: preflight.static_prefilter?.opening_report_files_accepted ?? null,
      preflight_opening_report_mapped_symbol_count: preflight.static_prefilter?.opening_report_mapped_symbol_count ?? null,
      opening_report_rows_with_evidence: array(summary.candidates).filter((row) => row?.opening_report_priority_observation === true || array(row?.opening_report_industries).length > 0).length,
      opening_report_strong_sector_candidate_count: array(summary.candidates).filter((row) => row?.opening_report_strong_sector_return_1d === true).length,
      final_score_ranked_first: !rowFailures.some((failure) => failure.includes("final_score_order_invalid")),
      publish_allowed: summary.publish_allowed ?? null,
    } : null,
    row_failures: rowFailures.slice(0, 80),
    failed_checks: failures,
    first_blocker: failures[0] || null,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();



