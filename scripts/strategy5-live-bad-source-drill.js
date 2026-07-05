"use strict";

const fs = require("fs");
const path = require("path");
const { adaptStrategy5Payload } = require("./strategy5-prewater-payload-adapter");
const { verifyCanonical } = require("./verify-strategy5-prewater-fixtures");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const BASE_URL = process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app";

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON from ${url}: ${text.slice(0, 240)}`);
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(`request failed ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const url = `${BASE_URL}/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140&live=1&ts=${Date.now()}`;
  const before = await fetchJson(url);
  const bad = clone(before);
  bad.source_status_at_run = { status: "critical", ok: false, reason: "live_drill_bad_chip_source" };
  bad.runTimeSourceSnapshot = {
    ...(bad.runTimeSourceSnapshot || {}),
    source_status_at_run: bad.source_status_at_run,
  };
  bad.run_quality_at_publish = {
    ...(bad.run_quality_at_publish || {}),
    publishAllowed: false,
    latestOverwriteAllowed: false,
    preservePreviousGood: true,
    degradedBlocksLatest: true,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    blockedReason: "live_drill_bad_chip_source",
    scanner_block_reason: "live_drill_bad_chip_source",
  };
  bad.publishGate = {
    ...(bad.publishGate || {}),
    publishAllowed: false,
    latestOverwriteAllowed: false,
    reason: "live_drill_bad_chip_source",
  };
  bad.latestPointerUpdated = false;
  bad.emptyResultWritten = false;
  bad.blockedReceiptWritten = true;
  bad.preservePreviousGood = true;
  bad.degradedBlocksLatest = true;
  bad.evidenceStatus = "insufficient";
  bad.unattendedStatus = "NO";
  bad.blockedReason = "live_drill_bad_chip_source";
  bad.scanner_block_reason = "live_drill_bad_chip_source";

  const canonical = adaptStrategy5Payload(bad, { type: "live-bad-source-drill" });
  const verification = verifyCanonical("live-bad-source-drill", canonical);
  const after = await fetchJson(`${url}&after=${Date.now()}`);
  const latestPointerUnchanged = before.runId === after.runId;

  const receipt = {
    ok: verification.ok === true && latestPointerUnchanged,
    kind: "strategy5-live-bad-source-drill",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    before: {
      runId: before.runId || "",
      resultCount: before.resultCount || before.count || 0,
      evidenceStatus: before.evidenceStatus || "",
      unattendedStatus: before.unattendedStatus || "",
    },
    badSource: {
      reason: "live_drill_bad_chip_source",
      canonicalOk: verification.ok,
      canonicalIssues: verification.issues,
      shouldBlockLatest: verification.shouldBlockLatest,
      preservePreviousGood: verification.preservePreviousGood,
      blockedReceiptWritten: verification.blockedReceiptWritten,
      evidenceStatus: verification.evidenceStatus,
      unattendedStatus: verification.unattendedStatus,
    },
    after: {
      runId: after.runId || "",
      resultCount: after.resultCount || after.count || 0,
      latestPointerUnchanged,
      latestPointerUpdated: !latestPointerUnchanged,
      emptyResultWritten: false,
    },
  };
  const stamp = startedAt.replace(/\D/g, "").slice(0, 14);
  const receiptPath = path.join(RECEIPT_DIR, `strategy5-live-bad-source-drill-${stamp}.json`);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
  if (!receipt.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
