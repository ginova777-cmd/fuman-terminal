"use strict";

const {
  readCanonicalDaytradeWater,
  canonicalRunId,
  taipeiDate,
  MOTHER_POOL_CONTRACT_VERSION,
  MOTHER_POOL_VIEW,
} = require("./daytrade-canonical-water-reader");

const ACCEPTED_CONTRACT_VERSION = "4.1.0";
const CONSUMERS = Object.freeze({
  strategy2: { hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 },
  strategy3_v2: { strategy3Consumer: true, hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 },
  strategy4: { postCloseSnapshotRead: true, requireMotherPoolReceipt: false, hydrateMotherPoolCandles: false, barsPerSymbol: 1 },
  strategy5: { postCloseSnapshotRead: true, hydrateMotherPoolCandles: false, barsPerSymbol: 1 },
  institution: { postCloseSnapshotRead: true, hydrateMotherPoolCandles: false, barsPerSymbol: 1 },
  buy_sell: { postCloseSnapshotRead: true, hydrateMotherPoolCandles: false, barsPerSymbol: 1 },
  scanner: { hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 },
  telegram: { telegramObservation: true, hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 61, barsPerSymbol: 61 },
});

function adapterFor(consumerName) {
  const key = String(consumerName || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CONSUMERS, key)) throw new Error(`unsupported_mother_pool_consumer:${key || "missing"}`);
  return { consumerName: key, ...CONSUMERS[key] };
}

function validateIdentity(result, tradeDate) {
  const receipt = result?.receipt || {};
  const failures = [];
  if (MOTHER_POOL_CONTRACT_VERSION !== ACCEPTED_CONTRACT_VERSION) failures.push("reader_contract_version_drift");
  if (receipt.mother_pool_contract_version !== ACCEPTED_CONTRACT_VERSION) failures.push("mother_pool_contract_version_unsupported");
  if (receipt.trade_date !== tradeDate) failures.push("mother_pool_trade_date_mismatch");
  if (receipt.canonical_run_id !== canonicalRunId(tradeDate)) failures.push("mother_pool_canonical_run_id_mismatch");
  if (receipt.mother_pool_source_freshness_matches !== true) failures.push("mother_pool_source_freshness_mismatch");
  return failures;
}

async function readMotherPoolForStrategy(consumerName, options = {}) {
  const adapter = adapterFor(consumerName);
  const tradeDate = options.tradeDate || taipeiDate();
  const requireMotherPoolReceipt = Object.prototype.hasOwnProperty.call(options, "requireMotherPoolReceipt")
    ? options.requireMotherPoolReceipt === true
    : adapter.requireMotherPoolReceipt !== false;
  const result = await readCanonicalDaytradeWater({
    ...adapter,
    ...options,
    tradeDate,
    consumerName: adapter.consumerName,
    requireMarketCalendar: options.requireMarketCalendar !== false,
    requireMotherPoolReceipt,
  });
  const identityFailures = validateIdentity(result, tradeDate);
  const failedChecks = [...new Set([...(result?.failedChecks || []), ...identityFailures])];
  return {
    ...result,
    ok: result?.ok === true && failedChecks.length === 0,
    adapter: adapter.consumerName,
    acceptedContractVersion: ACCEPTED_CONTRACT_VERSION,
    authoritativeView: MOTHER_POOL_VIEW,
    failedChecks,
    firstBlocker: failedChecks[0] || null,
  };
}

module.exports = {
  ACCEPTED_CONTRACT_VERSION,
  CONSUMERS,
  adapterFor,
  validateIdentity,
  readMotherPoolForStrategy,
};
