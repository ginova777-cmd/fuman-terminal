"use strict";

const path = require("path");
const {
  RUNTIME_DIR,
  CONTRACT_VERSION,
  STRATEGY,
  MIN_CANDLES_PER_SYMBOL,
  MIN_MOTHER_POOL_COVERAGE_RATIO,
  MOTHER_POOL_VIEW,
  MOTHER_POOL_RECEIPT_VIEW,
  QUOTE_TABLE,
  INTRADAY_1M_RPC,
  taipeiDate,
  nowTaipeiIso,
  readJson,
  writeJson,
  failClosed,
} = require("./strategy3-v2-contract");
const { readCanonicalDaytradeWater } = require("../lib/daytrade-canonical-water-reader");

const date = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = date.replace(/\D/g, "");
const sourceReceipt = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-readiness-${compactDate}.json`);
const statusFile = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-status-v2.json");

async function main() {
  const water = await readCanonicalDaytradeWater({
    tradeDate: date,
    consumerName: STRATEGY,
    strategy3Consumer: true,
    requireMarketCalendar: true,
    requireMotherPoolReceipt: true,
    hydrateMotherPoolCandles: true,
    minimumCandlesPerSymbol: MIN_CANDLES_PER_SYMBOL,
    barsPerSymbol: 260,
  });
  if (water.skipped && water.marketClosed) {
    const payload = {
      ok: false,
      skipped: true,
      strategy: STRATEGY,
      contract: CONTRACT_VERSION,
      checked_at: nowTaipeiIso(),
      trade_date: date,
      status: "SKIPPED_MARKET_CLOSED",
      formal_allowed: false,
      readiness_source: "public.market_calendar",
      reason_code: "market_closed",
      consumer_receipt: water.receipt,
      issues: [],
    };
    writeJson(sourceReceipt, payload);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const expectedCount = water.poolBySymbol.size;
  const readyCount = [...water.candleRowsBySymbol.entries()]
    .filter(([symbol, rows]) => rows.length >= MIN_CANDLES_PER_SYMBOL && !water.symbolDataGaps.has(symbol))
    .length;
  const requiredReadyCount = Math.ceil(expectedCount * MIN_MOTHER_POOL_COVERAGE_RATIO);
  const coverageRatio = expectedCount ? readyCount / expectedCount : 0;
  const issues = [...(water.failedChecks || [])];
  if (coverageRatio < MIN_MOTHER_POOL_COVERAGE_RATIO) issues.push("strategy3_v2_mother_pool_v4_1_usable_1m_coverage_below_90_percent");
  const uniqueIssues = [...new Set(issues)];
  const ready = water.ok === true && expectedCount > 0 && coverageRatio >= MIN_MOTHER_POOL_COVERAGE_RATIO;
  const ws = readJson(statusFile, {});
  const payload = {
    ok: ready,
    strategy: STRATEGY,
    contract: CONTRACT_VERSION,
    checked_at: nowTaipeiIso(),
    trade_date: date,
    status: ready ? "ready" : "not_ready",
    formal_allowed: ready,
    readiness_source: MOTHER_POOL_VIEW,
    minimums: {
      candlesPerSymbol: MIN_CANDLES_PER_SYMBOL,
      motherPoolReadySymbols: requiredReadyCount,
      motherPoolCoverageRatio: MIN_MOTHER_POOL_COVERAGE_RATIO,
    },
    mother_pool: {
      source: MOTHER_POOL_VIEW,
      producerReceiptSource: MOTHER_POOL_RECEIPT_VIEW,
      contractVersion: water.receipt?.contract_version,
      canonicalRunId: water.receipt?.canonical_run_id,
      tradeDate: date,
      expectedCount,
      sessionReadyCount: readyCount,
      requiredReadyCount,
      coverageRatio: Number(coverageRatio.toFixed(4)),
      quoteSource: QUOTE_TABLE,
      quoteValidRows: water.receipt?.quote_valid_rows || 0,
      candleSource: `rpc:${INTRADAY_1M_RPC}`,
      intraday1mValidRows: water.receipt?.intraday_1m_valid_rows || 0,
      symbolDataGapRows: water.receipt?.symbol_data_gap_rows || 0,
      globalFormalGateBlocked: water.receipt?.global_formal_gate_blocked === true,
      receiptIncomplete: water.receipt?.receipt_incomplete === true,
      firstBlocker: water.firstBlocker,
    },
    consumer_receipt: water.receipt,
    websocket_diagnostic_only: {
      statusFile,
      ok: ws.ok === true,
      updatedAt: ws.updatedAt || "",
      collectorRole: ws.collectorRole || "",
      candleSubscribedSymbols: Number(ws.candleSubscribedSymbols || 0),
    },
    issues: uniqueIssues.map((code) => ({ code })),
    reason_code: ready ? "strategy3_v2_mother_pool_v4_1_ready" : (uniqueIssues[0] || "strategy3_v2_readiness_not_ready"),
  };
  writeJson(sourceReceipt, payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main().catch((error) => {
  const payload = failClosed("strategy3_v2_readiness_exception", {
    checked_at: nowTaipeiIso(),
    trade_date: date,
    error: error?.message || String(error),
  });
  writeJson(sourceReceipt, payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
