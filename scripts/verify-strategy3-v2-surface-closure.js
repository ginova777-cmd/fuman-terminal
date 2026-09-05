"use strict";

// Strategy3 closure must be independent from the health of other strategies.
// Keep the shared implementation, but explicitly scope it to Strategy3 so a
// Strategy2/4/5/institution outage cannot invalidate a completed Strategy3 run.
process.argv.push("--strategy3-only");
require("./verify-three-surface-complete-scans.js");
