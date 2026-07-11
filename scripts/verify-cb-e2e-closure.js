"use strict";

const { runProtectedE2EClosure } = require("./protected-e2e-closure-runner");

runProtectedE2EClosure({
  strategy: "cb",
  verifier: "verify-cb-e2e-closure",
  apiModule: "api/cb-detect-latest.js",
  internalQuery: { canvas: "1", compact: "1", shell: "1", limit: "60", live: "1" },
  productionLatestPath: "/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
  endpointPath: "/api/cb-detect-latest",
  mobileTab: "cb",
  sourceReportKey: "cb",
  sourceReportPattern: /cb|CB|可轉債|cb-detect/i,
  runIdPattern: /^cb-detect-\d{8}-\d+/,
  outDir: "outputs/cb-e2e-closure",
  outFile: "cb-e2e-closure.json",
}).catch((error) => {
  console.error("[cb-e2e-closure] failed: " + (error.stack || error.message || error));
  process.exit(1);
});
