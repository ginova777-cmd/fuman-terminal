"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const runner = read("ops/run-strategy2-v3-unified.ps1");
const water = read("scripts/run-strategy2-v3-water-scan.js");
const live = read("scripts/run-strategy2-v3-live-scan.js");
const receipt = readJson(path.join(runtime, "data", "scan-receipts", "strategy2-v3-water.json"));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const compact = today.replace(/\D/g, "");
const checks = {
  one_minute_evidence_cadence: runner.includes("[Math]::Min(60, $remainingSeconds)") && !runner.includes("[Math]::Min(3, $remainingSeconds)"),
  preopen_formal_entry_forbidden: runner.includes("while ((Get-Date) -lt $scanStart)") && runner.includes("Strategy2 must not scan before 09:00"),
  one_finalize_only: (runner.match(/--finalize/g) || []).length === 1,
  water_uses_daily_canonical_run_id: water.includes("strategy2-v3-live-${clock.ymd}-canonical"),
  diagnostic_run_id_is_separate: water.includes("strategy2-v3-diagnostic-${clock.ymd}"),
  live_window_incomplete_is_explicit: water.includes('"water_incomplete_live_window"'),
  live_scanner_uses_same_daily_canonical: live.includes("strategy2-v3-live-${clock.ymd}-canonical"),
  water_source_read_throttled_to_one_minute: water.includes("previousAgeMs < 55000") && water.includes("cached: true"),
  live_source_event_throttled_to_one_minute: live.includes("previousLiveAgeMs < 55000") && live.includes("cached: true") && live.includes("previousLiveReceipt?.finishedAt || previousLiveReceipt?.updatedAt || previousLiveReceipt?.startedAt"),
};
if (receipt && String(receipt.tradeDate || receipt.dataDate || "").replace(/\D/g, "") === compact && !String(receipt.runId || "").includes("diagnostic")) {
  checks.current_water_receipt_canonical = receipt.runId === `strategy2-v3-live-${compact}-canonical`;
  checks.current_live_window_status_not_mislabeled = receipt.liveWindow !== true || receipt.status !== "water_ready_outside_live_window";
}
const issues = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: issues.length === 0, contract: "strategy2-v3-unified-canonical-contract-v1", checkedAt: new Date().toISOString(), checks, issues }, null, 2));
process.exit(issues.length ? 1 : 0);




