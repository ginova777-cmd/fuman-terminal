"use strict";

const fs = require("fs");
const path = require("path");
const {
  ACCEPTED_CONTRACT_VERSION,
  CONSUMERS,
  adapterFor,
  validateIdentity,
} = require("../lib/daytrade-mother-pool-strategy-adapters");

const ROOT = path.resolve(__dirname, "..");
const tradeDate = "2026-09-09";
const canonicalRunId = "fugle_daytrade_source:20260909:canonical";
const checks = {};
const check = (name, ok) => { checks[name] = Boolean(ok); };

const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "contracts", "daytrade_mother_pool_v4_1.json"), "utf8"));
check("contract_version", contract.contractVersion === ACCEPTED_CONTRACT_VERSION);
check("authoritative_view", contract.authoritativeView === "public.v_fugle_daytrade_mother_pool_v4_1");
check("closed_loop_order", JSON.stringify(contract.closedLoop) === JSON.stringify(["runner", "canonical_readback", "verifier", "receipt"]));
check("all_consumers_have_adapter", contract.acceptedConsumers.every((name) => Object.prototype.hasOwnProperty.call(CONSUMERS, name)));
check("all_adapters_resolve", Object.keys(CONSUMERS).every((name) => adapterFor(name).consumerName === name));
check("strategy5_uses_post_close_snapshot", adapterFor("strategy5").postCloseSnapshotRead === true);
check("strategy4_is_not_a_mother_pool_consumer", !Object.prototype.hasOwnProperty.call(CONSUMERS, "strategy4"));
check("strategy5_does_not_require_intraday_candles", adapterFor("strategy5").hydrateMotherPoolCandles === false);
check("healthy_identity_passes", validateIdentity({ receipt: {
  mother_pool_contract_version: ACCEPTED_CONTRACT_VERSION,
  trade_date: tradeDate,
  canonical_run_id: canonicalRunId,
  mother_pool_source_freshness_matches: true,
}}, tradeDate).length === 0);
check("wrong_version_fails_closed", validateIdentity({ receipt: {
  mother_pool_contract_version: "4.0.0", trade_date: tradeDate, canonical_run_id: canonicalRunId,
  mother_pool_source_freshness_matches: true,
}}, tradeDate).includes("mother_pool_contract_version_unsupported"));
check("wrong_day_fails_closed", validateIdentity({ receipt: {
  mother_pool_contract_version: ACCEPTED_CONTRACT_VERSION, trade_date: "2026-09-08", canonical_run_id: canonicalRunId,
  mother_pool_source_freshness_matches: true,
}}, tradeDate).includes("mother_pool_trade_date_mismatch"));
check("wrong_run_fails_closed", validateIdentity({ receipt: {
  mother_pool_contract_version: ACCEPTED_CONTRACT_VERSION, trade_date: tradeDate, canonical_run_id: "old-run",
  mother_pool_source_freshness_matches: true,
}}, tradeDate).includes("mother_pool_canonical_run_id_mismatch"));
check("stale_source_fails_closed", validateIdentity({ receipt: {
  mother_pool_contract_version: ACCEPTED_CONTRACT_VERSION, trade_date: tradeDate, canonical_run_id: canonicalRunId,
  mother_pool_source_freshness_matches: false,
}}, tradeDate).includes("mother_pool_source_freshness_mismatch"));

const runnerWiring = {
  strategy2: ["scripts/run-strategy2-v3-live-scan.js", 'readMotherPoolForStrategy("strategy2"'],
  strategy5: ["run-strategy5.ps1", 'Invoke-MotherPoolV41ConsumerGate -Consumer "strategy5"'],
  institution: ["run-institution.ps1", 'Invoke-MotherPoolV41ConsumerGate -Consumer "institution"'],
  buy_sell: ["run-buy-sell-complete.ps1", 'Invoke-Required "chip source sync"'],
  scanner: ["scripts/run-scanner-with-mother-pool-v4-1.js", 'readMotherPoolForStrategy("scanner"'],
};
for (const [consumer, [file, marker]] of Object.entries(runnerWiring)) {
  const body = fs.readFileSync(path.join(ROOT, file), "utf8");
  check(`${consumer}_formal_runner_wired`, body.includes(marker));
}
const buySellRunner = fs.readFileSync(path.join(ROOT, "run-buy-sell-complete.ps1"), "utf8");
const institutionRunner = fs.readFileSync(path.join(ROOT, "run-institution.ps1"), "utf8");
const strategy4Runner = fs.readFileSync(path.join(ROOT, "run-strategy4.ps1"), "utf8");
const strategy4Scanner = fs.readFileSync(path.join(ROOT, "scripts", "scan-strategy4-cache.js"), "utf8");
check("buy_sell_official_chip_source_precedes_optional_enrichment", !buySellRunner.includes('Invoke-MotherPoolV41ConsumerGate -Consumer "buy_sell"'));
check("institution_mother_pool_enrichment_non_blocking", institutionRunner.includes("optional Mother Pool v4.1 enrichment unavailable; official TWSE/TPEx institution scan continues"));
check("strategy4_runner_has_zero_mother_pool_references", !/MotherPool|mother.?pool/i.test(strategy4Runner));
check("strategy4_scanner_has_zero_mother_pool_reads", !/STRATEGY4_PRIORITY_FILE|daytradeMotherPoolSymbols|strategy4MotherPoolSource/i.test(strategy4Scanner));
const receiptMarkers = [
  ["scripts/run-strategy2-v3-live-scan.js", "accepted_symbol_count"],
  ["run-strategy5.ps1", "accepted_symbol_count"],
  ["run-institution.ps1", "accepted_symbol_count"],
  ["scripts/verify-buy-sell-complete.js", "accepted_symbol_count"],
  ["scripts/run-scanner-with-mother-pool-v4-1.js", "accepted_symbol_count"],
];
check("all_mother_pool_consumer_receipts_include_v4_1_identity", receiptMarkers.every(([file, marker]) => {
  const body = fs.readFileSync(path.join(ROOT, file), "utf8");
  return body.includes(marker) && body.includes("contract_version") && body.includes("canonical_run_id");
}));

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failedChecks.length === 0,
  contract: "daytrade_mother_pool_consumer_adapters_v1",
  contract_version: ACCEPTED_CONTRACT_VERSION,
  consumers: Object.keys(CONSUMERS),
  checks,
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
