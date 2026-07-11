"use strict";

const { runProtectedE2EClosure } = require("./protected-e2e-closure-runner");

runProtectedE2EClosure({
  strategy: "institution",
  verifier: "verify-institution-e2e-closure",
  apiModule: "api/institution-latest.js",
  internalQuery: { canvas: "1", compact: "1", shell: "1", limit: "1200", live: "1" },
  productionLatestPath: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
  endpointPath: "/api/institution-latest",
  mobileTab: "chip",
  sourceReportKey: "institution",
  sourceReportPattern: /institution|買賣超|法人籌碼/i,
  runIdPattern: /^institution-\d{8}-\d+/,
  outDir: "outputs/institution-e2e-closure",
  outFile: "institution-e2e-closure.json",
}).catch((error) => {
  console.error("[institution-e2e-closure] failed: " + (error.stack || error.message || error));
  process.exit(1);
});
