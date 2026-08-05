"use strict";

const path = require("path");
const {
  compactDate,
  defaultAuditRoot,
  defaultRuntimeDir,
  readJson,
  writeStageReceipt,
} = require("../lib/terminal-final-audit-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function main() {
  const stage = argValue("--stage");
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
  const artifact = argValue("--artifact", "");
  const parsed = artifact ? readJson(path.isAbsolute(artifact) ? artifact : path.resolve(ROOT, artifact), null) : null;
  const result = writeStageReceipt({
    auditRoot: path.resolve(argValue("--out", defaultAuditRoot(ROOT))),
    tradeDate,
    dailyRunId,
    stage,
    status: argValue("--status", ""),
    exitCode: Number(argValue("--exit-code", "0")),
    command: argValue("--command", ""),
    artifact,
    parsed,
    stdout: argValue("--stdout", ""),
    stderr: argValue("--stderr", ""),
    reasonCode: argValue("--reason-code", ""),
    allowedAction: argValue("--allowed-action", ""),
  });
  console.log(JSON.stringify({ ok: true, stage, daily_run_id: dailyRunId, trade_date: tradeDate, receipt: result.file }, null, 2));
}

main();
