"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const runner = fs.readFileSync(path.join(ROOT, "run-strategy3-battle-verify.ps1"), "utf8");

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
const env = {
  ...process.env,
  FUMAN_ALERT_DRY_RUN: "1",
  FUMAN_ALERT_KIND: "strategy3-battle-verify",
  FUMAN_ALERT_SOURCE: "FumanStrategy3BattleVerify1305",
  FUMAN_ALERT_SUBJECT: "Fuman Strategy3 battle verify failed dry-run",
  FUMAN_ALERT_TEXT: "Strategy3 battle verify failure alert dry-run",
  FUMAN_ALERT_RECEIPT_FILE: receipt,
  REPORT_EMAIL_TO: process.env.REPORT_EMAIL_TO || "ops@example.invalid",
  SMTP_USER: process.env.SMTP_USER || "smtp@example.invalid",
  SMTP_PASS: process.env.SMTP_PASS || "dry-run-password",
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

console.log(`[strategy3-alert-path] ok channel=${payload.channel} receipt=${receipt}`);
