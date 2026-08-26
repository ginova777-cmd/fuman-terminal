"use strict";
const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "..");
const checks = {
  dailyRunnerUsesOwnRoot: fs.readFileSync(path.join(repo, "run-daily-retention-maintenance.ps1"), "utf8").includes("$root = $PSScriptRoot"),
  fiveStageInstallerUsesOwnRoot: fs.readFileSync(path.join(repo, "scripts", "install-five-stage-cleanup-task.ps1"), "utf8").includes("[string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)"),
  janitorInstallerUsesOwnRoot: fs.readFileSync(path.join(repo, "scripts", "install-global-cost-janitor-scorecard-task.ps1"), "utf8").includes("[string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)"),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "cleanup-root-authority-v1", checks, failed }, null, 2));
if (failed.length) process.exit(1);
