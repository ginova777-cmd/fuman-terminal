"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readMotherPoolForStrategy } = require("../lib/daytrade-mother-pool-strategy-adapters");
const { taipeiDate } = require("../lib/daytrade-canonical-water-reader");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const receiptFile = path.join(runtime, "data", "scan-receipts", "scanner-mother-pool-v4-1.json");

function writeReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = new Date().toISOString();
  const tradeDate = taipeiDate();
  const water = await readMotherPoolForStrategy("scanner", { tradeDate });
  const scannerArgs = process.argv.slice(2);
  const run = water.ok === true
    ? spawnSync(process.execPath, [path.join(__dirname, "check-scanner-resource-health.js"), ...scannerArgs], { encoding: "utf8", env: process.env })
    : { status: 1, stdout: "", stderr: water.firstBlocker || "scanner_mother_pool_v4_1_not_ready" };
  const exitCode = Number(run.status ?? 1);
  const acceptedSymbolCount = Number(water.receipt?.mother_pool_read_rows || 0);
  const failures = [...new Set([
    ...(water.failedChecks || []),
    ...(exitCode === 0 ? [] : [`scanner_resource_health_exit_${exitCode}`]),
  ])];
  const receipt = {
    contract: "scanner_mother_pool_v4_1_runner_verifier_receipt_v1",
    consumer_id: "scanner",
    contract_version: water.receipt?.mother_pool_contract_version || "4.1.0",
    trade_date: water.receipt?.trade_date || tradeDate,
    canonical_run_id: water.receipt?.canonical_run_id || "",
    source_freshness: water.receipt?.mother_pool_source_freshness_matches === true ? "same_trade_date_current" : "invalid",
    accepted_symbol_count: acceptedSymbolCount,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: exitCode,
    verifier_ok: water.ok === true && exitCode === 0,
    failed_checks: failures,
    first_blocker: failures[0] || null,
    receipt_written: true,
    complete: water.ok === true && acceptedSymbolCount > 0 && exitCode === 0,
  };
  writeReceipt(receipt);
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.complete ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

