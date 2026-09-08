"use strict";
const fs = require("fs"), path = require("path");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const root = path.resolve(__dirname, "..");
const requestedDate = String(process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || process.env.FUMAN_TERMINAL_TARGET_TRADE_DATE || process.env.FUMAN_EXPECTED_DATE || "").replace(/\D/g, "").slice(0, 8);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const date = requestedDate.length === 8 ? `${requestedDate.slice(0, 4)}-${requestedDate.slice(4, 6)}-${requestedDate.slice(6, 8)}` : today;
const key = date.replace(/\D/g, "");
const read = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const sourceFile = path.join(runtime, "data", "scan-receipts", "chip-source-sync.json");
const scanFile = path.join(runtime, "data", "scan-receipts", "strategy5.json");
const source = read(sourceFile), scan = read(scanFile);
const readText = file => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const runnerSource = readText(path.join(root, "run-strategy5.ps1"));
const publisherSource = readText(path.join(root, "scripts", "publish-strategy5-scorecard-source-report.js"));
const watchdogSource = readText(path.join(root, "run-strategy5-watchdog.ps1"));
const protectedReaderSource = readText(path.join(root, "scripts", "read-protected-production-api.js"));
const auditFile = scan?.runId ? path.join(runtime, "outputs", "post-scan-tri-surface", "strategy5", scan.runId, "terminal-resource-chain-audit.json") : "";
const audit = auditFile ? read(auditFile) : null;
const issues = [];
if (!runnerSource.includes('"--expected-run-id=$([string]$verifiedPayload.runId)"')
  || !runnerSource.includes('"--expected-date=$strategy5ExpectedDate"')) issues.push("strategy5_scorecard_publisher_args_missing");
if (!publisherSource.includes('argValue("expected-run-id"')
  || !publisherSource.includes('argValue("expected-date"')) issues.push("strategy5_scorecard_publisher_arg_contract_missing");
if (!publisherSource.includes("const sourceRecords = Array.isArray(source.records)")
  || !publisherSource.includes("const sourceDate = compactDate(source.latestDate")
  || !publisherSource.includes("...source,")
  || !publisherSource.includes("scorecard_latest_date_rollback_disallowed")
  || publisherSource.includes("if (currentDate !== EXPECTED_DATE)")) issues.push("strategy5_scorecard_date_advance_contract_missing");
if (!watchdogSource.includes('"--summary-fields=runId,complete,count,updatedAt"')
  || !protectedReaderSource.includes('arg("summary-fields")')) issues.push("strategy5_watchdog_compact_json_contract_missing");
for (const retired of ["run-strategy5-battle-verify.ps1", "scripts/verify-strategy5-battle-state.js", "scripts/verify-strategy5-alert-path.js"]) {
  if (fs.existsSync(path.join(root, retired))) issues.push(`retired_verifier_returned:${retired}`);
}
if (source?.complete !== true || source?.status !== "complete" || Number(source?.exitCode) !== 0) issues.push("chip_source_sync_not_complete");
if (source?.fallback === true) issues.push("chip_source_fallback_disallowed");
if (Array.isArray(source?.warnings) && source.warnings.length > 0) issues.push("chip_source_warnings_not_empty");
if (String(source?.blockingReason || "").trim()) issues.push("chip_source_blocking_reason_not_empty");
if (scan?.complete !== true || scan?.status !== "complete" || Number(scan?.exitCode) !== 0) issues.push("strategy5_scan_not_complete");
if (!String(scan?.runId || "").includes(key)) issues.push("strategy5_run_not_target_date");
if (String(scan?.marketDate || "").replace(/\D/g, "") !== key) issues.push("strategy5_receipt_market_date_mismatch");
if (Number(scan?.scanned || 0) <= 0 || Number(scan?.total || 0) <= 0 || Number(scan?.scanned || 0) !== Number(scan?.total || 0)) issues.push("strategy5_scan_coverage_incomplete");
if (Number(scan?.matches || 0) <= 0) issues.push("strategy5_result_empty");
if (scan?.fallback === true) issues.push("strategy5_fallback_disallowed");
if (Array.isArray(scan?.warnings) && scan.warnings.length > 0) issues.push("strategy5_warnings_not_empty");
if (String(scan?.blockingReason || "").trim()) issues.push("strategy5_blocking_reason_not_empty");
if (scan?.triSurfaceStatus !== "complete") issues.push("strategy5_receipt_tri_surface_not_complete");
for (const field of ["desktopRunId", "mobileRunId", "scorecardRunId"]) {
  if (String(scan?.[field] || "") !== String(scan?.runId || "")) issues.push(`strategy5_${field}_mismatch`);
}
if (audit?.ok !== true) issues.push("strategy5_tri_surface_not_complete");
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "strategy5", tradeDate: date,
  checkedAt: new Date().toISOString(), status: issues.length ? "failed" : "complete", complete: issues.length === 0,
  exitCode: issues.length ? 1 : 0, runId: scan?.runId || "", count: Number(scan?.matches || 0),
  scanned: Number(scan?.scanned || 0), total: Number(scan?.total || 0), triSurfaceStatus: scan?.triSurfaceStatus || "",
  desktopRunId: scan?.desktopRunId || "", mobileRunId: scan?.mobileRunId || "", scorecardRunId: scan?.scorecardRunId || "",
  sourceReceipt: sourceFile, scanReceipt: scanFile, triSurfaceEvidence: auditFile, issues };
const out = path.join(runtime, "data", "scan-receipts", "strategy5-complete.json");
if (process.argv.includes("--write-receipt")) fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
console.log(JSON.stringify({ ...payload, receiptPath: out, readOnly: !process.argv.includes("--write-receipt") }, null, 2));
process.exitCode = payload.complete ? 0 : 1;
