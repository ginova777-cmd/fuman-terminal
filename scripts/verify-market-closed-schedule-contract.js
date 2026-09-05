"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repo = path.resolve(__dirname, "..");
const requiredGuardFiles = [
  "run-strategy2-intraday.ps1",
  "run-strategy3-complete-scan.ps1",
  "run-strategy4.ps1",
  "run-strategy5.ps1",
  "run-institution.ps1",
  "run-market-overview.ps1",
  "run-flow.ps1",
  "run-strategy3-v2-complete-scan.ps1",
  "run-strategy3-v2-readiness-guard.ps1",
  "run-strategy3-v2-1255-first-attempt.ps1",
  "run-strategy4-source-prewarm.ps1",
];

const requiredDirectGuardFiles = [
  "run-opening-report-0830-production-wrapper.ps1",
  "scripts/run-opening-report-0830-production.js",
];

function read(file) {
  try { return fs.readFileSync(path.join(repo, file), "utf8"); } catch { return ""; }
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
  if (!text) {
    issues.push(`${file} is missing`);
    continue;
  }
  if (!text.includes("schedule-guard.ps1")) issues.push(`${file} does not load schedule-guard.ps1`);
  if (!text.includes("Invoke-FumanWeekdayGuard")) issues.push(`${file} does not call Invoke-FumanWeekdayGuard`);
}

for (const file of requiredDirectGuardFiles) {
  const text = read(file);
  if (!text.includes("check-market-calendar-action.js") && !text.includes("isTwseTradingDay")) issues.push(`${file} does not own a market-calendar guard`);
  if (!text.includes("market_calendar_non_trading_day")) issues.push(`${file} does not expose the canonical non-trading-day reason`);
  if (!text.includes("line_push_attempted") || !text.includes("mother_pool_bridge_attempted")) issues.push(`${file} does not prove notification and bridge side effects are suppressed`);
}

const nearOneRunner = read("scripts/run-daytrade-near-one-source.js");
for (const marker of ["isTwseTradingDay", "market_calendar_non_trading_day", "noSideEffects", "lockAttempted: false", "databaseWriteAttempted: false"]) {
  if (!nearOneRunner.includes(marker)) issues.push(`scripts/run-daytrade-near-one-source.js missing closed-market marker ${marker}`);
}
const nearOneInstaller = read("scripts/install-daytrade-near-one-source-task.ps1");
if (!nearOneInstaller.includes("New-ScheduledTaskTrigger -Weekly")) issues.push("near-one installer must use weekday triggers");
if (!nearOneInstaller.includes("Monday,Tuesday,Wednesday,Thursday,Friday")) issues.push("near-one installer weekday set is incomplete");
if (!nearOneInstaller.includes("LogonType S4U")) issues.push("near-one installer must be unattended under S4U");

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

const receiptFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-market-closed-contract-"));
const receiptProbe = spawnSync(process.execPath, ["scripts/check-market-calendar-action.js", "--date=2026-07-10", "--label=verify-market-closed-receipt", "--receipt=1"], {
  cwd: repo,
  encoding: "utf8",
  env: { ...process.env, NODE_OPTIONS: "--use-system-ca", FUMAN_RUNTIME_DIR: receiptFixtureRoot, FUMAN_DATA_DIR: path.join(receiptFixtureRoot, "data") },
});
let receiptPayload = null;
try { receiptPayload = JSON.parse(receiptProbe.stdout); } catch {}
if (receiptProbe.status !== 10) issues.push(`closed day receipt probe exit expected 10 got ${receiptProbe.status}; stderr=${receiptProbe.stderr}`);
const receiptFile = path.join(receiptFixtureRoot, "data", "scan-receipts", "market-closed-verify-market-closed-receipt.json");
let receipt = null;
try { receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")); } catch {}
if (!receipt) issues.push("closed day receipt probe did not write a receipt");
if (receipt?.unattendedStatus !== "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD") issues.push(`closed day receipt unattendedStatus must be MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD got ${receipt?.unattendedStatus || "missing"}`);
if (receipt?.evidenceStatus !== "market_closed") issues.push(`closed day receipt evidenceStatus must be market_closed got ${receipt?.evidenceStatus || "missing"}`);
if (receipt?.publishAllowed === true) issues.push("closed day receipt publishAllowed must not be true");
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
  checkedDirectGuardFiles: requiredDirectGuardFiles,
  closedDayProbe: payload,
  closedDayReceiptProbe: receipt,
  openDayProbe: openPayload,
  issues,
};
console.log(JSON.stringify(result, null, 2));
if (issues.length) process.exit(1);
