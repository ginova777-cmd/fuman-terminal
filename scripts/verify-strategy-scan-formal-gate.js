"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.FUMAN_ROOT || path.resolve(__dirname, "..");
const CONTRACT = "strategy-scan-formal-gate-contract-v1";
const CONTRACT_PATH = path.join(ROOT, "ops", "strategy-scan-formal-gate-contract.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function readText(file) { return fs.readFileSync(file, "utf8"); }
function has(text, pattern) { return String(text || "").includes(pattern); }
function findIndex(text, pattern) { return String(text || "").indexOf(pattern); }

function parsePowerShell(file) {
  const ps = process.env.PWSH || "C:/Program Files/PowerShell/7/pwsh.exe";
  const command = `$errs=$null; [System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$null,[ref]$errs) > $null; if($errs){ $errs | ForEach-Object { $_.ToString() }; exit 1 }`;
  const result = spawnSync(ps, ["-NoProfile", "-Command", command], { encoding: "utf8", timeout: 10000, windowsHide: true });
  return { ok: result.status === 0, output: String(result.stdout || result.stderr || "").trim() };
}
function main() {
  const contract = readJson(CONTRACT_PATH);
  const pkg = readJson(PACKAGE_PATH);
  const issues = [];
  if (contract.contract !== CONTRACT) issues.push(`contract_mismatch:${contract.contract || "missing"}`);

  const fullScanPath = path.join(ROOT, contract.fullScan.script);
  const fullScan = readText(fullScanPath);
  const fullScanParse = parsePowerShell(fullScanPath);
  if (!fullScanParse.ok) issues.push(`full_scan_powershell_parse_failed:${fullScanParse.output}`);
  for (const pattern of contract.fullScan.mustContain || []) {
    if (!has(fullScan, pattern)) issues.push(`full_scan_missing:${pattern}`);
  }
  const gateIndex = findIndex(fullScan, "Invoke-FullScanFormalEntryGate");
  const runnerIndex = findIndex(fullScan, contract.fullScan.mustCallBefore);
  if (gateIndex < 0 || runnerIndex < 0 || gateIndex > runnerIndex) {
    issues.push("full_scan_formal_gate_not_before_strategy_scans");
  }

  for (const runner of contract.criticalRunners || []) {
    const file = path.join(ROOT, runner.script);
    if (!fs.existsSync(file)) {
      issues.push(`${runner.strategy}:runner_missing:${runner.script}`);
      continue;
    }
    const text = readText(file);
    if (/\.ps1$/i.test(file)) {
      const parsed = parsePowerShell(file);
      if (!parsed.ok) issues.push(`${runner.strategy}:powershell_parse_failed:${parsed.output}`);
    }
    for (const pattern of contract.requiredRunnerPatterns || []) {
      if (!has(text, pattern)) issues.push(`${runner.strategy}:runner_missing:${pattern}`);
    }
    const gatePattern = `Invoke-ScannerResourceHealthGate -Strategy "${runner.gateStrategy}"`;
    if (!has(text, gatePattern)) issues.push(`${runner.strategy}:runner_missing_gate_strategy:${runner.gateStrategy}`);
    if ((contract.strongReceiptRunners || []).includes(runner.strategy)) {
      for (const pattern of contract.strongReceiptPatterns || []) {
        if (!has(text, pattern)) issues.push(`${runner.strategy}:strong_receipt_missing:${pattern}`);
      }
    }
  }

  const scripts = pkg.scripts || {};
  if (!scripts["verify:strategy-scan-formal-gate"]) issues.push("package_script_missing:verify:strategy-scan-formal-gate");
  if (!scripts["verify:terminal-unattended-root"] || !scripts["verify:terminal-unattended-root"].includes("verify:strategy-scan-formal-gate")) {
    issues.push("terminal_unattended_root_missing_strategy_scan_formal_gate");
  }

  const payload = {
    ok: issues.length === 0,
    contract: CONTRACT,
    checked_at: new Date().toISOString(),
    full_scan: contract.fullScan.script,
    critical_runners: (contract.criticalRunners || []).map((runner) => runner.strategy),
    strong_receipt_runners: contract.strongReceiptRunners || [],
    invariants: contract.invariants || [],
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();

