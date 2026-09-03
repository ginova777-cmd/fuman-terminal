"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts", "run-daytrade-near-one-source.js"), "utf8");

const checks = {
  lock_contention_is_retryable_error: /status:\s*"already_running"[\s\S]*?process\.exitCode\s*=\s*75/.test(source),
  zero_trial_price_is_missing: /rawTrial[\s\S]*?rawTrial\s*>\s*0\s*\?\s*rawTrial\s*:\s*null/.test(source),
  formal_candidate_not_written: source.includes("It never opens a WebSocket") && !source.includes("formal_candidates"),
};

const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failed_checks.length === 0,
  contract: "daytrade_futopt_lock_retry_contract_v1",
  checked_at: new Date().toISOString(),
  checks,
  failed_checks,
  first_blocker: failed_checks[0] || null,
  read_only: true,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
