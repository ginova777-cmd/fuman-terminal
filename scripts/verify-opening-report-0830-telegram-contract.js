"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const wrapper = read("run-opening-report-0830-production-wrapper.ps1");
const runner = read("scripts/run-opening-report-0830-production.js");
const notifier = read("scripts/send-opening-report-0830-telegram.js");
const closure = read("scripts/verify-opening-report-0830-telegram-closure.js");
const installer = read("scripts/install-opening-report-0830-task.ps1");
const checks = {
  wrapperTelegramOnly: wrapper.includes('channel = "telegram_only"') && wrapper.includes('line_delivery_allowed = $false'),
  runnerRejectsLine: runner.includes('if (hasFlag("--send-line")) throw new Error("line_delivery_retired_use_telegram_only")'),
  wrapperUsesOneRunId: wrapper.includes('"--run-id=$runId"') && wrapper.includes('second_formal_run_allowed = $false'),
  wrapperRequiresBridge: wrapper.includes('mother_pool_bridge_required = $true') && wrapper.includes('$bridgeOk'),
  wrapperNoMissingLegacyHandoff: !wrapper.includes("run-opening-report-0830-bridge-handoff.ps1"),
  runnerWaitsFor0835Bridge: runner.includes("waitUntilTaipeiMinute(8 * 60 + 35)"),
  notifierWaitsFor0836: notifier.includes("waitUntil0836") && notifier.includes("opening-report-0830-telegram-delivery-v1"),
  notifierRequiresTwoTargets: notifier.includes('targetCount < 2') && notifier.includes("telegram_personal_and_group_targets_missing"),
  notifierNoSecretReceipt: notifier.includes("token_logged: false") && notifier.includes("target_logged: false"),
  notifierSameRunDedupe: notifier.includes("previous?.run_id === final.run_id") && notifier.includes("content_hash"),
  closureChecksIdentity: closure.includes("telegram_identity_mismatch") && closure.includes("telegram_content_hash_missing"),
  installerCanonicalName: installer.includes("Fuman Opening Report 0830 Telegram"),
  installerRetiresLine: installer.includes("Fuman Opening Report 0830 LINE") && installer.includes("Unregister-ScheduledTask"),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "opening-report-0830-telegram-authority-v1", checks, failed }, null, 2));
if (failed.length) process.exit(1);
