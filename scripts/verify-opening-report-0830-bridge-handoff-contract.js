"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const runner = read("scripts/run-opening-report-0830-production.js");
const wrapper = read("run-opening-report-0830-production-wrapper.ps1");
const bridge = read("scripts/apply-opening-report-0830-priority-bias-bridge.js");
const checks = {
  production_bridge_default_on: runner.includes('const applyBridge = !mock && !hasFlag("--skip-bridge")'),
  production_bridge_not_flag_dependent: !runner.includes('const applyBridge = hasFlag("--apply-bridge")'),
  same_day_state_written_before_bridge: runner.includes("writeJson(inputPath, item)") && runner.includes("runBridge(inputPath, receiptPath, tradeDate)"),
  per_industry_receipt_required: runner.includes("opening-report-0830-priority-bias-bridge-${item.industry}-${compact}.json"),
  wrapper_requires_bridge_success: wrapper.includes("mother_pool_bridge_attempted") && wrapper.includes("mother_pool_bridge_ok") && wrapper.includes("mother_pool_bridge_not_complete"),
  formal_publish_guard_present: bridge.includes("forbidden_publish_guard: true") && bridge.includes("formal_candidate_count: 0") && bridge.includes("formal_candidate_allowed: false"),
};
const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = { ok: failedChecks.length === 0, contract: "opening_report_0830_mother_pool_bridge_handoff_v1", checked_at: new Date().toISOString(), checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, read_only: true };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;