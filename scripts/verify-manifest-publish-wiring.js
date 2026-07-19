"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function assert(condition, issue, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function indexOfAll(text, needles) {
  return Object.fromEntries(needles.map((needle) => [needle, text.indexOf(needle)]));
}

function assertOrdered(text, orderedNeedles, label) {
  const positions = indexOfAll(text, orderedNeedles);
  for (const needle of orderedNeedles) {
    assert(positions[needle] >= 0, `${label}_missing:${needle}`, positions);
  }
  for (let index = 1; index < orderedNeedles.length; index += 1) {
    const prev = orderedNeedles[index - 1];
    const next = orderedNeedles[index];
    assert(
      positions[prev] >= 0 && positions[next] >= 0 && positions[prev] < positions[next],
      `${label}_wrong_order:${prev}->${next}`,
      positions,
    );
  }
}

const pkg = readJson("package.json");
const scripts = pkg.scripts || {};
const scorecardPublish = String(scripts["scorecard:publish"] || "");
const unattendedRoot = String(scripts["verify:terminal-unattended-root"] || "");
const scorecardSync = String(scripts["scorecard:sync"] || "");
const scorecardSyncWrapped = String(scripts["scorecard:sync:wrapped"] || "");
const dailyRunner = read("run-scorecard-daily-automation.ps1");
const wrapper = read("run-scorecard-daily-automation-wrapper.ps1");
const rollForward = read("scripts/run-terminal-auto-roll-forward.js");
const orchestrator = read("scripts/write-terminal-orchestrator-state.js");

assertOrdered(scorecardPublish, [
  "verify-terminal-canary-publish.js",
  "guard-daily-manifest-before-scorecard-publish.js",
  "scorecard:publish:raw",
], "package_scorecard_publish");

assert(scorecardSync.includes("run-scorecard-daily-automation.ps1"), "scorecard_sync_not_using_daily_runner", { scorecardSync });
assert(scorecardSyncWrapped.includes("run-scorecard-daily-automation-wrapper.ps1"), "scorecard_sync_wrapped_not_using_wrapper", { scorecardSyncWrapped });
assert(wrapper.includes("run-scorecard-daily-automation.ps1"), "scorecard_wrapper_not_calling_daily_runner");

assertOrdered(dailyRunner, [
  "scripts\\write-daily-terminal-run-manifest.js",
  "scripts\\verify-terminal-canary-publish.js",
  "scripts\\guard-daily-manifest-before-scorecard-publish.js",
  "scripts\\publish-scorecard-snapshot.js",
], "daily_scorecard_runner_publish_gate");

assert(dailyRunner.includes("--scorecard=$snapshotFile"), "daily_runner_canary_not_using_candidate_snapshot");
assert(dailyRunner.includes("--require-formal-now"), "daily_runner_manifest_missing_require_formal_now_on_trading_day");
assert(dailyRunner.includes("--allow-degraded"), "daily_runner_guard_missing_closed_day_degraded_allowance");
assert(rollForward.includes('npmRun("scorecard:publish")'), "roll_forward_publish_not_using_manifest_gated_script");
assert(orchestrator.includes("npm run manifest:daily-terminal-run && npm run scorecard:publish"), "orchestrator_publish_repair_not_manifest_then_publish");
assert(unattendedRoot.includes("verify:manifest-publish-wiring"), "unattended_root_missing_manifest_publish_wiring_gate", { unattendedRoot });

const payload = {
  ok: issues.length === 0,
  contract: "manifest-publish-wiring-v1",
  checkedAt: new Date().toISOString(),
  gates: {
    packageScorecardPublish: "canary -> manifest guard -> raw publish",
    dailyScorecardRunner: "manifest refresh -> canary(candidate snapshot) -> manifest guard -> raw publish",
    rollForward: "npm run scorecard:publish",
    orchestratorRepair: "manifest then scorecard:publish",
  },
  issues,
};

console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);
