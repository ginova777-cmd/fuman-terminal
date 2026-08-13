"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = tradeDate.replace(/\D/g, "");
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  const receipt = readJson(finalPath);
  const issues = [];
  if (!receipt) issues.push("final_receipt_missing");
  if (receipt && receipt.contract !== "opening-report-0830-production-v1") issues.push("contract_invalid");
  if (receipt && !receipt.run_id) issues.push("run_id_missing");
  if (receipt && receipt.date?.replace(/\D/g, "") !== compact) issues.push("date_mismatch");
  if (receipt && receipt.overseas_sources_ok !== true) issues.push("overseas_sources_not_ok");
  if (receipt && receipt.industry_bias_exported !== true) issues.push("industry_bias_not_exported");
  if (receipt && receipt.formal_candidates !== 0) issues.push("formal_candidates_not_zero_for_0830");
  if (receipt && receipt.watchlist_only !== true) issues.push("watchlist_only_not_true");
  if (receipt && receipt.report_path && !fs.existsSync(receipt.report_path)) issues.push("report_path_missing");
  const lineReceipt = receipt?.line_push_receipt ? readJson(receipt.line_push_receipt) : null;
  if (receipt?.line_push_attempted && lineReceipt?.line_push_ok !== true) issues.push("line_push_attempted_but_not_ok");
  if (lineReceipt && lineReceipt.token_logged !== false) issues.push("line_token_logging_guard_failed");
  if (receipt?.line_push_attempted && Number(lineReceipt?.target_count || 0) < 2) issues.push("line_target_count_less_than_2");
  if (receipt?.line_push_attempted && lineReceipt?.has_user_target !== true) issues.push("line_user_target_missing");
  if (receipt?.line_push_attempted && lineReceipt?.has_group_target !== true) issues.push("line_group_target_missing");
  if (lineReceipt && lineReceipt.target_logged !== false) issues.push("line_target_logging_guard_failed");
  if (receipt && receipt.terminal_briefing_snapshot?.ok !== true) issues.push("terminal_briefing_snapshot_not_synced");
  const bridgeRows = Array.isArray(receipt?.bridge_results) ? receipt.bridge_results : [];
  for (const row of bridgeRows) {
    const input = readJson(row.inputPath);
    if (!input) issues.push(`bridge_input_missing:${row.industry}`);
    if (input && input.source !== "opening_report_0830") issues.push(`bridge_source_invalid:${row.industry}`);
    if (input && input.mode !== "priority_bias_only") issues.push(`bridge_mode_invalid:${row.industry}`);
    if (input && input.allowed_action !== "boost_scan_priority_only") issues.push(`bridge_allowed_action_invalid:${row.industry}`);
    if (input && input.forbidden_action !== "publish_formal_candidate_without_taiwan_evidence") issues.push(`bridge_forbidden_action_invalid:${row.industry}`);
    if (input && !(Number(input.confidence) >= 0 && Number(input.confidence) <= 1)) issues.push(`bridge_confidence_invalid:${row.industry}`);
  }
  const output = {
    ok: issues.length === 0,
    contract: "opening-report-0830-production-v1-verifier",
    checked_at: new Date().toISOString(),
    final_receipt: finalPath,
    receipt,
    issues
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main();
