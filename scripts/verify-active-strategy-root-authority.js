"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ACTIVE_FILES = [
  "run-strategy2-battle-verify.ps1",
  "run-institution-battle-verify.ps1",
  "run-strategy3-v2-complete-scan.ps1",
  "run-strategy3-battle-verify.ps1",
  "run-strategy3-v2-1255-first-attempt.ps1",
  "run-strategy3-ready-snapshot.ps1",
  "run-strategy5-battle-verify.ps1",
  "ops/run-strategy2-v3-water-gate.ps1",
  "run-strategy4-postscan-closure.ps1",
  "run-strategy4-partial-sync.ps1",
  "run-strategy4-source-prewarm.ps1",
  "scripts/strategy3-v2-contract.js",
  "scripts/verify-strategy3-v2-daily-unattended-closure.js",
  "scripts/verify-strategy2-v3-water.js",
  "scripts/verify-strategy2-v3-live-closure.js",
  "scripts/verify-strategy4-postscan-closure.js",
  "scripts/verify-strategy4-88-data-chain.js",
  "scripts/verify-strategy5-88-data-chain.js",
];

const issues = [];
const evidence = [];
const legacyRootPattern = /C:[\\/]fuman-terminal(?:[\\/]|["']|$)|Documents[\\/]Codex|fuman-terminal-release-main/i;

for (const relative of ACTIVE_FILES) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    issues.push(`active_strategy_root_file_missing:${relative}`);
    continue;
  }
  const source = fs.readFileSync(file, "utf8");
  const legacyRoot = legacyRootPattern.test(source);
  if (legacyRoot) issues.push(`active_strategy_legacy_root:${relative}`);
  const selfDerived = /\$PSScriptRoot|path\.resolve\(__dirname,\s*["']\.\.["']\)/.test(source);
  if (!selfDerived) issues.push(`active_strategy_root_not_self_derived:${relative}`);
  evidence.push({ file: relative, legacyRoot, selfDerived });
}

const report = {
  ok: issues.length === 0,
  contract: "active-strategy-root-authority-v1",
  checkedAt: new Date().toISOString(),
  evidence,
  issues,
};
console.log(JSON.stringify(report, null, 2));
