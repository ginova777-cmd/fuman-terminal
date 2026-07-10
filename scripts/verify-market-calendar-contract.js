"use strict";

const assert = require("assert");
const { buildMarketCalendarContract, attachMarketCalendar } = require("../lib/market-calendar-contract");

(async () => {
  const contract = await buildMarketCalendarContract({
    now: new Date("2026-07-10T12:00:00+08:00"),
    previousTradingDate: "2026-07-09",
  });
  assert.strictEqual(contract.ok, true, "contract ok");
  assert.strictEqual(contract.contract, "market-calendar-contract-v1", "contract id");
  assert.strictEqual(contract.requestedDate, "2026-07-10", "requested date");
  assert.strictEqual(contract.marketOpen, false, "typhoon date should be closed");
  assert.strictEqual(contract.marketStatus, "closed", "closed status");
  assert.strictEqual(contract.closedReason, "typhoon_holiday", "closed reason");
  assert.strictEqual(contract.formalScanSkipped, true, "skip scanner");
  assert.strictEqual(contract.sourceFreshnessRequired, false, "no live freshness required on market closed day");
  assert.strictEqual(contract.preservePreviousGood, true, "preserve previous good");
  assert.strictEqual(contract.latestPointerUpdated, false, "no latest pointer update");
  assert.strictEqual(contract.emptyResultWritten, false, "no empty result write");
  assert.strictEqual(contract.displayTradeDate, "2026-07-09", "display previous trading date");
  assert.strictEqual(contract.resumePolicy, "auto_resume_next_trading_day", "auto resume policy");
  assert.strictEqual(contract.override, true, "manual override is active");

  const attached = attachMarketCalendar({ ok: true, runId: "sample-run", displayTradeDate: "2026-07-08" }, contract);
  assert.strictEqual(attached.marketOpen, false, "attached marketOpen");
  assert.strictEqual(attached.formalScanSkipped, true, "attached skip");
  assert.strictEqual(attached.preservePreviousGood, true, "attached preserve");
  assert.strictEqual(attached.latestPointerUpdated, false, "attached latest pointer");
  assert.strictEqual(attached.emptyResultWritten, false, "attached empty write");
  assert.strictEqual(attached.displayTradeDate, "2026-07-09", "attached display date");

  console.log(JSON.stringify({
    ok: true,
    status: "market-closed-protection-ready",
    marketOpen: contract.marketOpen,
    marketStatus: contract.marketStatus,
    closedReason: contract.closedReason,
    displayTradeDate: contract.displayTradeDate,
    formalScanSkipped: contract.formalScanSkipped,
    sourceFreshnessRequired: contract.sourceFreshnessRequired,
    preservePreviousGood: contract.preservePreviousGood,
    latestPointerUpdated: contract.latestPointerUpdated,
    emptyResultWritten: contract.emptyResultWritten,
    override: contract.override,
  }, null, 2));
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
