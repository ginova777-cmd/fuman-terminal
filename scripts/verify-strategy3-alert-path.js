"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const runner = fs.readFileSync(path.join(ROOT, "run-strategy3-battle-verify.ps1"), "utf8");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function secretValue(envName, fileNames = []) {
  const envValue = process.env[envName];
  if (envValue) return envValue;
  for (const name of fileNames) {
    for (const dir of [
      path.join(RUNTIME_DIR, "secrets"),
      path.join(ROOT, "secrets"),
    ]) {
      const value = readSecretText(path.join(dir, name));
      if (value) return value;
    }
  }
  return "";
}

for (const marker of [
  "Invoke-Strategy3FailureAlert",
  "send-workflow-alert.js",
  "strategy3-battle-verify-alert.json",
  "FumanStrategy3BattleVerify1305",
]) {
  assert(runner.includes(marker), `run-strategy3-battle-verify.ps1 missing alert marker ${marker}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-strategy3-alert-"));
const receipt = path.join(tmpDir, "strategy3-battle-alert-dry-run.json");
const realTo = secretValue("REPORT_EMAIL_TO", ["report-email-to.txt", "smtp-to.txt", "gmail-to.txt"]);
const realUser = secretValue("SMTP_USER", ["smtp-user.txt", "gmail-user.txt"]);
const realPass = secretValue("SMTP_PASS", ["smtp-pass.txt", "gmail-app-password.txt"]);

assert(realTo, "Strategy3 alert path missing REPORT_EMAIL_TO/runtime recipient secret");
assert(realUser, "Strategy3 alert path missing SMTP_USER/runtime sender secret");
assert(realPass, "Strategy3 alert path missing SMTP_PASS/runtime Gmail app password");

const env = {
  ...process.env,
  FUMAN_ALERT_DRY_RUN: "1",
  FUMAN_ALERT_KIND: "strategy3-battle-verify",
  FUMAN_ALERT_SOURCE: "FumanStrategy3BattleVerify1305",
  FUMAN_ALERT_SUBJECT: "Fuman Strategy3 battle verify failed dry-run",
  FUMAN_ALERT_TEXT: "Strategy3 battle verify failure alert dry-run",
  FUMAN_ALERT_RECEIPT_FILE: receipt,
  REPORT_EMAIL_TO: realTo,
  SMTP_USER: realUser,
  SMTP_PASS: realPass,
};

const result = spawnSync(process.execPath, [
  "--use-system-ca",
  path.join(ROOT, "scripts", "send-workflow-alert.js"),
  "--kind=strategy3-battle-verify",
  `--receipt=${receipt}`,
  "--dry-run",
], {
  cwd: ROOT,
  env,
  encoding: "utf8",
  windowsHide: true,
  timeout: 20000,
});

if (result.status !== 0) {
  throw new Error(`send-workflow-alert dry-run failed: ${(result.stderr || result.stdout || "").slice(0, 500)}`);
}

const payload = JSON.parse(fs.readFileSync(receipt, "utf8"));
assert.strictEqual(payload.ok, true, "dry-run alert receipt not ok");
assert.strictEqual(payload.kind, "strategy3-battle-verify", "dry-run alert kind mismatch");
assert.strictEqual(payload.source, "FumanStrategy3BattleVerify1305", "dry-run alert source mismatch");
assert.strictEqual(payload.channel, "smtp:dry-run", "dry-run alert channel mismatch");
assert.strictEqual(payload.dryRun, true, "dry-run alert flag missing");

console.log(`[strategy3-alert-path] ok channel=${payload.channel} configured=true receipt=${receipt}`);
