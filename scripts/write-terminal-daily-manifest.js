"use strict";

const fs = require("fs");
const path = require("path");
const { STAGES, compactDate, defaultAuditRoot, defaultRuntimeDir, readJson, receiptDir, writeJson } = require("../lib/terminal-final-audit-contract");
const { moduleReceiptFile } = require("../lib/terminal-full-module-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function readCoreReceipts({ auditRoot, tradeDate, dailyRunId }) {
  const receipts = [];
  const missing = [];
  const failed = [];
  for (const stage of STAGES) {
    const file = path.join(receiptDir(auditRoot, tradeDate, dailyRunId), `${stage.key}.json`);
    const receipt = readJson(file, null);
    if (!receipt || receipt.daily_run_id !== dailyRunId || receipt.trade_date !== tradeDate || receipt.receipt_present !== true) {
      missing.push(stage.key);
      receipts.push({ key: stage.key, receipt_present: false, file });
      continue;
    }
    const accepted = receipt.complete === true && ["PASS", "SKIPPED"].includes(receipt.status);
    if (!accepted) failed.push({ key: stage.key, status: receipt.status, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action });
    receipts.push({ key: stage.key, receipt_present: true, complete: accepted, status: receipt.status, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action, file });
  }
  return { receipts, missing, failed };
}

function readModuleReceipts({ auditRoot, tradeDate, dailyRunId, registry }) {
  const rows = [];
  const missing = [];
  const failed = [];
  const coreKeys = new Set(STAGES.map((stage) => stage.key));
  for (const module of (registry?.modules || []).filter((row) => !coreKeys.has(row.key) && row.receipt_required !== false && row.required !== false)) {
    const file = moduleReceiptFile(auditRoot, tradeDate, dailyRunId, module.key);
    const receipt = readJson(file, null);
    if (!receipt || receipt.daily_run_id !== dailyRunId || receipt.trade_date !== tradeDate || receipt.receipt_present !== true) {
      missing.push(module.key);
      rows.push({ key: module.key, receipt_present: false, status: "MISSING", reason_code: "module_receipt_missing", allowed_action: module.allowed_action, file });
      continue;
    }
    const accepted = receipt.complete === true && ["PASS", "SKIPPED"].includes(receipt.status);
    if (!accepted) failed.push({ key: module.key, status: receipt.status, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action });
    rows.push({ key: module.key, receipt_present: true, complete: accepted, status: receipt.status, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action, source_file: receipt.source_file, issues: receipt.issues || [], evidence: receipt.evidence || null, file });
  }
  return { rows, missing, failed };
}

function isNotDueFailure(row) {
  return row && (row.status === "NOT_DUE" || row.reason_code === "module_not_due");
}

function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const runtimeDir = argValue("--runtime-dir", defaultRuntimeDir());
  const registryFile = path.resolve(argValue("--registry", path.join(auditRoot, tradeDate, dailyRunId, "active-module-registry.json")));
  const registry = readJson(registryFile, null);
  const core = readCoreReceipts({ auditRoot, tradeDate, dailyRunId });
  const modules = readModuleReceipts({ auditRoot, tradeDate, dailyRunId, registry });
  const firstCore = core.missing[0] || core.failed[0]?.key || "";
  const firstModule = modules.missing[0] || modules.failed[0]?.key || "";
  const firstBlocker = firstCore || firstModule;
  const firstFailure = core.failed[0] || modules.failed[0] || null;
  const payload = {
    contract: "terminal-daily-manifest-v2",
    generated_at: new Date().toISOString(),
    daily_run_id: dailyRunId,
    trade_date: tradeDate,
    scope: registry?.scope || "full_unattended_final_audit",
    registry_file: registryFile,
    receipts: core.receipts,
    missing_receipts: core.missing,
    failed_stages: core.failed,
    module_receipts: modules.rows,
    missing_module_receipts: modules.missing,
    failed_modules: modules.failed,
    first_blocker: firstBlocker,
    reason_code: core.missing.length ? "stage_receipt_missing" : (core.failed.length ? core.failed[0].reason_code : (modules.missing.length ? "module_receipt_missing" : (firstFailure?.reason_code || "ok"))),
    allowed_action: core.missing.length ? "produce_required_stage_receipt_before_claiming_completion" : (core.failed.length ? core.failed[0].allowed_action : (modules.missing.length ? "produce_required_module_receipt_before_claiming_completion" : (firstFailure?.allowed_action || "none"))),
    ok: Boolean(registry?.ok === true && core.missing.length === 0 && core.failed.length === 0 && modules.missing.length === 0 && modules.failed.length === 0),
  };
  const coreFailedNotDue = core.failed.length > 0 && core.failed.every(isNotDueFailure);
  const modulesFailedNotDue = modules.failed.length === 0 || modules.failed.every(isNotDueFailure);
  const pendingNotDue = Boolean(
    registry?.ok === true
    && core.missing.length === 0
    && modules.missing.length === 0
    && (coreFailedNotDue || modules.failed.length > 0)
    && modulesFailedNotDue
  );
  payload.decision = payload.ok ? "YES" : (pendingNotDue ? "PENDING_NOT_DUE" : "NO");
  payload.pending_not_due = pendingNotDue;
  payload.unattended_status = payload.ok ? "YES" : "NO";
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  const file = path.join(runDir, "terminal-daily-manifest.json");
  const runtimeManifestFile = path.join(runtimeDir, "state", "terminal-daily-manifest.json");
  payload.runtime_file = runtimeManifestFile;
  writeJson(file, payload);
  writeJson(path.join(auditRoot, "terminal-daily-manifest-latest.json"), payload);
  writeJson(runtimeManifestFile, payload);
  fs.writeFileSync(path.join(runDir, "terminal-daily-manifest.md"), `# Terminal Daily Manifest\n\n- daily_run_id: ${dailyRunId}\n- trade_date: ${tradeDate}\n- unattended_status: ${payload.unattended_status}\n- first_blocker: ${payload.first_blocker || "none"}\n- reason_code: ${payload.reason_code}\n- missing_module_receipts: ${modules.missing.length}\n- failed_modules: ${modules.failed.length}\n`, "utf8");
  console.log(JSON.stringify({ ok: payload.ok, unattended_status: payload.unattended_status, daily_run_id: dailyRunId, trade_date: tradeDate, first_blocker: payload.first_blocker, reason_code: payload.reason_code, missing_module_receipts: modules.missing, failed_modules: modules.failed, output: file, runtime_output: runtimeManifestFile }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();




