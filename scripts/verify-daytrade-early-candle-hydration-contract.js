const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const collector = fs.readFileSync(path.join(root, "scripts", "fugle-websocket-collector.js"), "utf8");
const writer = fs.readFileSync(path.join(root, "scripts", "run-daytrade-source-writer.js"), "utf8");
const normalizer = fs.readFileSync(path.join(root, "lib", "fugle-websocket-quotes.js"), "utf8");
const checks = {
  candle_normalizer_exported: normalizer.includes("function normalizeFugleCandles") && normalizer.includes("normalizeFugleCandles,"),
  collector_uses_candle_normalizer: collector.includes("normalizeFugleCandles(payload)"),
  writer_stamps_same_day_candle_priority: writer.includes("daytradeCandlePriorityTradeDate: taipeiDate()") && writer.includes("preopenCandlePriorityTradeDate: taipeiDate()"),
  writer_rewrites_changed_candle_priority: writer.includes("const sameCandlePriority") && writer.includes("!sameCandlePriority"),
  collector_rejects_stale_daytrade_manifest: collector.includes("const sameDayManifest") && collector.includes("candle_priority_manifest_date_mismatch"),
  opening_transition_is_not_delayed_by_refresh_interval: collector.includes("openingTransitionTimer") && collector.includes("8 * 60 + 45"),
  early_subscription_receipt_exists: collector.includes("daytrade_early_candle_hydration_v1") && collector.includes("writeEarlyCandleHydrationReceipt(selection)"),
  no_top40_gate: !collector.includes("STREAMING_PINNED_PRIORITY_SYMBOLS"),
};
const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({
  ok: failedChecks.length === 0,
  contract: "daytrade_early_candle_hydration_contract_v1",
  checks,
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
}, null, 2));
process.exitCode = failedChecks.length ? 1 : 0;
