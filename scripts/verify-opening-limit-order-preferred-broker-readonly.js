"use strict";
const fs = require("fs");
const path = require("path");
const CONTRACT = "opening_limit_order_preferred_broker_rank_readonly_v2";
const TERMINAL_DIR = process.env.FUMAN_TERMINAL_DIR || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data", "opening-limit-order");
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback; }
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dashDate(value) { const compact = compactDate(value); return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : ""; }
function taipeiDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return { __read_error: error?.message || String(error) }; } }
function array(value) { return Array.isArray(value) ? value : []; }
function main() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate())); const compact = compactDate(tradeDate); const requireRuntime = arg("require-runtime", "1") !== "0";
  const runnerPath = path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0855Readonly.ps1");
  const staticPath = path.join(TERMINAL_DIR, "scripts", "build-opening-limit-order-static-prefilter.js");
  const candidateScriptPath = path.join(TERMINAL_DIR, "scripts", "verify-opening-limit-order-candidate-readonly.js");
  const summaryPath = arg("summary", path.join(DATA_DIR, `opening-limit-order-0855-summary-${compact}.json`));
  const failures = []; const rowFailures = [];
  const runner = readText(runnerPath); const staticPrefilter = readText(staticPath); const candidateScript = readText(candidateScriptPath);
  if (!runner.includes("preferred_broker_top_net_buy")) failures.push("runner_preferred_broker_fields_missing");
  if (!runner.includes("主力第一買超")) failures.push("runner_preferred_broker_console_display_missing");
  if (!runner.includes("$_.evidence.preferred_broker_top_net_buy")) failures.push("runner_preferred_broker_rank_sort_missing");
  if (!staticPrefilter.includes("preferredTopNetBuyBroker")) failures.push("static_prefilter_preferred_broker_evidence_missing");
  if (!candidateScript.includes("preferredTopNetBuyBrokerEvidence")) failures.push("candidate_preferred_broker_evidence_missing");
  if (!candidateScript.includes("preferred_broker_top_net_buy_detail")) failures.push("candidate_preferred_broker_detail_missing");
  if (!candidateScript.includes("const ok = preopenPriceEligible && reasons.length >= 1")) failures.push("preferred_broker_must_not_create_candidate_guard_missing");
  let summary = {}; let rows = [];
  if (requireRuntime) {
    summary = readJson(summaryPath);
    if (summary.__read_error) failures.push(`summary_unreadable:${summary.__read_error}`);
    if (dashDate(summary.trade_date) !== tradeDate) failures.push("summary_trade_date_mismatch");
    if (summary.action_guard?.creates_order !== false || summary.action_guard?.creates_formal_candidate !== false || summary.action_guard?.publish_allowed !== false) failures.push("summary_action_guard_failed");
    if (summary.formal_candidate_count !== 0 || summary.formal_candidate_allowed !== false || summary.publish_allowed !== false) failures.push("summary_formal_or_publish_guard_failed");
    rows = array(summary.candidates);
    let previousFinalScore = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const symbol = String(row?.symbol || "unknown");
      const finalScore = Number(row?.final_score ?? row?.entry_score);
      if (typeof row?.preferred_broker_top_net_buy !== "boolean") rowFailures.push(`${symbol}:preferred_broker_top_net_buy_missing`);
      if (!Number.isFinite(finalScore)) rowFailures.push(`${symbol}:final_score_missing`);
      if (Number.isFinite(finalScore) && finalScore > previousFinalScore + 0.000001) rowFailures.push(`${symbol}:final_score_order_invalid`);
      previousFinalScore = Number.isFinite(finalScore) ? finalScore : previousFinalScore;
      if (row?.preferred_broker_top_net_buy === true) {
        if (!String(row?.preferred_broker_top_net_buy_name || "").trim()) rowFailures.push(`${symbol}:preferred_broker_name_missing`);
        if (Number(row?.preferred_broker_top_net_buy_rank) !== 1) rowFailures.push(`${symbol}:preferred_broker_rank_not_one`);
        if (!(Number(row?.preferred_broker_top_net_buy_net_buy) > 0)) rowFailures.push(`${symbol}:preferred_broker_net_buy_not_positive`);
        if (String(row?.preferred_broker_top_net_buy_reason || "") !== "preferred_broker_top_net_buy") rowFailures.push(`${symbol}:preferred_broker_reason_invalid`);
      }
    }
  }
  const matched = rows.filter((row) => row?.preferred_broker_top_net_buy === true);
  const output = { ok: failures.length === 0 && rowFailures.length === 0, contract: CONTRACT, trade_date: tradeDate, checked_at: new Date().toISOString(), policy: "latest_formal_branch_report_top_net_buy_only; score_context_only; never_creates_opening_candidate", static_contract: { console_display: !failures.includes("runner_preferred_broker_console_display_missing"), score_context_only: !failures.includes("runner_preferred_broker_rank_sort_missing"), never_creates_opening_candidate: !failures.includes("preferred_broker_must_not_create_candidate_guard_missing") }, runtime_readback: requireRuntime ? { summary_path: summaryPath, candidate_count: rows.length, preferred_broker_top_net_buy_candidate_count: matched.length, preferred_broker_symbols: matched.map((row) => ({ symbol: row.symbol, broker_name: row.preferred_broker_top_net_buy_name, net_buy: row.preferred_broker_top_net_buy_net_buy, cost_price: row.preferred_broker_top_net_buy_cost_price, signal_date: row.preferred_broker_top_net_buy_signal_date })), final_score_ranked_first: !rowFailures.some((failure) => failure.includes("final_score_order_invalid")), action_guard: summary.action_guard || null } : null, row_failures: rowFailures, failed_checks: failures, first_blocker: failures[0] || rowFailures[0] || null };
  console.log(JSON.stringify(output, null, 2)); process.exitCode = output.ok ? 0 : 1;
}
main();
