"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repo = path.resolve(__dirname, "..");
const requiredGuardFiles = [
  "run-open-buy.ps1",
  "run-strategy2-intraday.ps1",
  "run-strategy3-complete-scan.ps1",
  "run-strategy4.ps1",
  "run-strategy5.ps1",
  "run-institution.ps1",
  "run-warrant-flow.ps1",
  "run-cb-detect.ps1",
  "run-realtime-radar.ps1",
  "run-market-overview.ps1",
  "run-flow.ps1",
];

function read(file) {
  return fs.readFileSync(path.join(repo, file), "utf8");
}

const issues = [];
const scheduleGuard = read("schedule-guard.ps1");
for (const marker of [
  "FUMAN_MARKET_CLOSED_PROTECTION_V1",
  "check-market-calendar-action.js",
  "--receipt=1",
  "market_closed",
  "preserve previous good",
]) {
  if (!scheduleGuard.includes(marker)) issues.push(`schedule-guard missing marker ${marker}`);
}

for (const file of requiredGuardFiles) {
  const text = read(file);
  if (!text.includes("schedule-guard.ps1")) issues.push(`${file} does not load schedule-guard.ps1`);
  if (!text.includes("Invoke-FumanWeekdayGuard")) issues.push(`${file} does not call Invoke-FumanWeekdayGuard`);
}

const probe = spawnSync(process.execPath, ["scripts/check-market-calendar-action.js", "--date=2026-07-10", "--label=verify-market-closed-schedule"], {
  cwd: repo,
  encoding: "utf8",
  env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
});
let payload = null;
try { payload = JSON.parse(probe.stdout); } catch {}
if (probe.status !== 10) issues.push(`closed day probe exit expected 10 got ${probe.status}; stderr=${probe.stderr}`);
if (!payload) issues.push("closed day probe did not return JSON");
if (payload) {
  const expected = {
    marketOpen: false,
    marketStatus: "closed",
    formalScanSkipped: true,
    sourceFreshnessRequired: false,
    preservePreviousGood: true,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    action: "skip_formal_scan",
    displayTradeDate: "2026-07-09",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) issues.push(`closed day probe ${key} expected ${JSON.stringify(value)} got ${JSON.stringify(payload[key])}`);
  }
}

const openProbe = spawnSync(process.execPath, ["scripts/check-market-calendar-action.js", "--date=2026-07-09", "--label=verify-market-open-schedule"], {
  cwd: repo,
  encoding: "utf8",
  env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
});
let openPayload = null;
try { openPayload = JSON.parse(openProbe.stdout); } catch {}
if (openProbe.status !== 0) issues.push(`open day probe exit expected 0 got ${openProbe.status}; stderr=${openProbe.stderr}`);
if (!openPayload?.marketOpen) issues.push("open day probe did not allow formal scan");

const result = {
  ok: issues.length === 0,
  contract: "market-closed-schedule-contract-v1",
  checkedFiles: requiredGuardFiles,
  closedDayProbe: payload,
  openDayProbe: openPayload,
  issues,
};
console.log(JSON.stringify(result, null, 2));
if (issues.length) process.exit(1);
