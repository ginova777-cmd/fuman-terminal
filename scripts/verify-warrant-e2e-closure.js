"use strict";

const { runProtectedE2EClosure } = require("./protected-e2e-closure-runner");

runProtectedE2EClosure({
  strategy: "warrant",
  verifier: "verify-warrant-e2e-closure",
  apiModule: "api/warrant-flow-latest.js",
  internalQuery: { canvas: "1", compact: "1", shell: "1", limit: "500", live: "1" },
  productionLatestPath: "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=500&live=1",
  endpointPath: "/api/warrant-flow-latest",
  mobileTab: "warrant",
  sourceReportKey: "warrant",
  sourceReportPattern: /warrant|權證|Warrant|warrant-flow/i,
  runIdPattern: /^warrant-flow-\d{8}-\d+/,
  outDir: "outputs/warrant-e2e-closure",
  outFile: "Warrant-e2e-closure.json",
}).catch((error) => {
  console.error("[warrant-e2e-closure] failed: " + (error.stack || error.message || error));
  process.exit(1);
});
