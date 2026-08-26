"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT = process.env.FUMAN_CHIP_SOURCE_SYNC_RECEIPT
  || path.join(RUNTIME_DIR, "data", "scan-receipts", "chip-source-sync.json");

function taipeiDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function main() {
  const issues = [];
  let receipt = null;
  try {
    receipt = JSON.parse(fs.readFileSync(RECEIPT, "utf8"));
  } catch (error) {
    issues.push(`receipt_unreadable:${error?.message || String(error)}`);
  }

  const today = taipeiDateKey();
  const finishedDate = taipeiDateKey(receipt?.finishedAt);
  if (finishedDate !== today) issues.push(`receipt_not_today:${finishedDate || "missing"}:${today}`);
  if (String(receipt?.status || "").toLowerCase() !== "complete") {
    issues.push(`receipt_status_not_complete:${receipt?.status || "missing"}`);
  }
  if (Number(receipt?.exitCode) !== 0) issues.push(`receipt_exit_nonzero:${receipt?.exitCode ?? "missing"}`);
  if (receipt?.complete !== true) issues.push("receipt_complete_not_true");
  if (String(receipt?.source || "") !== "finmind-first-official-gap-fill") {
    issues.push(`receipt_source_mismatch:${receipt?.source || "missing"}`);
  }

  const report = {
    ok: issues.length === 0,
    contract: "fuman-chip-source-sync-receipt-v1",
    checkedAt: new Date().toISOString(),
    tradeDate: today,
    receiptFile: RECEIPT,
    receipt: receipt ? {
      startedAt: receipt.startedAt || "",
      finishedAt: receipt.finishedAt || "",
      status: receipt.status || "",
      exitCode: receipt.exitCode ?? null,
      complete: receipt.complete === true,
      source: receipt.source || "",
      warnings: Array.isArray(receipt.warnings) ? receipt.warnings : [],
      log: receipt.log || "",
    } : null,
    issues,
    readOnly: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
