"use strict";

const fs = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { terminalSnapshotPayload } = require("./run-strategy2-v3-live-scan");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_FILE = path.join(RUNTIME_DIR, "data", "strategy2-v3", "latest-live.json");
const RECEIPT_FILE = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-blocked-evidence-migration.json");
const SNAPSHOT_KEY = "strategy2_live_v3";
const CONTRACT = "strategy2-live-v3-fugle-deep-scan-1m";

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function writeReceipt(payload) {
  fs.mkdirSync(path.dirname(RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(RECEIPT_FILE, JSON.stringify(payload, null, 2));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const date = String(source.dataDate || source.tradeDate || source.date || "");
  const valid = source.strategyContract === CONTRACT
    && source.version === "v3"
    && source.status === "blocked"
    && source.complete === false
    && source.formalDisplayAllowed === false
    && source.publishAllowed === false
    && source.fallbackUsed !== true
    && source.preservePreviousGood !== true
    && date === taipeiDate()
    && String(source.runId || "").startsWith("strategy2-v3-live-");
  if (!valid) throw new Error("blocked_evidence_source_not_eligible");

  const snapshot = terminalSnapshotPayload(source);
  const result = dryRun ? { ok: true, dryRun: true, skippedWrite: true } : await upsertSnapshot(SNAPSHOT_KEY, snapshot, {
    tradeDate: date.replace(/-/g, ""),
    snapshotId: source.runId,
    source: "strategy2-v3-existing-blocked-evidence-migration",
    reason: source.reason || "strategy2_v3_blocked_evidence",
    timeoutMs: 20000,
  });
  const receipt = {
    ok: result.ok !== false,
    contract: "strategy2-v3-existing-blocked-evidence-migration-v1",
    migratedWithoutScan: true,
    dryRun,
    createdNewRun: false,
    runId: source.runId,
    tradeDate: date,
    expectedCount: Number(source.expectedCount || 0),
    scannedCount: Number(source.scannedCount || 0),
    resultCount: Number(source.resultCount || 0),
    dataGapCount: Number(source.dataGapCount || 0),
    complete: false,
    formalDisplayAllowed: false,
    publishAllowed: false,
    reason: source.reason || "",
    snapshot: result,
    finishedAt: new Date().toISOString(),
  };
  writeReceipt(receipt);
  if (result.ok === false) throw new Error(result.error || result.reason || "blocked_evidence_snapshot_write_failed");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  writeReceipt({ ok: false, contract: "strategy2-v3-existing-blocked-evidence-migration-v1", migratedWithoutScan: true, createdNewRun: false, error: error.message, finishedAt: new Date().toISOString() });
  console.error(error.message);
  process.exitCode = 1;
});
