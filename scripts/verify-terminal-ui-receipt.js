"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = name + "=";
  const found = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  return found === name ? "1" : (found ? found.slice(prefix.length) : fallback);
}

const tradeDate = String(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || "")).replace(/\D/g, "").slice(0, 8);
const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, ["scripts/verify-terminal-ui-state-acceptance.js"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
  env: { ...process.env },
});
const exitCode = result.status === null ? 1 : result.status;
const payload = {
  contract: "terminal-ui-receipt-v1",
  ok: exitCode === 0,
  status: exitCode === 0 ? "PASS" : "BLOCKED",
  trade_date: tradeDate,
  daily_run_id: dailyRunId,
  checked_at: new Date().toISOString(),
  started_at: startedAt,
  verifier: "scripts/verify-terminal-ui-state-acceptance.js",
  verifier_exit_code: exitCode,
  verifier_stdout: String(result.stdout || "").slice(-8000),
  verifier_stderr: String(result.stderr || "").slice(-8000),
};
console.log(JSON.stringify(payload, null, 2));
if (exitCode !== 0) process.exitCode = 1;