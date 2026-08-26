"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const wrapper = fs.readFileSync(path.join(ROOT, "ops", "public-slot", "Run-DaytradeSourceWriter.ps1"), "utf8");
const checks = {
  usesPassedFormalRoot: wrapper.includes("$RepoRoot = $FumanRoot"),
  doesNotDeriveRootFromRuntimeLocation: !wrapper.includes("$RepoRoot = Split-Path -Parent"),
  noStrategy2LiveHook: !wrapper.includes("Invoke-Strategy2V3LiveHook") && !wrapper.includes("run-strategy2-v3-live-scan.js"),
  noSecondFormalRun: !wrapper.includes("--source-event"),
  globalSingleWriterMutex: wrapper.includes('"Global\\FumanFugleDaytradeSourceWriter"'),
  owns0600WarmupWindow: wrapper.includes('$env:FUMAN_FORMAL_SOURCE_WINDOW_START = "0600"'),
  closesAt1330: wrapper.includes('$env:FUMAN_FORMAL_SOURCE_WINDOW_END = "1330"'),
  sourceWindowSetBeforeCalendarGuard: wrapper.indexOf('FUMAN_FORMAL_SOURCE_WINDOW_START = "0600"') < wrapper.indexOf("Invoke-FumanWeekdayGuard"),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "daytrade-writer-wrapper-authority-v1", checks, failed }, null, 2));
if (failed.length) process.exit(1);
