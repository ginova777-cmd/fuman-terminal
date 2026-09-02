"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const runner = read("scripts/run-opening-report-0830-production.js");
const wrapper = read("run-opening-report-0830-production-wrapper.ps1");
const bridge = read("scripts/apply-opening-report-mother-pool-bridge.js");
const checks = {
  production_bridge_default_on: runner.includes('const applyBridge = !mock && !hasFlag("--skip-bridge")'),
  production_bridge_not_flag_dependent: !runner.includes('const applyBridge = hasFlag("--apply-bridge")'),
  all_state_written_before_top3_bridge: runner.indexOf("writeJson(inputPath, item)") < runner.indexOf("const motherPoolTop3Bridge = applyBridge"),
  legacy_per_industry_bridge_not_executed: !runner.includes("runBridge(inputPath, receiptPath, tradeDate)"),
  aggregate_receipt_required: runner.includes("opening-report-0830-mother-pool-bridge-${compact}.json"),
  wrapper_bridge_is_optional: wrapper.includes("mother_pool_bridge_required = $false") && !wrapper.includes("-and $bridgeOk)"),
  bridge_failure_does_not_change_report_success: runner.includes("ok: overseasPreflight.ok && Boolean(reportPath) && (!sendLine || lineReceipt.line_push_ok)"),
  formal_publish_guard_present: bridge.includes("forbidden_publish_guard: true") && bridge.includes("formal_candidate_count: 0") && bridge.includes("formal_candidate_allowed: false") && bridge.includes("publish_allowed: false"),
};
const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = { ok: failedChecks.length === 0, contract: "opening_report_0830_mother_pool_bridge_handoff_v2", checked_at: new Date().toISOString(), checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, read_only: true };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;