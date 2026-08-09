const { evaluateFormalEntryGate } = require("../lib/terminal-formal-entry-gate");

function fixture(overrides = {}) {
  return {
    sourceName: "fugle_daytrade_source",
    marketDate: "20260731",
    displayTradeDate: "20260731",
    requestedDate: "20260731",
    tradeDate: "20260731",
    sourceTradeDate: "20260731",
    scannerTargetDate: "20260731",
    scorecardTargetDate: "20260731",
    manifestTradeDate: "20260731",
    sourceStatus: "ready",
    gateGrade: "A",
    gateStatus: "ready",
    formalEntrySpeedVerdict: "YES",
    formalEntryAllowed: true,
    scannerCanRunOpening: true,
    websocketFormalReady: true,
    websocketConnected: true,
    websocketAuthenticated: true,
    websocketStreaming: true,
    websocketRestDisabled: true,
    channels: ["trades", "aggregates", "candles"],
    formalSourceAlignmentOk: true,
    ordinaryStockUniverseReady: true,
    activeSymbols: 1664,
    priorityPoolSymbols: 40,
    priorityFreshQuotes120s: 40,
    priorityFreshQuoteCoverage120s: 1,
    motherPoolSymbols: 300,
    quoteAgeSeconds: 5,
    intraday1mStaleSeconds: 0,
    readyMa20: true,
    readyMa35: true,
    dailyVolumeStatus: "ready",
    futoptGateStatus: "ready",
    futoptStockMapped: 1,
    futoptStockQuoteUniverse: 1,
    futoptStockQuotesThisLoop: 1,
    failedChecks: [],
    ...overrides,
  };
}

function main() {
  const expectedDate = String(process.argv.find((arg) => arg.startsWith("--expected-date=")) || "").slice(16).replace(/\D/g, "").slice(0, 8) || "20260731";
  const good = evaluateFormalEntryGate(fixture(), expectedDate);
  const bad = evaluateFormalEntryGate(fixture({ websocketFormalReady: false }), expectedDate);
  const dateBad = evaluateFormalEntryGate(fixture({ displayTradeDate: "20260730" }), expectedDate);
  const result = {
    contract: "verify-terminal-formal-entry-gate-v1",
    ok: good.ok === true
      && bad.ok === false
      && bad.failedChecks.includes("WEBSOCKET_FORMAL_READY")
      && dateBad.ok === false
      && dateBad.failedChecks.includes("DATE_HARD_GATE_MISMATCH"),
    good,
    negativeControls: { websocketNotReady: bad, dateMismatch: dateBad },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();
