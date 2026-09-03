"use strict";
const fs = require("fs"), path = require("path");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const root = path.resolve(__dirname, "..");
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const key = date.replace(/\D/g, "");
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const sourceFile = path.join(runtime, "data", "scan-receipts", "chip-source-sync.json");
const scanFile = path.join(runtime, "data", "scan-receipts", "strategy5.json");
const source = read(sourceFile), scan = read(scanFile);
const auditFile = scan?.runId ? path.join(runtime, "outputs", "post-scan-tri-surface", "strategy5", scan.runId, "terminal-resource-chain-audit.json") : "";
const audit = auditFile ? read(auditFile) : null;
const issues = [];
for (const retired of ["run-strategy5-battle-verify.ps1", "scripts/verify-strategy5-battle-state.js", "scripts/verify-strategy5-alert-path.js"]) {
  if (fs.existsSync(path.join(root, retired))) issues.push(`retired_verifier_returned:${retired}`);
}
if (source?.complete !== true || source?.status !== "complete" || Number(source?.exitCode) !== 0) issues.push("chip_source_sync_not_complete");
if (scan?.complete !== true || scan?.status !== "complete" || Number(scan?.exitCode) !== 0) issues.push("strategy5_scan_not_complete");
if (!String(scan?.runId || "").includes(key)) issues.push("strategy5_run_not_today");
if (Number(scan?.matches || 0) <= 0) issues.push("strategy5_result_empty");
if (audit?.ok !== true) issues.push("strategy5_tri_surface_not_complete");
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "strategy5", tradeDate: date,
  checkedAt: new Date().toISOString(), status: issues.length ? "failed" : "complete", complete: issues.length === 0,
  exitCode: issues.length ? 1 : 0, runId: scan?.runId || "", count: Number(scan?.matches || 0),
  sourceReceipt: sourceFile, scanReceipt: scanFile, triSurfaceEvidence: auditFile, issues };
const out = path.join(runtime, "data", "scan-receipts", "strategy5-complete.json");
if (process.argv.includes("--write-receipt")) fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
console.log(JSON.stringify({ ...payload, receiptPath: out, readOnly: !process.argv.includes("--write-receipt") }, null, 2));
process.exitCode = payload.complete ? 0 : 1;
