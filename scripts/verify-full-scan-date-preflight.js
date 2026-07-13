"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPreflight } = require("./check-full-scan-date-preflight");

function tempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fuman-date-preflight-"));
}

function writeOverride(stateDir, date, reason) {
  const dir = path.join(stateDir, "market-calendar-overrides");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.json`), JSON.stringify({
    date,
    isTradingDay: false,
    reason,
    source: "verify-full-scan-date-preflight"
  }, null, 2));
}

async function expectCase(name, fn) {
  try {
    await fn();
    console.log(`[full-scan-date-preflight] ${name}: ok`);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

async function main() {
  await expectCase("typhoon holiday skips and preserves 2026-07-09", async () => {
    const stateDir = tempStateDir();
    writeOverride(stateDir, "2026-07-10", "typhoon_holiday");
    const payload = await buildPreflight({
      stateDir,
      now: new Date("2026-07-10T10:00:00+08:00"),
      taipeiToday: "2026-07-10",
      targetDate: "2026-07-10"
    });
    assert.strictEqual(payload.exitCode, 10);
    assert.strictEqual(payload.marketOpen, false);
    assert.strictEqual(payload.action, "skip_formal_scan");
    assert.strictEqual(payload.displayTradeDate, "2026-07-09");
    assert.strictEqual(payload.preservePreviousGood, true);
    assert.strictEqual(payload.latestPointerUpdated, false);
  });

  await expectCase("reopen 2026-07-13 allows formal scan", async () => {
    const stateDir = tempStateDir();
    writeOverride(stateDir, "2026-07-10", "typhoon_holiday");
    const payload = await buildPreflight({
      stateDir,
      now: new Date("2026-07-13T09:05:00+08:00"),
      taipeiToday: "2026-07-13",
      targetDate: "2026-07-13",
      sourceDate: "20260713"
    });
    assert.strictEqual(payload.exitCode, 0);
    assert.strictEqual(payload.marketOpen, true);
    assert.strictEqual(payload.action, "allow_formal_scan");
    assert.strictEqual(payload.formalScanSkipped, false);
    assert.strictEqual(payload.sourceFreshnessRequired, true);
    assert.strictEqual(payload.scannerTargetDate, "2026-07-13");
    assert.strictEqual(payload.sourceDate, "2026-07-13");
    assert.strictEqual(payload.preservePreviousGood, false);
  });

  await expectCase("wrong scanner target date fails closed", async () => {
    const stateDir = tempStateDir();
    const payload = await buildPreflight({
      stateDir,
      now: new Date("2026-07-13T09:05:00+08:00"),
      taipeiToday: "2026-07-13",
      targetDate: "2026-07-09"
    });
    assert.strictEqual(payload.exitCode, 20);
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.reason, "scanner_target_date_not_taipei_today");
    assert.strictEqual(payload.publishAllowed, false);
    assert.strictEqual(payload.preservePreviousGood, true);
  });

  await expectCase("source trade date mismatch fails closed", async () => {
    const stateDir = tempStateDir();
    const payload = await buildPreflight({
      stateDir,
      now: new Date("2026-07-13T09:05:00+08:00"),
      taipeiToday: "2026-07-13",
      targetDate: "2026-07-13",
      sourceDate: "2026-07-09"
    });
    assert.strictEqual(payload.exitCode, 22);
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.reason, "source_trade_date_not_scanner_target_date");
  });

  await expectCase("candidate field matching target is selected", async () => {
    const stateDir = tempStateDir();
    const candidateFile = path.join(tempStateDir(), "candidate.json");
    fs.writeFileSync(candidateFile, JSON.stringify({
      staleDate: "2026-07-09",
      sourceSnapshot: { tradeDate: "2026-07-13" }
    }));
    const payload = await buildPreflight({
      stateDir,
      now: new Date("2026-07-13T09:05:00+08:00"),
      taipeiToday: "2026-07-13",
      targetDate: "2026-07-13",
      candidateFile,
      candidatePaths: "staleDate,sourceSnapshot.tradeDate"
    });
    assert.strictEqual(payload.exitCode, 0);
    assert.strictEqual(payload.selectedCandidateDate.path, "sourceSnapshot.tradeDate");
    assert.strictEqual(payload.selectedCandidateDate.normalized, "2026-07-13");
  });

  console.log(JSON.stringify({ ok: true, status: "full-scan-date-preflight-contract-ready" }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
