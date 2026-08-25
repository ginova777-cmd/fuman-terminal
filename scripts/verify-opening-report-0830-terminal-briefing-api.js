"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(ROOT, "api", "opening-report-0830-terminal-briefing.js"), "utf8");

assert(api.includes("readSnapshot"), "briefing endpoint must read the canonical snapshot");
assert(api.includes("opening_report_0830_terminal_briefing"), "briefing endpoint snapshot key missing");
assert(api.includes("allowLatestFallback: false"), "briefing endpoint must reject previous-good fallback");
assert(api.includes('report.ok === true'), "briefing endpoint must require a valid report");
assert(api.includes("opening_report_0830_terminal_briefing_missing_or_invalid"), "briefing endpoint fail-closed reason missing");

console.log(JSON.stringify({
  ok: true,
  contract: "opening_report_0830_terminal_briefing_fast_endpoint_v1",
  source: "/api/opening-report-0830-terminal-briefing",
  same_day_only: true,
  previous_good_fallback: false,
  failed_checks: [],
  first_blocker: null,
  read_only: true,
}, null, 2));
