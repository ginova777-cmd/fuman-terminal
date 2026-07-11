"use strict";

const { runProtectedE2EClosure } = require("./protected-e2e-closure-runner");

runProtectedE2EClosure({
  strategy: "strategy2",
  verifier: "verify-strategy2-e2e-closure",
  apiModule: "api/strategy2-latest.js",
  internalQuery: { compact: "1", live: "1", today: "1", verify: "1" },
  productionLatestPath: "/api/strategy2-latest?compact=1&live=1&today=1&verify=1",
  endpointPath: "/api/strategy2-latest",
  mobileTab: "strategy2",
  sourceReportKey: "strategy2",
  sourceReportPattern: /strategy2|策略2|當沖/i,
  runIdPattern: /^strategy2-\d{8}-\d+/,
  outDir: "outputs/strategy2-e2e-closure",
  outFile: "strategy2-e2e-closure.json",
}).catch((error) => {
  console.error("[strategy2-e2e-closure] failed: " + (error.stack || error.message || error));
  process.exit(1);
});
