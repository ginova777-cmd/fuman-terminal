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
  if (status.unattendedStatus !== "YES" && status.unattendedStatus !== "PREVIOUS_GOOD_HOLD") process.exitCode = 1;
}

main();
