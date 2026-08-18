"use strict";

// Strategy2 V3 only accepts its own receipt and the Fugle deep-scan contract.
// It deliberately has no compatibility route to V2 snapshots or old views.
const fs = require("fs");
const path = require("path");

const ROOT = "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json");
const SCANNER = path.join(ROOT, "scripts", "run-strategy2-v3-water-scan.js");
const CONTRACT = "strategy2-v3-fugle-deep-scan-water-v1";

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail || "" });
}

function main() {
  const expectDate = (process.argv.find((value) => value.startsWith("--trade-date=")) || "").split("=")[1] || taipeiDate();
  const checks = [];
  const scanner = fs.readFileSync(SCANNER, "utf8");
  const receipt = JSON.parse(fs.readFileSync(RECEIPT, "utf8"));

  addCheck(checks, "scanner_has_v3_contract", scanner.includes(CONTRACT));
  addCheck(checks, "scanner_reads_priority_pool", scanner.includes('"fugle_daytrade_priority_pool"'));
  addCheck(checks, "scanner_reads_fugle_quotes", scanner.includes("readFugleWebSocketQuotes") && scanner.includes("fugle_daytrade_websocket_cache"));
  addCheck(checks, "scanner_reads_formal_1m", scanner.includes("readFugleWebSocketCandles") && scanner.includes("fugle_daytrade_websocket_cache"));
  addCheck(checks, "scanner_rejects_old_view_queries", !/readRows\(source,\s*["']v_fugle_daytrade_mother_pool/i.test(scanner));
  addCheck(checks, "scanner_has_no_top40_gate", scanner.includes("noTop40Gate: true"));
  addCheck(checks, "scanner_has_no_previous_good_fallback", scanner.includes("noPreviousGoodFallback: true"));

  addCheck(checks, "receipt_is_v3", receipt.version === "v3" && receipt.strategy === "strategy2");
  addCheck(checks, "receipt_has_expected_contract", receipt.strategyContract === CONTRACT);
  addCheck(checks, "receipt_has_target_trade_date", receipt.dataDate === expectDate && receipt.tradeDate === expectDate, `${receipt.dataDate || "missing"} / ${expectDate}`);
  addCheck(checks, "receipt_completed_water_check", receipt.ok === true && receipt.complete === true, receipt.status);
  addCheck(checks, "all_deep_scan_symbols_read", asNumber(receipt.expectedCount) > 0 && asNumber(receipt.scannedCount) === asNumber(receipt.expectedCount), `${receipt.scannedCount}/${receipt.expectedCount}`);
  addCheck(checks, "no_data_gap", asNumber(receipt.dataGapCount) === 0, String(receipt.dataGapCount));
  addCheck(checks, "no_formal_candidate_before_rules", receipt.publishAllowed === false && receipt.formalDisplayAllowed === false && asNumber(receipt.resultCount) === 0, receipt.reason);
  addCheck(checks, "receipt_declares_new_only_routes", receipt.sourceCoverage?.noLegacyReadbackViews === true && receipt.sourceCoverage?.noTop40Gate === true && receipt.sourceCoverage?.noPreviousGoodFallback === true);

  const rows = Array.isArray(receipt.records) ? receipt.records : [];
  addCheck(checks, "record_count_matches_scan", rows.length === asNumber(receipt.scannedCount), `${rows.length}/${receipt.scannedCount}`);
  addCheck(checks, "every_record_has_formal_quote_and_1m", rows.every((row) => row.formalQuoteReady === true && row.formalOneMinuteReady === true && /^fugle/i.test(String(row.quoteSource || "")) && asNumber(row.candleCount) >= 35));
  addCheck(checks, "every_record_has_today_source_evidence", rows.every((row) => String(row.sourceRunId || "") && String(row.firstCandleTime || "").startsWith(expectDate) && String(row.lastCandleTime || "").startsWith(expectDate)));

  const failures = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failures.length === 0,
    status: failures.length === 0 ? "YES" : "NO",
    strategy: "strategy2",
    version: "v3",
    contract: CONTRACT,
    checkedAt: new Date().toISOString(),
    tradeDate: expectDate,
    runId: receipt.runId || "",
    expectedCount: receipt.expectedCount || 0,
    scannedCount: receipt.scannedCount || 0,
    dataGapCount: receipt.dataGapCount || 0,
    first_blocker: failures[0]?.name || null,
    checks,
  }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
}

main();
