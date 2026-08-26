"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const FORMAL = "C:\\fuman-release-owner\\fuman-terminal";
const LEGACY = "C:\\fuman-terminal";
const files = [
  "ops/public-slot/Run-DaytradeSourceWriter.ps1",
  "ops/public-slot/Run-DaytradeWebSocketCollector.ps1",
  "ops/public-slot/install-daytrade-source-writer-task.ps1",
  "ops/public-slot/install-daytrade-websocket-collector-task.ps1",
  "ops/public-slot/install-daytrade-source-gate-tasks.ps1",
  "ops/public-slot/install-daytrade-source-control-tasks.ps1",
];
const checks = Object.fromEntries(files.map((file) => {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  return [file, source.includes(`[string]$FumanRoot = "${FORMAL}"`) && !source.includes(`[string]$FumanRoot = "${LEGACY}"`)];
}));
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([file]) => file);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "daytrade-formal-root-default-v1", formalRoot: FORMAL, checks, failed }, null, 2));
if (failed.length) process.exit(1);
