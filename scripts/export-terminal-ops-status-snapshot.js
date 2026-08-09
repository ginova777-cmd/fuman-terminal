"use strict";

const { DATA_FILE, writeOpsStatusSnapshot } = require("../lib/terminal-ops-status");

function main() {
  const status = writeOpsStatusSnapshot(DATA_FILE);
  console.log(JSON.stringify({
    ok: status.ok === true,
    state: status.state,
    unattendedStatus: status.unattendedStatus,
    tradeDate: status.tradeDate,
    modules: status.modules.length,
    jobs: status.jobQueue.length,
    output: DATA_FILE,
  }, null, 2));
  const expectedWaitingState = status.state === "PENDING_NOT_DUE" || String(status.reason || "").startsWith("pending_not_due");
  const previousGoodHold = status.unattendedStatus === "PREVIOUS_GOOD_HOLD"
    || status.state === "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"
    || String(status.reason || "").includes("market_closed_preserve_previous_good");
  if (!expectedWaitingState && status.unattendedStatus !== "YES" && !previousGoodHold) process.exitCode = 1;
}

main();
