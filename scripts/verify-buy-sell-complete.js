"use strict";
const fs = require("fs");
const path = require("path");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const root = path.resolve(__dirname, "..");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const key = today.replace(/\D/g, "");
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const institutionFile = path.join(runtime, "data", "scan-receipts", "institution.json");
const e2eFile = path.join(root, "outputs", "institution-e2e-closure", "institution-e2e-closure.json");
const sourceFile = path.join(runtime, "data", "scan-receipts", "chip-source-sync.json");
const out = path.join(runtime, "data", "scan-receipts", "buy-sell-complete.json");
const institution = read(institutionFile);
const e2e = read(e2eFile);
const source = read(sourceFile);
const issues = [];
if (source?.complete !== true || source?.status !== "complete" || Number(source?.exitCode) !== 0) issues.push("chip_source_sync_not_complete");
if (institution?.complete !== true || institution?.status !== "complete" || Number(institution?.exitCode) !== 0) issues.push("institution_receipt_not_complete");
if (!String(institution?.runId || "").includes(key)) issues.push("institution_run_not_today");
if (Number(institution?.matches || 0) <= 0) issues.push("institution_result_empty");
if (institution?.publishAllowed !== true || institution?.evidenceStatus !== "complete" || institution?.unattendedStatus !== "YES") issues.push("institution_publish_contract_not_complete");
if (e2e?.ok !== true) issues.push("institution_e2e_not_complete");
if ((e2e?.expectedRunId || e2e?.runId) !== institution?.runId) issues.push("institution_e2e_runid_mismatch");
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "institution", label: "買賣超",
  checkedAt: new Date().toISOString(), tradeDate: today, status: issues.length ? "failed" : "complete",
  complete: issues.length === 0, exitCode: issues.length ? 1 : 0, runId: institution?.runId || "",
  count: Number(institution?.matches || 0), sourceReceipt: sourceFile, institutionReceipt: institutionFile,
  e2eReceipt: e2eFile, verifier: "scripts/verify-buy-sell-complete.js", issues };
if (process.argv.includes("--write-receipt")) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8"); }
console.log(JSON.stringify({ ...payload, receiptPath: out, readOnly: !process.argv.includes("--write-receipt") }, null, 2));
process.exitCode = payload.complete ? 0 : 1;
