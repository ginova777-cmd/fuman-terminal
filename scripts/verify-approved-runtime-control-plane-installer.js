"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "scripts", "install-approved-runtime-control-plane.ps1");
const text = fs.readFileSync(file, "utf8");
const issues = [];
const requiredFiles = [
  "run-daytrade-intraday-retention.ps1",
  "Run-DaytradeWebSocketCollector.ps1",
  "run-terminal-master-control.ps1",
  "collect-scorecard88-terminal-surface-evidence.js",
  "collect-terminal-scorecard-88.js",
  "fuman-schedule-registry.json",
  "run-scorecard88-terminal-collector.ps1",
];
for (const name of requiredFiles) if (!text.includes(name)) issues.push(`approved_file_missing:${name}`);
for (const marker of ["source_tree_not_clean", "runtime_control_plane_apply_outside_2200_window", "post_copy_hash_mismatch", "source_and_formal_root_must_differ", "taskDefinitionsChanged=$false", "strategyRunStarted=$false", "deploymentStarted=$false", "Copy-Item -LiteralPath $target -Destination $backup"]) {
  if (!text.includes(marker)) issues.push(`safety_marker_missing:${marker}`);
}
if (/Register-ScheduledTask|schtasks|vercel\s+--prod|npm\s+run\s+deploy|Start-Process/i.test(text)) issues.push("installer_contains_forbidden_external_action");
const result = { ok: issues.length === 0, contract: "approved-runtime-control-plane-installer-contract-v1", file, approvedFileCount: requiredFiles.length, issues };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
