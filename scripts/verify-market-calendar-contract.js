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

  const weekendContract = await buildMarketCalendarContract({
    now: new Date("2026-07-12T12:00:00+08:00"),
  });
  assert.strictEqual(weekendContract.marketOpen, false, "weekend should be closed");
  assert.strictEqual(weekendContract.displayTradeDate, "2026-07-09", "weekend previous trading date respects 2026-07-10 closure override");
  assert.strictEqual(weekendContract.preservePreviousGood, true, "weekend preserves previous good");


  const reopenContract = await buildMarketCalendarContract({
    now: new Date("2026-07-13T09:30:00+08:00"),
  });
  assert.strictEqual(reopenContract.marketOpen, true, "next trading day after 2026-07-10/07-12 closure should reopen");
  assert.strictEqual(reopenContract.marketStatus, "open", "reopened market status");
  assert.strictEqual(reopenContract.formalScanSkipped, false, "reopened day must allow formal scan");
  assert.strictEqual(reopenContract.sourceFreshnessRequired, true, "reopened day requires live source freshness");
  assert.strictEqual(reopenContract.preservePreviousGood, false, "reopened day must not keep market-closed preserve lock");
  assert.strictEqual(reopenContract.scannerAction, "allow_formal_scan", "reopened day scanner action");
  assert.strictEqual(reopenContract.displayMode, "live_market", "reopened day display mode");
  assert.strictEqual(reopenContract.evidenceStatus, "complete", "reopened day evidence status");

  const reopenedAttached = attachMarketCalendar({ ok: true, runId: "reopen-run", displayTradeDate: "2026-07-09" }, reopenContract);
  assert.strictEqual(reopenedAttached.marketOpen, true, "attached reopened marketOpen");
  assert.strictEqual(reopenedAttached.formalScanSkipped, false, "attached reopened skip false");
  assert.strictEqual(reopenedAttached.skipReason, "", "attached reopened clears market closed skip reason");
  assert.strictEqual(reopenedAttached.displayTradeDate, "2026-07-09", "attached reopened preserves payload display date until new run updates it");
  console.log(JSON.stringify({
    ok: true,
    status: "market-closed-and-reopen-protection-ready",
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
    reopenMarketOpen: reopenContract.marketOpen,
    reopenScannerAction: reopenContract.scannerAction,
    reopenDisplayMode: reopenContract.displayMode,
  }, null, 2));
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
