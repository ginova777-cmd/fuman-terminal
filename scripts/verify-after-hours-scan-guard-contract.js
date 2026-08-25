"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(process.argv[2] || ".");
const issues = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const guard = read("schedule-guard.ps1");
if (!/\[switch\]\$AllowAfterFormalSourceWindow/.test(guard)) issues.push("guard_switch_missing");
if (!/marketStatus\s*-eq\s*["']after_formal_source_window["']/.test(guard)) issues.push("after_window_status_missing");
if (!/marketOpen\s*-eq\s*\$true/.test(guard)) issues.push("trading_day_open_requirement_missing");
for (const file of ["run-strategy4.ps1", "run-strategy5.ps1", "run-institution.ps1"]) {
  if (!/Invoke-FumanWeekdayGuard[^\r\n]*-AllowAfterFormalSourceWindow/.test(read(file))) issues.push(`${file}:explicit_allow_missing`);
}
for (const file of ["run-strategy2.ps1", "run-strategy3.ps1"]) {
  if (fs.existsSync(path.join(root, file)) && /Invoke-FumanWeekdayGuard[^\r\n]*-AllowAfterFormalSourceWindow/.test(read(file))) issues.push(`${file}:intraday_runner_must_not_allow_after_window`);
}
const result = { ok: issues.length === 0, contract: "after-hours-formal-scan-guard-v1", allowed: ["strategy4", "strategy5", "institution"], issues };
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
