"use strict";
const fs = require("fs");
const path = require("path");
const source = fs.readFileSync(path.join(__dirname, "verify-source-observability-retention.js"), "utf8");
const checks = {
  activeSourceScorecardRequired: source.includes('"fugle_daytrade_source_scorecard"'),
  activeSpeedScorecardRequired: source.includes('"fugle_daytrade_source_speed_scorecard"'),
  activeGateScorecardRequired: source.includes('"fugle_daytrade_gate_scorecard"'),
  legacyCoverageExplicitlyRetired: source.includes('RETIRED_OBSERVATION_TABLES = new Set(["fugle_source_coverage"])'),
  missingDefinitionsFailClosed: source.includes("missingDefinitions"),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "source-observability-authority-v1", checks, failed }, null, 2));
if (failed.length) process.exit(1);
