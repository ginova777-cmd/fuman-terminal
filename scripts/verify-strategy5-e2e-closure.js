"use strict";

const { runProtectedE2EClosure } = require("./protected-e2e-closure-runner");

runProtectedE2EClosure({
  strategy: "strategy5",
  verifier: "verify-strategy5-e2e-closure",
  apiModule: "api/strategy5-latest.js",
  internalQuery: { canvas: "1", compact: "1", shell: "1", limit: "70", live: "1" },
  productionLatestPath: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=70&live=1",
  endpointPath: "/api/strategy5-latest",
  mobileTab: "strategy5",
  sourceReportKey: "strategy5",
  sourceReportPattern: /strategy5|策略5|籌碼|買賣超籌碼/i,
  runIdPattern: /^strategy5-\d{8}-\d+/,
  outDir: "outputs/strategy5-e2e-closure",
  outFile: "strategy5-e2e-closure.json",
}).catch((error) => {
  console.error("[strategy5-e2e-closure] failed: " + (error.stack || error.message || error));
  process.exit(1);
});
