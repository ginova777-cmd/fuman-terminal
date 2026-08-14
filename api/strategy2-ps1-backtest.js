"use strict";

// Retired: Strategy2 has one source chain only: Fugle Mother Pool -> official 1m -> V2 live scan.
module.exports = async function strategy2Ps1BacktestRetired(_request, response) {
  response.status(410).json({
    ok: false,
    retired: true,
    error: "strategy2_ps1_backtest_retired",
    replacement: "/api/strategy2-latest",
    strategyContract: "strategy2-live-v2-fugle-mother-pool-1m",
    detail: "Legacy PS1 backtest data is never a Strategy2 display or scorecard source.",
  });
};