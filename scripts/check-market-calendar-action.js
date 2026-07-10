"use strict";

const fs = require("fs");
const path = require("path");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((item) => item === name || item.startsWith(prefix));
  if (!found) return fallback;
  if (found === name) return "1";
  return found.slice(prefix.length);
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return new Date();
  if (/^\d{8}$/.test(text)) return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00+08:00`);
  return new Date(text);
}

function safeName(value) {
  return String(value || "runner").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "runner";
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const stateDir = process.env.FUMAN_STATE_DIR || path.join(runtimeDir, "state");
  const dataDir = process.env.FUMAN_DATA_DIR || path.join(runtimeDir, "data");
  const label = argValue("--label", process.env.FUMAN_RUNNER_LABEL || "runner");
  const date = parseDate(argValue("--date", process.env.FUMAN_MARKET_CALENDAR_DATE || ""));
  const receipt = argValue("--receipt", "") === "1";
  const contract = await buildMarketCalendarContract({ now: date, stateDir });
  const payload = {
    ok: true,
    runner: label,
    label,
    checkedAt: new Date().toISOString(),
    action: contract.marketOpen ? "allow_formal_scan" : "skip_formal_scan",
    marketOpen: contract.marketOpen,
    marketStatus: contract.marketStatus,
    marketDate: contract.marketDate,
    requestedDate: contract.requestedDate,
    displayTradeDate: contract.displayTradeDate,
    closedReason: contract.closedReason,
    closedReasonText: contract.closedReasonText,
    formalScanSkipped: contract.formalScanSkipped,
    sourceFreshnessRequired: contract.sourceFreshnessRequired,
    preservePreviousGood: contract.preservePreviousGood,
    latestPointerUpdated: contract.latestPointerUpdated,
    emptyResultWritten: contract.emptyResultWritten,
    scannerAction: contract.scannerAction,
    resumePolicy: contract.resumePolicy,
    tradingDay: contract.tradingDay,
  };

  if (!contract.marketOpen && receipt) {
    const receiptPayload = {
      ...payload,
      status: "complete",
      exitCode: 0,
      complete: true,
      qualityStatus: "market_closed_previous_good",
      evidenceStatus: "market_closed",
      unattendedStatus: "YES",
      warnings: [`market closed: ${contract.closedReasonText || contract.closedReason}`],
      blockingReason: "market_closed",
      noLatestWritesWhenBlocked: true,
      previousGoodPreserved: true,
    };
    const receiptDir = path.join(dataDir, "scan-receipts");
    writeJson(path.join(receiptDir, `market-closed-${safeName(label)}.json`), receiptPayload);
  }

  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = contract.marketOpen ? 0 : 10;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    action: "fail_closed",
    status: "failed",
    reason: error?.message || String(error),
    preservePreviousGood: true,
    latestPointerUpdated: false,
    emptyResultWritten: false,
  }, null, 2));
  process.exit(1);
});
