"use strict";

const fs = require("fs");
const path = require("path");
const {
  STAGES,
  compactDate,
  defaultAuditRoot,
  readJson,
  receiptDir,
  writeJson,
} = require("../lib/terminal-final-audit-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const registryFile = path.resolve(argValue("--registry", path.join(auditRoot, tradeDate, dailyRunId, "active-module-registry.json")));
  const registry = readJson(registryFile, null);
  const receipts = [];
  const missingReceipts = [];
  const failedStages = [];
  for (const stage of STAGES) {
    const file = path.join(receiptDir(auditRoot, tradeDate, dailyRunId), `${stage.key}.json`);
    const receipt = readJson(file, null);
    if (!receipt || receipt.daily_run_id !== dailyRunId || receipt.trade_date !== tradeDate || receipt.receipt_present !== true) {
      missingReceipts.push(stage.key);
      receipts.push({ key: stage.key, receipt_present: false, file });
      continue;
    }
    const marketClosedSkipped = receipt.status === "SKIPPED" && receipt.reason_code === "market_closed_previous_good";
    const accepted = (receipt.complete === true && receipt.status === "PASS") || marketClosedSkipped;
    if (!accepted) failedStages.push({ key: stage.key, status: receipt.status, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action });
    receipts.push({ key: stage.key, receipt_present: true, complete: accepted, status: receipt.status, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action, file });
  }
  const firstFailure = failedStages[0] || null;
  const firstBlocker = missingReceipts[0] || firstFailure?.key || "";
  const payload = {
    contract: "terminal-daily-manifest-v1",
    generated_at: new Date().toISOString(),
    daily_run_id: dailyRunId,
    trade_date: tradeDate,
    scope: registry?.scope || "final_audit_convergence_gates_only",
    registry_file: registryFile,
    receipts,
    missing_receipts: missingReceipts,
    failed_stages: failedStages,
    first_blocker: firstBlocker,
    reason_code: missingReceipts.length ? "stage_receipt_missing" : (firstFailure?.reason_code || "ok"),
    allowed_action: missingReceipts.length ? "produce_required_stage_receipt_before_claiming_completion" : (firstFailure?.allowed_action || "none"),
    ok: Boolean(registry?.ok === true && missingReceipts.length === 0 && failedStages.length === 0),
    unattended_status: registry?.ok === true && missingReceipts.length === 0 && failedStages.length === 0 ? "YES" : "NO",
  };
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  const file = path.join(runDir, "terminal-daily-manifest.json");
  writeJson(file, payload);
  writeJson(path.join(auditRoot, "terminal-daily-manifest-latest.json"), payload);
  fs.writeFileSync(path.join(runDir, "terminal-daily-manifest.md"), `# Terminal Daily Manifest\n\n- daily_run_id: ${dailyRunId}\n- trade_date: ${tradeDate}\n- unattended_status: ${payload.unattended_status}\n- first_blocker: ${payload.first_blocker || "none"}\n- reason_code: ${payload.reason_code}\n`, "utf8");
  console.log(JSON.stringify({ ok: payload.ok, unattended_status: payload.unattended_status, daily_run_id: dailyRunId, trade_date: tradeDate, first_blocker: payload.first_blocker, reason_code: payload.reason_code, output: file }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();
