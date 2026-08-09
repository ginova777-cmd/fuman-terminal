"use strict";

const fs = require("fs");
const path = require("path");
const bridge = require("./apply-opening-report-0830-priority-bias-bridge.js");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function selfTest() {
  const valid = { date: "2026-08-06", report_time: "08:30", run_id: "daily-20260806-0830", source: "opening_report_0830", mode: "priority_bias_only", industry: "semiconductors", bias: "strong", confidence: 0.9, evidence_summary: "overseas strength", mapped_symbols: ["2330", "2454"], allowed_action: "boost_scan_priority_only", forbidden_action: "publish_formal_candidate_without_taiwan_evidence" };
  const invalid = { ...valid, mode: "formal_candidate" };
  const pass = bridge.validate(valid, { expectedDate: "20260806" });
  const fail = bridge.validate(invalid, { expectedDate: "20260806" });
  const receipt = bridge.buildReceipt({ inputPath: "fixture", receiptPath: "receipt", payload: valid, validation: pass, acceptedSymbols: ["2330"], rejectedSymbols: [], appliedBoosts: [] });
  const issues = [];
  if (!pass.ok) issues.push("valid_fixture_rejected");
  if (fail.ok || !fail.issues.includes("mode_mismatch")) issues.push("invalid_mode_not_fail_closed");
  if (receipt.formal_candidate_count !== 0 || receipt.formal_candidate_allowed !== false || receipt.forbidden_publish_guard !== true) issues.push("formal_publish_guard_missing");
  return { ok: issues.length === 0, issues };
}

function main() {
  if (process.argv.includes("--self-test")) {
    const result = selfTest();
    console.log(JSON.stringify({ ok: result.ok, contract: "opening-report-0830-priority-bias-bridge-v1-verifier", self_test: result }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const receiptPath = path.resolve(argValue("--receipt", process.env.OPENING_REPORT_0830_BIAS_RECEIPT || "C:\\fuman-runtime\\data\\scan-receipts\\opening-report-0830-priority-bias-bridge-latest.json"));
  const receipt = readJson(receiptPath);
  const issues = [];
  if (!receipt || receipt.contract !== "opening-report-0830-priority-bias-bridge-v1") issues.push("receipt_missing_or_contract_invalid");
  if (receipt && receipt.received !== true) issues.push("received_not_true");
  if (receipt && receipt.forbidden_publish_guard !== true) issues.push("forbidden_publish_guard_not_true");
  if (receipt && receipt.formal_candidate_count !== 0) issues.push("formal_candidate_count_not_zero");
  if (receipt && receipt.formal_candidate_allowed !== false) issues.push("formal_candidate_allowed_not_false");
  if (receipt && receipt.status !== "priority_scan") issues.push("status_invalid");
  if (receipt && receipt.reason_code !== bridge.constants.REASON_CODE) issues.push("reason_code_invalid");
  if (receipt && receipt.source !== bridge.constants.SOURCE) issues.push("source_invalid");
  if (receipt && receipt.mode !== bridge.constants.MODE) issues.push("mode_invalid");
  if (receipt && receipt.validation?.ok === true && (!receipt.accepted_symbols?.length || !receipt.applied_boosts?.length)) issues.push("successful_receipt_missing_boosts");
  const output = { ok: issues.length === 0, contract: "opening-report-0830-priority-bias-bridge-v1-verifier", checked_at: new Date().toISOString(), receipt_path: receiptPath, receipt, issues };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main();
