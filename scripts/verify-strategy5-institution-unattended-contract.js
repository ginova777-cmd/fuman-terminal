"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const expect = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const flow = read("flow-health.ps1");
const sync = read("run-chip-source-sync.ps1");
const health = read("scripts/verify-chip-source-health.js");
const strategy5 = read("run-strategy5.ps1");
const institution = read("run-institution.ps1");
const s5Watchdog = read("run-strategy5-watchdog.ps1");
const institutionWatchdog = read("run-flow-watchdog.ps1");
const helper = read("scripts/read-protected-production-api.js");
expect("retired_warrant_scope_removed", !flow.includes('ValidateSet("institution", "warrant"'));
expect("retired_warrant_payload_pruned", flow.includes('$payload.Remove("warrant")'));
expect("current_day_age_supported", health.includes("Math.max(0"));
expect("sync_requires_zero_age", sync.includes('CHIP_SOURCE_HEALTH_MAX_AGE_DAYS = "0"'));
expect("sync_verifies_current_receipt", sync.includes('verify:chip-source-sync-receipt'));
expect("strategy5_has_2005_gate", strategy5.includes("verify-chip-source-sync-receipt.js"));
expect("institution_has_2005_gate", institution.includes("verify-chip-source-sync-receipt.js"));
expect("strategy5_watchdog_authenticated", s5Watchdog.includes("read-protected-production-api.js"));
expect("institution_watchdog_authenticated", institutionWatchdog.includes("read-protected-production-api.js"));
expect("watchdogs_no_direct_webrequest", !s5Watchdog.includes("Invoke-WebRequest -Uri $url") && !institutionWatchdog.includes("Invoke-WebRequest -Uri $url"));
expect("helper_requires_api_endpoint", helper.includes('startsWith("/api/")'));
expect("helper_uses_protected_headers", helper.includes("protectedReadbackHeaders"));
expect("helper_never_prints_token", !helper.includes("credential.token,"));
const failures = checks.filter((row) => !row.ok);
const result = {
  ok: failures.length === 0,
  contract: "fuman-strategy5-institution-unattended-v1",
  checkedAt: new Date().toISOString(), checks,
  failures: failures.map((row) => row.name), readOnly: true,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
