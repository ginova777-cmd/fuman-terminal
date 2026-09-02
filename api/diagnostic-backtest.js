"use strict";
const artifact = require("../data/diagnostic-backtest-latest.json");
function safePayload() {
  return { ...artifact, mode: "DIAGNOSTIC_BACKTEST", label: "非正式", formalDisplayAllowed: false, publishAllowed: false, formalCandidateAllowed: false, diagnosticReplay: true, lineAllowed: false, orderAllowed: false };
}
module.exports = async function handler(req, res) {
  const surface = String(req.query?.surface || "desktop").toLowerCase();
  const payload = { ...safePayload(), surface };
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  if (surface === "mobile") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<section data-mode="DIAGNOSTIC_BACKTEST" data-formal="false"><h1>DIAGNOSTIC_BACKTEST / 非正式</h1><script type="application/json" data-diagnostic-backtest>${JSON.stringify(payload).replace(/</g,"\\u003c")}</script></section>`);
  }
  return res.status(200).json(payload);
};

