"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_ROOT, "data", "opening-report-0830");
const AUTOMATION_PATH = path.join(process.env.USERPROFILE || "C:\\Users\\ginov", ".codex", "automations", "fuman-2", "automation.toml");
const RELEASE_ROOT = process.env.FUMAN_RELEASE_ROOT || "C:\\Users\\ginov\\Documents\\Codex\\fuman-terminal-release-main";
const FORMAL_ROOT = process.env.FUMAN_FORMAL_ROOT || "C:\\fuman-terminal";
const FORMAL_SYNC_FILES = [
  "api/market-ai-live.js",
  "scripts/run-opening-report-0830-production.js",
  "run-opening-report-0830-production-wrapper.ps1",
  "terminal-app.js",
  "terminal-desktop-fast-shell.js",
  "index.html",
  "scripts/verify-opening-report-0830-terminal-briefing.js",
  "scripts/verify-opening-report-0830-delivery-chain.js",
  "scripts/verify-opening-report-0830-unattended-readiness.js"
];

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");
}

function run(command, args, options = {}) {
  return childProcess.execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function safeMatch(value, pattern) {
  return pattern.test(String(value || ""));
}

function parseJsonFromOutput(output) {
  const text = String(output || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  return JSON.parse(text.slice(start, end + 1));
}

function verifyWindowsTask() {
  const text = run("schtasks", ["/Query", "/TN", "Fuman Opening Report 0830 LINE", "/V", "/FO", "LIST"]);
  return {
    ok: safeMatch(text, /Status:\s+Ready/i)
      && safeMatch(text, /Next Run Time:\s+.+08:30:00/i)
      && safeMatch(text, /run-opening-report-0830-production-wrapper\.ps1/i)
      && safeMatch(text, /Success gate is delivery-chain/i),
    task_ready: safeMatch(text, /Status:\s+Ready/i),
    next_run_has_0830: safeMatch(text, /Next Run Time:\s+.+08:30:00/i),
    wrapper_task_registered: safeMatch(text, /run-opening-report-0830-production-wrapper\.ps1/i),
    delivery_chain_comment: safeMatch(text, /Success gate is delivery-chain/i)
  };
}

function verifyWrapper() {
  const source = read(path.join(ROOT, "run-opening-report-0830-production-wrapper.ps1"));
  return {
    ok: source.includes("opening-report-0830-wrapper-v4")
      && source.includes('success_gate = "delivery_chain"')
      && source.includes("verify-opening-report-0830-terminal-briefing.js")
      && source.includes("verify-opening-report-0830-delivery-chain.js")
      && source.includes("production_verifier_does_not_affect_ok")
      && source.includes("bridge_handoff_required = $false"),
    wrapper_v4: source.includes("opening-report-0830-wrapper-v4"),
    success_gate_delivery_chain: source.includes('success_gate = "delivery_chain"'),
    production_verifier_advisory: source.includes("production_verifier_does_not_affect_ok"),
    bridge_optional: source.includes("bridge_handoff_required = $false")
  };
}

function verifyPackageScripts() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const scripts = pkg.scripts || {};
  return {
    ok: scripts["verify:opening-report-0830-terminal-briefing"] === "node scripts/verify-opening-report-0830-terminal-briefing.js"
      && scripts["verify:opening-report-0830-delivery-chain"] === "node --use-system-ca scripts/verify-opening-report-0830-delivery-chain.js"
      && scripts["verify:opening-report-0830-unattended-readiness"] === "node --use-system-ca scripts/verify-opening-report-0830-unattended-readiness.js",
    terminal_briefing_script: Boolean(scripts["verify:opening-report-0830-terminal-briefing"]),
    delivery_chain_script: Boolean(scripts["verify:opening-report-0830-delivery-chain"]),
    unattended_readiness_script: Boolean(scripts["verify:opening-report-0830-unattended-readiness"])
  };
}

function verifyAutomation() {
  const source = read(AUTOMATION_PATH);
  return {
    ok: safeMatch(source, /id\s*=\s*"fuman-2"/)
      && safeMatch(source, /status\s*=\s*"ACTIVE"/)
      && source.includes("08:30")
      && source.includes("LINE Flex")
      && source.includes("個人與群組")
      && source.includes("verify:opening-report-0830-delivery-chain"),
    exists: true,
    active: safeMatch(source, /status\s*=\s*"ACTIVE"/),
    mentions_0830: source.includes("08:30"),
    mentions_personal_group_line: source.includes("個人與群組"),
    mentions_delivery_chain: source.includes("verify:opening-report-0830-delivery-chain")
  };
}

function verifyRuntimeReceipts(compact) {
  const terminalOutput = run(process.execPath, ["scripts/verify-opening-report-0830-terminal-briefing.js"]);
  const deliveryOutput = run(process.execPath, ["--use-system-ca", "scripts/verify-opening-report-0830-delivery-chain.js"]);
  const terminal = parseJsonFromOutput(terminalOutput);
  const delivery = parseJsonFromOutput(deliveryOutput);
  const lineCheck = delivery?.checks?.find((check) => check.name === "line_personal_and_group_flex_delivery");
  const terminalCheck = delivery?.checks?.find((check) => check.name === "terminal_0830_briefing_display_readback");
  const reportCheck = delivery?.checks?.find((check) => check.name === "report_file_and_core_receipt");
  return {
    ok: terminal?.ok === true && delivery?.ok === true,
    date: compact,
    terminal_briefing_ok: terminal?.ok === true,
    terminal_briefing_status: terminal?.briefing_status || "",
    delivery_chain_ok: delivery?.ok === true,
    delivery_chain_reason_code: delivery?.reason_code || "",
    report_file_ok: reportCheck?.ok === true,
    terminal_display_ok: terminalCheck?.ok === true,
    line_personal_group_ok: lineCheck?.ok === true,
    line_target_count: lineCheck?.target_count || 0,
    has_user_target: lineCheck?.has_user_target === true,
    has_group_target: lineCheck?.has_group_target === true,
    token_logged: lineCheck?.token_logged === true,
    target_logged: lineCheck?.target_logged === true
  };
}

function verifyFormalSourceSync() {
  const rows = FORMAL_SYNC_FILES.map((relativePath) => {
    const releasePath = path.join(RELEASE_ROOT, relativePath);
    const formalPath = path.join(FORMAL_ROOT, relativePath);
    const releaseExists = fs.existsSync(releasePath);
    const formalExists = fs.existsSync(formalPath);
    const releaseHash = releaseExists ? hashFile(releasePath) : "";
    const formalHash = formalExists ? hashFile(formalPath) : "";
    return {
      file: relativePath,
      ok: releaseExists && formalExists && releaseHash === formalHash,
      release_exists: releaseExists,
      formal_exists: formalExists,
      hash_match: Boolean(releaseHash && formalHash && releaseHash === formalHash)
    };
  });
  const mismatches = rows.filter((row) => !row.ok);
  const releasePkg = readJson(path.join(RELEASE_ROOT, "package.json"));
  const formalPkg = readJson(path.join(FORMAL_ROOT, "package.json"));
  const requiredScripts = [
    "verify:opening-report-0830-terminal-briefing",
    "verify:opening-report-0830-delivery-chain",
    "verify:opening-report-0830-unattended-readiness"
  ];
  const packageScriptMismatches = requiredScripts.filter((name) => releasePkg.scripts?.[name] !== formalPkg.scripts?.[name]);
  return {
    ok: mismatches.length === 0 && packageScriptMismatches.length === 0,
    canonical_release_root: RELEASE_ROOT,
    formal_root: FORMAL_ROOT,
    checked_files: rows.length,
    mismatch_count: mismatches.length,
    mismatches,
    package_scripts_ok: packageScriptMismatches.length === 0,
    package_script_mismatches: packageScriptMismatches
  };
}

function main() {
  const compact = compactDate(process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const checks = {
    windows_task: verifyWindowsTask(),
    wrapper: verifyWrapper(),
    package_scripts: verifyPackageScripts(),
    codex_heartbeat: verifyAutomation(),
    formal_source_sync: verifyFormalSourceSync(),
    runtime_delivery_chain: verifyRuntimeReceipts(compact)
  };
  const failed = Object.entries(checks).find(([, check]) => !check.ok);
  const output = {
    ok: !failed,
    contract: "opening-report-0830-unattended-readiness-verifier-v1",
    checked_at: new Date().toISOString(),
    date: compact,
    first_blocker: failed?.[0] || "",
    reason_code: failed ? `opening_report_0830_${failed[0]}_not_ready` : "opening_report_0830_unattended_readiness_ok",
    checks
  };
  const receiptPath = path.join(RECEIPT_DIR, `opening-report-0830-unattended-readiness-verifier-${compact}.json`);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify({ ...output, verifier_receipt: receiptPath }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...output, verifier_receipt: receiptPath }, null, 2));
  assert.strictEqual(output.ok, true, output.reason_code);
}

main();




