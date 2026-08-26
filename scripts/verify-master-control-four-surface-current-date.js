"use strict";
const path = require("path");
const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "lib", "master-control-four-surface.js");
const { compare, route88FieldIssues, ROUTE88_FIELDS } = require(modulePath);
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
const validRoute88 = Object.fromEntries(ROUTE88_FIELDS.map((field) => [field, "ok"]));
Object.assign(validRoute88, {
  tradeDate: current, sourceDate: current, runId: "today-run", startedAt: "2026-08-26T21:00:00+08:00", finishedAt: "2026-08-26T21:01:00+08:00",
  universeCount: 100, scannedCount: 100, resultCount: 0, fallbackUsed: false, publishAllowed: true, firstBlocker: "",
});
assert(route88FieldIssues("institution", validRoute88).length === 0, "healthy zero-result /88 row failed");
const invalidRoute88 = { ...validRoute88, runId: "", scannedCount: -1, fallbackUsed: "false" };
delete invalidRoute88.finishedAt;
const route88Issues = route88FieldIssues("institution", invalidRoute88);
assert(route88Issues.includes("institution:route88_field_empty:runId"), "empty /88 runId passed");
assert(route88Issues.includes("institution:route88_field_missing:finishedAt"), "missing /88 finishedAt passed");
assert(route88Issues.includes("institution:route88_field_invalid_count:scannedCount"), "negative /88 count passed");
assert(route88Issues.includes("institution:route88_field_invalid_boolean:fallbackUsed"), "string /88 boolean passed");
console.log(JSON.stringify({ ok: true, contract: "master-control-four-surface-current-date-v1", issues }, null, 2));
