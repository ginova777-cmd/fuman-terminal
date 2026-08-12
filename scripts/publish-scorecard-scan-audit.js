"use strict";

const fs = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { buildScanAudit } = require("../lib/scorecard-scan-audit");

const ROOT = path.resolve(__dirname, "..");
const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const output = path.join(runtimeDir, "data", "scorecard-scan-audit-latest.json");

async function main() {
  const payload = buildScanAudit({ runtimeDir });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const result = await upsertSnapshot("scorecard_scan_audit_latest", payload, {
    tradeDate: payload.marketDate.replace(/-/g, ""),
    source: "terminal-scan-receipt-audit",
    reason: "receipt-completion-audit",
    snapshotId: `scan-audit-${payload.marketDate.replace(/-/g, "")}-${Date.now()}`,
    timeoutMs: 30000,
  });
  if (!result?.ok) throw new Error(result?.reason || "scan_audit_snapshot_publish_failed");
  console.log(JSON.stringify({ ok: true, marketDate: payload.marketDate, qualityStatus: payload.qualityStatus, modules: payload.modules.map((row) => ({ key: row.key, status: row.status })) }));
}

main().catch((error) => {
  console.error(`[publish-scorecard-scan-audit] failed: ${error?.message || error}`);
  process.exit(1);
});
