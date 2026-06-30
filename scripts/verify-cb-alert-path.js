"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const sendActual = process.argv.includes("--send");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

for (const [file, markers] of [
  ["run-cb-watchdog.ps1", ["Invoke-CbFailureAlert", "send-workflow-alert.js", "cb-watchdog-alert.json", "FUMAN_ALERT_RECEIPT_FILE"]],
  ["run-cb-battle-verify.ps1", ["Invoke-CbFailureAlert", "send-workflow-alert.js", "cb-battle-verify-alert.json", "FUMAN_ALERT_RECEIPT_FILE"]],
  ["scripts/send-workflow-alert.js", ["SMTP_USER", "SMTP_PASS", "gmail-app-password.txt", "writeReceipt", "FUMAN_ALERT_DRY_RUN"]],
]) {
  const text = read(file);
  for (const marker of markers) {
    assert(text.includes(marker), `${file} missing alert marker ${marker}`);
  }
}

const receipt = sendActual
  ? path.join(RECEIPT_DIR, "cb-alert-path-smoke-alert.json")
  : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fuman-cb-alert-")), "cb-alert-path-dry-run.json");

const env = {
  ...process.env,
  FUMAN_RUNTIME_DIR: RUNTIME_DIR,
  FUMAN_ALERT_KIND: "cb-alert-path-smoke",
  FUMAN_ALERT_SOURCE: "FumanCbAlertPathSmoke",
  FUMAN_ALERT_SUBJECT: "Fuman Terminal CB alert path smoke",
  FUMAN_ALERT_TEXT: "Fuman Terminal CB alert path smoke. This verifies the CB watchdog/battle alert sender can produce an auditable receipt.",
  FUMAN_ALERT_RECEIPT_FILE: receipt,
};

if (!sendActual) {
  env.FUMAN_ALERT_DRY_RUN = "1";
  env.REPORT_EMAIL_TO = env.REPORT_EMAIL_TO || "ops@example.invalid";
  env.SMTP_USER = env.SMTP_USER || "smtp@example.invalid";
  env.SMTP_PASS = env.SMTP_PASS || "dry-run-password";
}

const args = [
  "--use-system-ca",
  path.join(ROOT, "scripts", "send-workflow-alert.js"),
  "--kind=cb-alert-path-smoke",
  `--receipt=${receipt}`,
];
if (!sendActual) args.push("--dry-run");

const result = spawnSync(process.execPath, args, {
  cwd: ROOT,
  env,
  encoding: "utf8",
  windowsHide: true,
  timeout: 30000,
});

const receiptPayload = fs.existsSync(receipt) ? JSON.parse(fs.readFileSync(receipt, "utf8")) : null;

if (result.status !== 0) {
  const error = (result.stderr || result.stdout || receiptPayload?.error || "").slice(0, 1000);
  throw new Error(`CB alert path ${sendActual ? "send" : "dry-run"} failed: ${error}`);
}

assert(receiptPayload, "CB alert path receipt missing");
assert.strictEqual(receiptPayload.ok, true, "CB alert path receipt not ok");
assert.strictEqual(receiptPayload.kind, "cb-alert-path-smoke", "CB alert path kind mismatch");
assert.strictEqual(receiptPayload.source, "FumanCbAlertPathSmoke", "CB alert path source mismatch");
if (sendActual) {
  assert.strictEqual(receiptPayload.dryRun, false, "actual CB alert receipt must not be dry-run");
  assert.strictEqual(receiptPayload.channel, "smtp", "actual CB alert channel must be smtp");
} else {
  assert.strictEqual(receiptPayload.dryRun, true, "dry-run CB alert flag missing");
  assert.strictEqual(receiptPayload.channel, "smtp:dry-run", "dry-run CB alert channel mismatch");
}

console.log(`[cb-alert-path] ok mode=${sendActual ? "send" : "dry-run"} channel=${receiptPayload.channel} receipt=${receipt}`);
