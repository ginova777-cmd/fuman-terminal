"use strict";

const path = require("path");
const {
  RUNTIME_DIR,
  STRATEGY,
  MOTHER_POOL_CONTRACT_VERSION,
  MOTHER_POOL_VIEW,
  MOTHER_POOL_RECEIPT_VIEW,
  QUOTE_TABLE,
  INTRADAY_1M_RPC,
  MIN_CANDLES_PER_SYMBOL,
  MIN_MOTHER_POOL_COVERAGE_RATIO,
  taipeiDate,
  scanReceiptPath,
  readJson,
  writeJson,
} = require("./strategy3-v2-contract");
const { readCanonicalDaytradeWater } = require("../lib/daytrade-canonical-water-reader");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
const recoveryReplay = process.argv.includes("--recovery-replay");
const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-water-universe-${compactDate}${recoveryReplay ? "-recovery-replay" : ""}.json`);

function add(issues, condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

async function main() {
  const scanPath = recoveryReplay
    ? path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-recovery-replay-${compactDate}.json`)
    : scanReceiptPath(compactDate);
  const scan = readJson(scanPath, null);
  const water = await readCanonicalDaytradeWater({
    tradeDate,
    consumerName: STRATEGY,
    strategy3Consumer: true,
    requireMarketCalendar: true,
    requireMotherPoolReceipt: !recoveryReplay,
    hydrateMotherPoolCandles: true,
    minimumCandlesPerSymbol: MIN_CANDLES_PER_SYMBOL,
    barsPerSymbol: recoveryReplay ? 40 : 20,
    historicalRecoveryReplay: recoveryReplay,
  });
  const issues = [];
  const expectedCount = water.poolBySymbol.size;
  const readyCount = [...water.candleRowsBySymbol.entries()]
    .filter(([symbol, rows]) => rows.length >= MIN_CANDLES_PER_SYMBOL && !water.symbolDataGaps.has(symbol))
    .length;
  const requiredReadyCount = Math.ceil(expectedCount * MIN_MOTHER_POOL_COVERAGE_RATIO);
  const coverageRatio = expectedCount ? readyCount / expectedCount : 0;
  const resultCount = Number(scan?.result_count || 0);
  const expectedScannerSource = `${MOTHER_POOL_VIEW}+${QUOTE_TABLE}+rpc:${INTRADAY_1M_RPC}`;

  add(issues, Boolean(scan), "strategy3_v2_scan_receipt_missing", { path: scanPath });
  add(issues, scan?.ok === true && scan?.status === (recoveryReplay ? "RECOVERY_REPLAY_COMPLETE" : "COMPLETE"), "strategy3_v2_scan_not_complete", { status: scan?.status, ok: scan?.ok });
  add(issues, scan?.apply === true, "strategy3_v2_scan_not_applied", { apply: scan?.apply });
  add(issues, scan?.trade_date === tradeDate, "strategy3_v2_scan_trade_date_mismatch", { value: scan?.trade_date });
  add(issues, String(scan?.run_id || "").startsWith(recoveryReplay ? `strategy3v2-recovery-replay-${compactDate}-` : `strategy3v2-${compactDate}-`), "strategy3_v2_scan_run_id_invalid", { value: scan?.run_id });
  add(issues, scan?.scanner_source === expectedScannerSource, "strategy3_v2_scanner_source_not_v4_1", { value: scan?.scanner_source });
  add(issues, water.ok === true, "strategy3_v2_mother_pool_v4_1_readback_failed", { firstBlocker: water.firstBlocker, failedChecks: water.failedChecks });
  add(issues, water.receipt?.contract_version === MOTHER_POOL_CONTRACT_VERSION, "strategy3_v2_mother_pool_contract_version_mismatch", { value: water.receipt?.contract_version });
  add(issues, water.receipt?.trade_date === tradeDate, "strategy3_v2_mother_pool_trade_date_mismatch", { value: water.receipt?.trade_date });
  add(issues, water.receipt?.receipt_incomplete !== true, "strategy3_v2_mother_pool_receipt_incomplete");
  add(issues, water.receipt?.global_formal_gate_blocked !== true, "strategy3_v2_global_formal_gate_blocked");
  add(issues, expectedCount > 0, "strategy3_v2_mother_pool_empty");
  add(issues, coverageRatio >= MIN_MOTHER_POOL_COVERAGE_RATIO, "strategy3_v2_mother_pool_v4_1_usable_1m_coverage_below_90_percent", { readyCount, expectedCount, coverageRatio });
  add(issues, Number(scan?.mother_pool_rows || 0) === expectedCount, "strategy3_v2_runner_verifier_mother_pool_count_mismatch", { runner: scan?.mother_pool_rows, verifier: expectedCount });
  add(issues, scan?.canonical_run_id === water.receipt?.canonical_run_id, "strategy3_v2_runner_verifier_canonical_run_id_mismatch", { runner: scan?.canonical_run_id, verifier: water.receipt?.canonical_run_id });
  add(issues, Array.isArray(scan?.results) && scan.results.length === resultCount, "strategy3_v2_runner_receipt_result_count_mismatch", { resultCount, rows: scan?.results?.length });
  for (const row of scan?.results || []) {
    add(issues, row.contract_version === MOTHER_POOL_CONTRACT_VERSION, "strategy3_v2_result_contract_version_mismatch", { symbol: row.symbol, value: row.contract_version });
    add(issues, row.trade_date === tradeDate, "strategy3_v2_result_trade_date_mismatch", { symbol: row.symbol, value: row.trade_date });
    add(issues, row.canonical_run_id === water.receipt?.canonical_run_id, "strategy3_v2_result_canonical_run_id_mismatch", { symbol: row.symbol, value: row.canonical_run_id });
    add(issues, water.poolBySymbol.has(row.symbol), "strategy3_v2_result_not_in_mother_pool_v4_1", { symbol: row.symbol });
    add(issues, !water.symbolDataGaps.has(row.symbol), "strategy3_v2_result_has_symbol_data_gap", { symbol: row.symbol, gaps: water.symbolDataGaps.get(row.symbol) });
  }

  const firstBlocker = issues[0]?.code || null;
  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "STRATEGY3_V2_WATER_UNIVERSE_READY" : "STRATEGY3_V2_WATER_UNIVERSE_NOT_READY",
    contract: "strategy3-v2-mother-pool-v4-1-verifier-v1",
    checked_at: new Date().toISOString(),
    trade_date: tradeDate,
    strategy: STRATEGY,
    run_id: scan?.run_id || null,
    canonical_run_id: water.receipt?.canonical_run_id || null,
    result_count: resultCount,
    first_blocker: firstBlocker,
    reason_code: firstBlocker || "strategy3_v2_mother_pool_v4_1_verified",
    consumer_name: STRATEGY,
    consumer_commit: water.receipt?.consumer_commit || "unknown",
    contract_version: MOTHER_POOL_CONTRACT_VERSION,
    mother_pool_http_status: water.receipt?.mother_pool_http_status || null,
    mother_pool_rows: expectedCount,
    mother_pool_pages: water.receipt?.mother_pool_pages || 0,
    unique_symbols: water.receipt?.unique_symbols || 0,
    quote_valid_rows: water.receipt?.quote_valid_rows || 0,
    intraday_1m_valid_rows: water.receipt?.intraday_1m_valid_rows || 0,
    symbol_data_gap_rows: water.receipt?.symbol_data_gap_rows || 0,
    global_formal_gate_blocked: water.receipt?.global_formal_gate_blocked === true,
    receipt_incomplete: water.receipt?.receipt_incomplete === true,
    runner_status: scan?.runner_status || scan?.status || null,
    verifier_ok: issues.length === 0,
    recovery_replay: recoveryReplay,
    natural_slot_complete: !recoveryReplay,
    receipt_written: true,
    sources: { motherPool: MOTHER_POOL_VIEW, producerReceipt: MOTHER_POOL_RECEIPT_VIEW, quote: QUOTE_TABLE, intraday1m: `rpc:${INTRADAY_1M_RPC}` },
    readback: { expectedCount, readyCount, requiredReadyCount, coverageRatio: Number(coverageRatio.toFixed(4)), resultCount, symbolDataGaps: water.receipt?.symbol_data_gaps || [] },
    failed_checks: issues.map((item) => item.code),
    issues,
  };
  writeJson(receiptPath, payload);
  console.log(JSON.stringify({ ...payload, receipt_path: receiptPath }, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main().catch((error) => {
  const payload = {
    ok: false,
    status: "STRATEGY3_V2_WATER_UNIVERSE_NOT_READY",
    contract: "strategy3-v2-mother-pool-v4-1-verifier-v1",
    checked_at: new Date().toISOString(),
    trade_date: tradeDate,
    strategy: STRATEGY,
    verifier_ok: false,
    receipt_written: true,
    first_blocker: "strategy3_v2_water_verifier_exception",
    failed_checks: ["strategy3_v2_water_verifier_exception"],
    error: error?.message || String(error),
  };
  writeJson(receiptPath, payload);
  console.error(JSON.stringify({ ...payload, receipt_path: receiptPath }, null, 2));
  process.exitCode = 1;
});
