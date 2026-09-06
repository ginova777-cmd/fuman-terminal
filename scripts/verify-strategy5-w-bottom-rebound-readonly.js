"use strict";

const { verifyWBottomProducer } = require("./verify-strategy5-composite-producers");

try {
  const match = verifyWBottomProducer();
  console.log("[strategy5-w-bottom-rebound-readonly] PASS");
  console.log(JSON.stringify({
    ok: true,
    id: match.id,
    formalDailyOhlcv: match.formalDailyOhlcv,
    institutionalTwoDayTotalBuy: match.institutionalTwoDayTotalBuy,
    troughDate: match.troughDate,
    firstRedDate: match.firstRedDate,
    secondRedDate: match.secondRedDate,
    reboundPct: match.reboundPct,
  }, null, 2));
} catch (error) {
  console.error(`[strategy5-w-bottom-rebound-readonly] FAIL: ${error.stack || error.message || error}`);
  process.exitCode = 1;
}
