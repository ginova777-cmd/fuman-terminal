"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SEND_REAL = process.argv.includes("--send");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const watchdog = read("run-strategy5-watchdog.ps1");
const battleVerify = read("run-strategy5-battle-verify.ps1");

for (const marker of [
  "Invoke-Strategy5WatchdogFailureAlert",
  "send-workflow-alert.js",
  "strategy5-watchdog-alert.json",
  "FumanStrategy5Watchdog2130",
]) {
  assert(watchdog.includes(marker), `run-strategy5-watchdog.ps1 missing alert marker ${marker}`);
}

for (const marker of [
  "Invoke-Strategy5BattleVerifyAlert",
  "send-workflow-alert.js",
  "strategy5-battle-verify-alert.json",
  "FumanStrategy5BattleVerify",
]) {
  assert(battleVerify.includes(marker), `run-strategy5-battle-verify.ps1 missing alert marker ${marker}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-strategy5-alert-"));
const checks = [
  {
    receipt: path.join(tmpDir, "strategy5-watchdog-alert.json"),
    kind: "strategy5-watchdog",
    source: "FumanStrategy5Watchdog2130",
    subject: SEND_REAL ? "Fuman Strategy5 watchdog SMTP probe" : "Fuman Strategy5 watchdog failed dry-run",
    text: SEND_REAL ? "Strategy5 watchdog SMTP probe" : "Strategy5 watchdog failure alert dry-run",
  },
  {
    receipt: path.join(tmpDir, "strategy5-battle-verify-alert.json"),
    kind: "strategy5-battle-verify",
    source: "FumanStrategy5BattleVerify",
    subject: SEND_REAL ? "Fuman Strategy5 battle verify SMTP probe" : "Fuman Strategy5 battle verify failed dry-run",
    text: SEND_REAL ? "Strategy5 battle verify SMTP probe" : "Strategy5 battle verify failure alert dry-run",
  },
];

for (const item of checks) {
  const env = {
    ...process.env,
    FUMAN_ALERT_KIND: item.kind,
    FUMAN_ALERT_SOURCE: item.source,
    FUMAN_ALERT_SUBJECT: item.subject,
    FUMAN_ALERT_TEXT: item.text,
    FUMAN_ALERT_RECEIPT_FILE: item.receipt,
  };
  if (!SEND_REAL) {
    env.FUMAN_ALERT_DRY_RUN = "1";
    env.REPORT_EMAIL_TO = process.env.REPORT_EMAIL_TO || "ops@example.invalid";
    env.SMTP_USER = process.env.SMTP_USER || "smtp@example.invalid";
    env.SMTP_PASS = process.env.SMTP_PASS || "dry-run-password";
  }

  const args = [
    "--use-system-ca",
    path.join(ROOT, "scripts", "send-workflow-alert.js"),
    `--kind=${item.kind}`,
    `--receipt=${item.receipt}`,
  ];
  if (!SEND_REAL) args.push("--dry-run");

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(item.receipt, "utf8"));
  } catch {}
  if (result.status !== 0) {
    const message = payload?.error || result.stderr || result.stdout || "unknown alert failure";
    throw new Error(`send-workflow-alert ${SEND_REAL ? "smtp" : "dry-run"} failed for ${item.kind}: ${String(message).slice(0, 500)}`);
  }

  assert.strictEqual(payload?.ok, true, `${item.kind} alert receipt not ok`);
  assert.strictEqual(payload.kind, item.kind, `${item.kind} alert kind mismatch`);
  assert.strictEqual(payload.source, item.source, `${item.kind} alert source mismatch`);
  assert.strictEqual(payload.channel, SEND_REAL ? "smtp" : "smtp:dry-run", `${item.kind} alert channel mismatch`);
  assert.strictEqual(payload.dryRun, !SEND_REAL, `${item.kind} dryRun flag mismatch`);
}

console.log(`[strategy5-alert-path] ok mode=${SEND_REAL ? "smtp" : "dry-run"} receipts=${checks.map((item) => item.receipt).join(",")}`);
