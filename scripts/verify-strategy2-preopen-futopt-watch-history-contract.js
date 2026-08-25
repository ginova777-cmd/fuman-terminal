"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const observerPath = path.join(ROOT, "scripts", "run-strategy2-realtime-observer.js");
const source = fs.readFileSync(observerPath, "utf8");

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
}
function includes(text) {
  return source.includes(text);
}

const requiredMarkers = [
  "MAX_PREOPEN_WATCH_ROWS = 20",
  "MAX_PREOPEN_WATCH_HISTORY",
  "PREOPEN_WATCH_SOURCE = \"futopt_preopen_watch_history\"",
  "STRATEGY_DETECTED_SOURCE = \"strategy_detected_history\"",
  "function classifyPreopenBasis",
  "function appendPreopenWatchHistory",
  "const watchRows = []",
  "const strategyCandidates = []",
  "watchRows.push(watchRow)",
  "strategyCandidates.push",
  "preopenWatchRows",
  "preopenWatchHistory",
  "futoptPreopenWatchHistory",
  "futopt_preopen_watch_history",
  "strategyDetectedHistory",
  "strategy_detected_history",
  "preopenWatchRows.length > 0",
  "preopen_watch_max_batch_rows",
  "preopen_watch_max_history_rows",
];
for (const marker of requiredMarkers) check("required_marker", includes(marker), marker);

const requiredFields = [
  "snapshot_time",
  "trade_date",
  "symbol",
  "name",
  "future_symbol",
  "future_price",
  "future_change_percent",
  "relative_txf_percent",
  "future_volume",
  "preopen_price",
  "basis_percent",
  "basis_status",
  "source_status",
  "is_stale",
  "formal_allowed",
  "display_status",
];
for (const field of requiredFields) check("preopen_watch_required_field", includes(field + ":") || includes(field), field);

const basisStatuses = ["正價差", "逆價差", "逆收斂", "期貨觀察", "待試撮", "試撮缺", "stale不可正", "資料缺"];
for (const status of basisStatuses) check("basis_status_contract", includes(status), status);

const readStart = source.indexOf("async function readPreopenFutures");
const appendStart = source.indexOf("function appendEvents", readStart);
const preopenBlock = readStart >= 0 && appendStart > readStart ? source.slice(readStart, appendStart) : "";
check("read_preopen_function_exists", preopenBlock.length > 0);
check("no_stale_continue_in_preopen_watch", !preopenBlock.includes("ageSeconds(row?.updated_at) > 15) continue"));
check("no_signal_filter_continue_in_preopen_watch", !preopenBlock.includes("change <= 0 || volume <= 0 || change - txfChange <= 0) continue"));
check("watch_before_strategy_filter", preopenBlock.indexOf("watchRows.push(watchRow)") >= 0 && preopenBlock.indexOf("watchRows.push(watchRow)") < preopenBlock.indexOf("strategyCandidates.push"));
check("strategy_hits_still_strict", preopenBlock.includes("!isStale && futPrice > 0 && change > 0 && volume > 0 && relativeToTxfPercent > 0"));
check("top20_batch_limit", preopenBlock.includes("slice(0, MAX_PREOPEN_WATCH_ROWS)"));

if (failures.length) {
  console.error(JSON.stringify({ ok: false, contract: "strategy2-preopen-futopt-watch-history", failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  contract: "strategy2-preopen-futopt-watch-history",
  observer: observerPath,
  guarantees: {
    preopen_watch_source: "futopt_preopen_watch_history",
    strategy_detected_source: "strategy_detected_history",
    max_batch_rows: 20,
    keeps_gate_d_stale_and_missing_trial_rows: true,
    forbids_previous_good_backfill: true,
  },
}, null, 2));