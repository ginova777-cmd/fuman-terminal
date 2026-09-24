"use strict";

const {
  STRATEGY,
  MOTHER_POOL_VIEW,
  MOTHER_POOL_RECEIPT_VIEW,
  QUOTE_TABLE,
  INTRADAY_1M_RPC,
  MIN_CANDLES_PER_SYMBOL,
  MIN_MOTHER_POOL_COVERAGE_RATIO,
  taipeiDate,
  nowTaipeiIso,
} = require("./strategy3-v2-contract");
const { readCanonicalDaytradeWater } = require("../lib/daytrade-canonical-water-reader");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();

async function main() {
  const water = await readCanonicalDaytradeWater({
    tradeDate,
    consumerName: STRATEGY,
    strategy3Consumer: true,
    requireMarketCalendar: true,
    requireMotherPoolReceipt: true,
    hydrateMotherPoolCandles: true,
    minimumCandlesPerSymbol: MIN_CANDLES_PER_SYMBOL,
    barsPerSymbol: 260,
  });
  const expectedCount = water.poolBySymbol.size;
  const readyCount = [...water.candleRowsBySymbol.entries()]
    .filter(([symbol, rows]) => rows.length >= MIN_CANDLES_PER_SYMBOL && !water.symbolDataGaps.has(symbol))
    .length;
  const requiredReadyCount = Math.ceil(expectedCount * MIN_MOTHER_POOL_COVERAGE_RATIO);
  const coverageRatio = expectedCount ? readyCount / expectedCount : 0;
  const ok = water.ok === true && !water.skipped && expectedCount > 0 && coverageRatio >= MIN_MOTHER_POOL_COVERAGE_RATIO;
  const issues = [...(water.failedChecks || [])];
  if (coverageRatio < MIN_MOTHER_POOL_COVERAGE_RATIO) issues.push("strategy3_v2_mother_pool_v4_1_usable_1m_coverage_below_90_percent");
  const payload = {
    ok,
    ready: ok,
    source: MOTHER_POOL_VIEW,
    producerReceiptSource: MOTHER_POOL_RECEIPT_VIEW,
    quoteSource: QUOTE_TABLE,
    candleSource: `rpc:${INTRADAY_1M_RPC}`,
    checkedAt: nowTaipeiIso(),
    tradeDate,
    canonicalRunId: water.receipt?.canonical_run_id || null,
    contractVersion: water.receipt?.contract_version || null,
    sessionReadyCount: readyCount,
    expectedCount,
    requiredReadyCount,
    quoteReadyCount: water.receipt?.quote_valid_rows || 0,
    intraday1mValidRows: water.receipt?.intraday_1m_valid_rows || 0,
    symbolDataGapRows: water.receipt?.symbol_data_gap_rows || 0,
    coverageRatio: Number(coverageRatio.toFixed(4)),
    minimumCoverageRatio: MIN_MOTHER_POOL_COVERAGE_RATIO,
    globalFormalGateBlocked: water.receipt?.global_formal_gate_blocked === true,
    receiptIncomplete: water.receipt?.receipt_incomplete === true,
    reason: ok ? "strategy3_direct_mother_pool_v4_1_ready" : (issues[0] || water.firstBlocker || "strategy3_direct_mother_pool_v4_1_not_ready"),
    issues: [...new Set(issues)],
    consumerReceipt: water.receipt,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, ready: false, source: MOTHER_POOL_VIEW, tradeDate, reason: "strategy3_direct_mother_pool_v4_1_exception", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
