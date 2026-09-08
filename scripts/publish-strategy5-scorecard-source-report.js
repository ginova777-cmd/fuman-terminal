#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readSnapshot, upsertSnapshot } = require("../lib/supabase-snapshots");

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_FILE = process.env.FUMAN_SCORECARD_SOURCE_FILE
  || path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");
const RECEIPT_FILE = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy5-scorecard-source-report.json");
const EXPECTED_RUN_ID = String(argValue("expected-run-id", process.env.FUMAN_SCORECARD_REFRESH_RUN_ID || process.env.EXPECTED_STRATEGY5_RUN_ID || "")).trim();
const EXPECTED_DATE = String(argValue("expected-date", process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || "")).replace(/\D/g, "").slice(0, 8);
const DRY_RUN = process.argv.includes("--dry-run");

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function numberValue(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function writeReceipt(payload) {
  fs.mkdirSync(path.dirname(RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(RECEIPT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function fail(reason, detail = {}) {
  const receipt = {
    ok: false,
    status: "blocked",
    contract: "strategy5-scorecard-source-report-v1",
    checkedAt: new Date().toISOString(),
    expectedRunId: EXPECTED_RUN_ID,
    expectedDate: EXPECTED_DATE,
    reason,
    ...detail,
  };
  writeReceipt(receipt);
  console.error(JSON.stringify(receipt, null, 2));
  process.exitCode = 1;
}

async function main() {
  if (!EXPECTED_RUN_ID || !/^strategy5-\d{8}-\d+$/.test(EXPECTED_RUN_ID)) {
    fail("expected_strategy5_run_id_missing_or_invalid");
    return;
  }
  const runDate = EXPECTED_RUN_ID.match(/^strategy5-(\d{8})-/)?.[1] || "";
  if (!EXPECTED_DATE || EXPECTED_DATE !== runDate) {
    fail("expected_date_run_id_mismatch", { runDate });
    return;
  }
  if (!fs.existsSync(SOURCE_FILE)) {
    fail("scorecard_terminal_current_missing", { sourceFile: SOURCE_FILE });
    return;
  }

  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const sourceRecords = Array.isArray(source.records) ? source.records : [];
  const sourceDate = compactDate(source.latestDate || source.summary?.latestDate);
  if (!sourceRecords.length) {
    fail("scorecard_terminal_source_missing_or_empty", { sourceFile: SOURCE_FILE });
    return;
  }
  if (sourceDate !== EXPECTED_DATE) {
    fail("scorecard_terminal_source_date_mismatch", {
      sourceFile: SOURCE_FILE,
      sourceDate,
      sourceRows: sourceRecords.length,
    });
    return;
  }
  const sourceReports = Array.isArray(source.sourceReports) ? source.sourceReports : [];
  const report = sourceReports.find((row) => String(row?.key || "").toLowerCase() === "strategy5");
  const reportRunId = String(report?.runId || "").trim();
  const resultCount = numberValue(report?.count ?? report?.resultCount);
  const reportDate = compactDate(report?.date || report?.tradeDate || source.latestDate);
  if (!report || report.ok !== true || reportRunId !== EXPECTED_RUN_ID || resultCount <= 0 || reportDate !== EXPECTED_DATE) {
    fail("strategy5_source_report_not_complete", {
      sourceFile: SOURCE_FILE,
      report: report || null,
      actualRunId: reportRunId,
      resultCount,
      reportDate,
    });
    return;
  }

  const current = await readSnapshot("scorecard_latest", { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  const currentPayload = current?.payload && typeof current.payload === "object" ? current.payload : null;
  const currentRecords = Array.isArray(currentPayload?.records) ? currentPayload.records : [];
  const currentDate = compactDate(currentPayload?.latestDate || current?.tradeDate);
  if (currentDate && currentDate > EXPECTED_DATE) {
    fail("scorecard_latest_date_rollback_disallowed", {
      currentDate,
      currentRows: currentRecords.length,
      sourceDate,
      sourceRows: sourceRecords.length,
    });
    return;
  }

  const now = new Date().toISOString();
  const normalizedReport = {
    ...report,
    ok: true,
    complete: true,
    status: "PASS",
    runId: EXPECTED_RUN_ID,
    date: `${EXPECTED_DATE.slice(0, 4)}-${EXPECTED_DATE.slice(4, 6)}-${EXPECTED_DATE.slice(6, 8)}`,
    tradeDate: `${EXPECTED_DATE.slice(0, 4)}-${EXPECTED_DATE.slice(4, 6)}-${EXPECTED_DATE.slice(6, 8)}`,
    sourceDate: `${EXPECTED_DATE.slice(0, 4)}-${EXPECTED_DATE.slice(4, 6)}-${EXPECTED_DATE.slice(6, 8)}`,
    count: resultCount,
    resultCount,
    publishAllowed: true,
    evidenceStatus: "complete",
    qualityStatus: "complete",
    collectedAt: now,
    scorecardUpdatedAt: now,
    source: "strategy5-complete-run:scorecard-terminal-current",
    collectionContract: "strategy5-scorecard-source-report-v1",
  };
  const previousReports = sourceReports;
  const mergedPayload = {
    ...source,
    updatedAt: now,
    sourceReports: [
      ...previousReports.filter((row) => String(row?.key || "").toLowerCase() !== "strategy5"),
      normalizedReport,
    ],
    strategy5SourceReportRefresh: {
      contract: "strategy5-scorecard-source-report-v1",
      runId: EXPECTED_RUN_ID,
      resultCount,
      updatedAt: now,
    },
  };

  let publish = { ok: true, dryRun: true, key: "scorecard_latest", tradeDate: EXPECTED_DATE };
  if (!DRY_RUN) {
    publish = await upsertSnapshot("scorecard_latest", mergedPayload, {
      tradeDate: EXPECTED_DATE,
      source: "strategy5-scorecard-source-report",
      reason: "strategy5-complete-run-source-report-refresh",
      timeoutMs: 120000,
    });
    if (!publish.ok) {
      fail("scorecard_latest_source_report_publish_failed", { publish });
      return;
    }
  }

  const receipt = {
    ok: true,
    status: DRY_RUN ? "dry_run" : "complete",
    contract: "strategy5-scorecard-source-report-v1",
    checkedAt: now,
    expectedRunId: EXPECTED_RUN_ID,
    expectedDate: EXPECTED_DATE,
    resultCount,
    sourceDate,
    sourceRowsPublished: sourceRecords.length,
    previousSnapshotDate: currentDate,
    previousSnapshotRows: currentRecords.length,
    dateAdvanced: Boolean(currentDate && currentDate < sourceDate),
    sourceReportsPreserved: previousReports.length,
    sourceFile: SOURCE_FILE,
    dryRun: DRY_RUN,
    publish,
  };
  writeReceipt(receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => fail("unexpected_error", { error: error?.stack || String(error) }));
