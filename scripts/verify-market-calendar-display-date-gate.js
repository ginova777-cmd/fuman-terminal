"use strict";

const fs = require("fs");
const path = require("path");
const { attachMarketCalendar } = require("../lib/market-calendar-contract");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "market-calendar-display-date-gate");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closedCalendar() {
  return {
    sourceFreshnessRequired: false,
    displayTradeDate: "20260731",
    marketOpen: false,
    marketStatus: "closed",
    closedReason: "weekend",
    closedReasonText: "Weekend closed",
    requestedDate: "20260802",
    formalScanSkipped: true,
    preservePreviousGood: true,
    skipReason: "market_closed",
  };
}

function main() {
  const stale = attachMarketCalendar({
    ok: true,
    runId: "strategy2-20260727-115941",
    tradeDate: "20260727",
    rows: [{ symbol: "6226" }],
    count: 1,
    resultCount: 1,
    publishAllowed: true,
  }, closedCalendar());
  assert(stale.ok === false, "stale payload must be blocked");
  assert(stale.rows.length === 0, "stale rows must not reach display");
  assert(stale.count === 0 && stale.resultCount === 0, "stale counts must be zero");
  assert(stale.qualityStatus === "blocked_stale_date", "stale quality status missing");
  assert(stale.evidenceStatus === "insufficient", "stale evidence status missing");
  assert(stale.staleDataSuppressed === true, "stale suppression marker missing");
  assert(stale.staleRunId === "strategy2-20260727-115941", "stale run id must remain traceable");
  assert(stale.dateGateReason === "payload_date_mismatch:20260727!=20260731", "stale date reason mismatch");

  const current = attachMarketCalendar({
    ok: true,
    runId: "strategy4-20260731-20260731080055",
    tradeDate: "20260731",
    rows: [{ symbol: "8039" }],
    count: 1,
    publishAllowed: true,
  }, closedCalendar());
  assert(current.rows.length === 1, "last valid trading-day rows must remain visible");
  assert(current.staleDataSuppressed !== true, "current display date must not be suppressed");
  assert(current.displayTradeDate === "20260731", "display date must be last valid trading date");

  const mixedScorecard = attachMarketCalendar({
    runId: "scorecard-20260731-1",
    tradeDate: "20260731",
    rows: [{ runId: "strategy4-20260731-1" }, { runId: "strategy2-20260727-1" }],
    sourceReports: [{ runId: "strategy2-20260727-1" }],
    count: 2,
  }, closedCalendar());
  assert(mixedScorecard.ok === false, "mixed scorecard must be blocked");
  assert(mixedScorecard.rows.length === 1, "stale nested strategy row must be removed");
  assert(mixedScorecard.sourceReports.length === 0, "stale nested source report must be removed");
  assert(mixedScorecard.staleNestedRowsSuppressed === 2, "nested stale row count missing");
  assert(mixedScorecard.dateGateReason === "nested_payload_date_mismatch:20260727!=20260731", "nested date reason mismatch");
  const traceableWithoutDate = attachMarketCalendar({
    ok: true,
    rows: [{ symbol: "unknown-date" }],
    count: 1,
  }, closedCalendar());
  assert(traceableWithoutDate.rows.length === 1, "date-less payload should not be guessed stale");

  const payload = {
    ok: true,
    contract: "market-calendar-display-date-gate-v1",
    checkedAt: new Date().toISOString(),
    expectedDisplayTradeDate: "20260731",
    stalePayload: {
      status: "blocked",
      staleRunId: stale.staleRunId,
      rows: stale.rows.length,
      qualityStatus: stale.qualityStatus,
      dateGateReason: stale.dateGateReason,
    },
    currentPayload: {
      rows: current.rows.length,
      displayTradeDate: current.displayTradeDate,
      staleDataSuppressed: current.staleDataSuppressed === true,
    },
    rule: "Closed or waiting-source-window surfaces may show only the exact displayTradeDate; mismatched dated payloads are cleared and marked blocked_stale_date.",
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = path.join(OUT_DIR, "market-calendar-display-date-gate.json");
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\\n`, "utf8");
  console.log(JSON.stringify({ ok: true, contract: payload.contract, output }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`[market-calendar-display-date-gate] ${error.message}`);
  process.exit(1);
}