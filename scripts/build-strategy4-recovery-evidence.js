"use strict";

const fs = require("fs");
const path = require("path");

const runtimeRoot = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const runId = String(process.argv.find((arg) => arg.startsWith("--run-id=")) || "").split("=")[1] || "";
if (!/^strategy4-\d{8}-\d{14}$/.test(runId)) throw new Error("invalid_strategy4_recovery_run_id");
const date = runId.match(/^strategy4-(\d{8})-/)[1];
const auditFile = path.join(runtimeRoot, "outputs", "post-scan-tri-surface", "strategy4", runId, "terminal-resource-chain-audit.json");
const surfaceFile = path.join(runtimeRoot, "data", "scan-receipts", `scorecard88-surface-evidence-${date}-1700.json`);
const outputFile = path.join(runtimeRoot, "data", "scan-receipts", "strategy4-recovery-evidence.json");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const audit = read(auditFile);
const row = (audit.results || []).find((item) => item.key === "strategy4");
const surface = (read(surfaceFile).rows || []).find((item) => item.key === "strategy4");
const allowedIssues = (row?.issues || []).every((issue) => String(issue).startsWith("scorecard /88 row/sourceReport runId != latest pointer"));
const valid = row?.supabase?.ok === true
  && row.supabase.runId === runId
  && row.supabase.scannedCount === row.supabase.expectedTotal
  && row.supabase.count > 0
  && row.desktopSnapshot?.runId === runId
  && row.mobileFragment?.runId === runId
  && surface?.ok === true
  && surface.desktopRunId === runId
  && surface.mobileRunId === runId
  && allowedIssues;
if (!valid) throw new Error("strategy4_recovery_evidence_not_strictly_valid");
const payload = {
  ok: true, complete: true, status: "PASS", contract: "strategy4-scorecard88-recovery-evidence-v1",
  runId, tradeDate: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,
  expectedTotal: row.supabase.expectedTotal, scannedCount: row.supabase.scannedCount,
  resultCount: row.supabase.count, count: row.supabase.count,
  qualityStatus: row.supabase.qualityStatus || "complete", evidenceStatus: "complete",
  fallbackUsed: false, publishAllowed: true, desktopStatus: "PASS", mobileStatus: "PASS",
  desktopRunId: runId, mobileRunId: runId, checkedAt: new Date().toISOString(),
  source: "strict-tri-surface-audit+authenticated-surface-evidence", auditFile, surfaceFile,
};
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, outputFile, runId, count: payload.count }));
