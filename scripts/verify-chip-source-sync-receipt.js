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
  if (String(receipt?.payloadPath || "") !== "supabase:finmind_institutional_flows,finmind_margin_short,v_chip_flows_latest") {
    issues.push(`receipt_payload_path_mismatch:${receipt?.payloadPath || "missing"}`);
  }
  const health = receipt?.healthEvidence || null;
  const healthDate = health?.checkedAt ? taipeiDateKey(health.checkedAt) : "";
  if (!health || healthDate !== today) issues.push(`health_evidence_not_today:${healthDate || "missing"}:${today}`);
  if (health?.ok !== true) issues.push("health_evidence_not_ok");
  const healthTradeDate = String(health?.tradeDate || "").replace(/\D/g, "");
  const todayCompact = today.replace(/\D/g, "");
  if (healthTradeDate !== todayCompact) issues.push(`health_trade_date_mismatch:${healthTradeDate || "missing"}:${todayCompact}`);
  const ageChecks = [
    ["latest", health?.latestAgeDays, health?.maxAgeDays],
    ["institutional", health?.institutionalAgeDays, health?.maxAgeDays],
    ["margin", health?.marginAgeDays, health?.marginMaxAgeDays],
  ];
  for (const [label, age, maximum] of ageChecks) {
    if (!Number.isFinite(Number(age)) || !Number.isFinite(Number(maximum)) || Number(age) < 0 || Number(age) > Number(maximum)) {
      issues.push(`${label}_trade_date_age_invalid:${age ?? "missing"}:${maximum ?? "missing"}`);
    }
  }
  if (!health?.institutionalTradeDate) issues.push("institutional_trade_date_missing");
  if (!health?.marginTradeDate) issues.push("margin_trade_date_missing");
  if (!health?.unifiedTradeDate) issues.push("unified_trade_date_missing");
  if (Number(health?.health?.institutional_rows || 0) <= 0) issues.push("institutional_rows_not_positive");
  if (Number(health?.health?.margin_rows || 0) <= 0) issues.push("margin_rows_not_positive");
  if (Number(health?.health?.unified_rows || 0) <= 0) issues.push("unified_rows_not_positive");
  const sourceRows = Array.isArray(health?.chipLatest) ? health.chipLatest : [];
  if (!sourceRows.length || sourceRows.some((row) => !String(row?.source || "").trim())) issues.push("chip_latest_sources_missing");

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
      payloadPath: receipt.payloadPath || "",
      healthEvidence: receipt.healthEvidence || null,
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
