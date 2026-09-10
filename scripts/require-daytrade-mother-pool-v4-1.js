"use strict";

const fs = require("fs");
const path = require("path");
const {
  ACCEPTED_CONTRACT_VERSION,
  readMotherPoolForStrategy,
} = require("../lib/daytrade-mother-pool-strategy-adapters");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const consumer = arg("consumer");
  const tradeDate = arg("trade-date") || undefined;
  const receiptFile = arg("receipt");
  if (!consumer) throw new Error("mother_pool_consumer_missing");

  const startedAt = new Date().toISOString();
  const result = await readMotherPoolForStrategy(consumer, { tradeDate });
  const source = result.receipt || {};
  const failedChecks = [...new Set(result.failedChecks || [])];
  const acceptedSymbolCount = Number(source.mother_pool_read_rows || source.mother_pool_rows || 0);
  const receipt = {
    contract: "mother_pool_v4_1_consumer_gate_v1",
    consumer_id: consumer,
    contract_version: source.mother_pool_contract_version || ACCEPTED_CONTRACT_VERSION,
    trade_date: source.trade_date || tradeDate || "",
    canonical_run_id: source.canonical_run_id || "",
    source_freshness: source.mother_pool_source_freshness_matches === true ? "same_trade_date_current" : "invalid",
    accepted_symbol_count: acceptedSymbolCount,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.ok === true ? 0 : 1,
    verifier_ok: result.ok === true,
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
    receipt_written: Boolean(receiptFile),
    complete: result.ok === true && acceptedSymbolCount > 0,
  };
  if (receiptFile) writeJson(receiptFile, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.complete) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
