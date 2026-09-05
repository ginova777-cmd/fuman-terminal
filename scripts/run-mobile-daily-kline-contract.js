"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const receiptDir = path.join(runtimeRoot, "data", "receipts");
const receiptFile = path.join(receiptDir, "mobile-daily-kline-contract-latest.json");
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, [path.join(__dirname, "verify-mobile-daily-kline-contract.js"), ...process.argv.slice(2)], { cwd: ROOT, encoding: "utf8", env: process.env });
let verifier;
try { verifier = JSON.parse(String(result.stdout || "{}").trim()); }
catch { verifier = { ok: false, status: "FAIL_CLOSED", complete: false, issues: ["verifier_output_invalid_json"], stdout: String(result.stdout || "").slice(0, 1000) }; }
const complete = result.status === 0 && verifier.ok === true && verifier.complete === true && verifier.status === "PASS";
const receipt = {
  contract: "mobile-daily-kline-runner-verifier-receipt-v1",
  runner: "scripts/run-mobile-daily-kline-contract.js",
  verifier: "scripts/verify-mobile-daily-kline-contract.js",
  status: complete ? "complete" : "fail_closed",
  complete,
  exitCode: complete ? 0 : 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  ranges: [60, 120, 240],
  movingAverages: [5, 10, 20],
  sourceAuthority: "api/daily-kline.js -> supabase:strategy4_daily_ohlcv_view",
  verifierReceipt: verifier,
  stderr: String(result.stderr || "").trim().slice(0, 2000),
};
fs.mkdirSync(receiptDir, { recursive: true });
const temporary = `${receiptFile}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
fs.renameSync(temporary, receiptFile);
console.log(JSON.stringify({ ...receipt, receiptFile }, null, 2));
if (!complete) process.exitCode = 1;
