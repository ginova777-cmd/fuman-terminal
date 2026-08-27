"use strict";
const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "..");
const stage4Runner = fs.readFileSync(path.join(repo, "run-daytrade-intraday-retention.ps1"), "utf8");
const checks = {
  dailyRunnerUsesOwnRoot: fs.readFileSync(path.join(repo, "run-daily-retention-maintenance.ps1"), "utf8").includes("$root = $PSScriptRoot"),
  fiveStageInstallerUsesOwnRoot: fs.readFileSync(path.join(repo, "scripts", "install-five-stage-cleanup-task.ps1"), "utf8").includes("[string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)"),
  janitorInstallerUsesOwnRoot: fs.readFileSync(path.join(repo, "scripts", "install-global-cost-janitor-scorecard-task.ps1"), "utf8").includes("[string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)"),
  stage4RunnerUsesOwnRoot: stage4Runner.includes("$root = $PSScriptRoot"),
  stage4RunnerUsesStableNodePath: stage4Runner.includes("C:\\Program Files\\nodejs\\node.exe"),
  stage4RunnerWritesDiagnosticLog: stage4Runner.includes("daytrade-intraday-retention-$dateToken.log"),
  stage4RunnerFailsClosedWithReceipt: stage4Runner.includes("retention_wrapper_failed_before_canonical_receipt"),
  stage4RunnerProtectsBoundedContract: stage4Runner.includes("maxBatchSize = 5000") && stage4Runner.includes("requestedMaxBatches") && stage4Runner.includes("protectedLatestTradeDateRequired = $true"),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "cleanup-root-authority-v1", checks, failed }, null, 2));
if (failed.length) process.exit(1);
