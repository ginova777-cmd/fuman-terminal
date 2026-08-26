"use strict";
const path = require("path");
const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "lib", "master-control-four-surface.js");
const { compare } = require(modulePath);
function assert(condition, message) { if (!condition) throw new Error(message); }
const current = "20260826";
const stale = "20260821";
const receipt = { complete: true, fallbackUsed: false, tradeDate: stale, runId: "same-old-run", resultCount: 10 };
const surfaces = Object.fromEntries(["desktop", "mobile", "route88"].map((key) => [key, { tradeDate: stale, runId: "same-old-run", resultCount: 10 }]));
const issues = compare("institution", receipt, surfaces, true, current);
assert(issues.includes(`institution:receipt_tradeDate_not_current:${stale}!=${current}`), "stale receipt passed");
for (const surface of Object.keys(surfaces)) assert(issues.includes(`institution:${surface}_tradeDate_not_current:${stale}!=${current}`), `${surface} stale date passed`);
const currentReceipt = { ...receipt, tradeDate: current, runId: "today-run" };
const currentSurfaces = Object.fromEntries(Object.keys(surfaces).map((key) => [key, { tradeDate: current, runId: "today-run", resultCount: 10 }]));
assert(compare("institution", currentReceipt, currentSurfaces, true, current).length === 0, "current closure failed");
assert(compare("institution", receipt, surfaces, false, current).length === 0, "not-due strategy failed");
console.log(JSON.stringify({ ok: true, contract: "master-control-four-surface-current-date-v1", issues }, null, 2));
