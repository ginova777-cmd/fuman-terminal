"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { MODULES, CONTRACT } = require("../lib/strategy-scan-receipt-contract");

const ROOT = path.resolve(__dirname, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env }, timeout: 60000, windowsHide: true });
  let json = null;
  try { json = JSON.parse(String(result.stdout || "{}").trim()); } catch {}
  return { label, ok: result.status === 0, exitCode: result.status ?? 1, stdout: String(result.stdout || ""), stderr: String(result.stderr || ""), json };
}

function fileHas(file, pattern) {
  try { return fs.readFileSync(path.join(ROOT, file), "utf8").includes(pattern); } catch { return false; }
}

function main() {
  const issues = [];
  const self = run(["scripts/normalize-strategy-scan-receipts.js", "--self-test"], "normalizer-self-test");
  if (!self.ok || self.json?.ok !== true) issues.push(`normalizer_self_test_failed:${self.exitCode}`);
  const dry = run(["scripts/normalize-strategy-scan-receipts.js"], "normalizer-current-dry-run");
  if (!dry.ok || dry.json?.ok !== true) issues.push(`normalizer_current_failed:${dry.exitCode}`);
  for (const mod of MODULES) {
    const row = dry.json?.rows?.find((item) => item.key === mod.key);
    if (!row) issues.push(`${mod.key}:normalizer_row_missing`);
    if (row && row.issues && row.issues.length) issues.push(`${mod.key}:${row.issues[0]}`);
  }
  if (!fileHas("scripts/verify-terminal-resource-chain.js", "normalizeStrategyScanReceipt")) issues.push("resource_chain_missing_receipt_normalizer");
  if (!fileHas("scripts/write-daily-terminal-run-manifest.js", "normalizeStrategyScanReceipt")) issues.push("daily_manifest_missing_receipt_normalizer");
  const scripts = PKG.scripts || {};
  if (!scripts["verify:strategy-scan-receipt-contract"]) issues.push("package_script_missing:verify:strategy-scan-receipt-contract");
  if (!scripts["scan-receipts:normalize"]) issues.push("package_script_missing:scan-receipts:normalize");
  if (!scripts["verify:terminal-unattended-root"] || !scripts["verify:terminal-unattended-root"].includes("verify:strategy-scan-receipt-contract")) {
    issues.push("terminal_unattended_root_missing_strategy_scan_receipt_contract");
  }
  const payload = {
    ok: issues.length === 0,
    contract: `${CONTRACT}-verifier`,
    checked_at: new Date().toISOString(),
    modules: MODULES.map((item) => item.key),
    selfTest: { ok: self.ok, exitCode: self.exitCode },
    current: { ok: dry.ok, exitCode: dry.exitCode, rows: dry.json?.rows || [] },
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main();
