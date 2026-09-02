#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const observer = fs.readFileSync(path.join(root, "scripts", "run-strategy2-realtime-observer.js"), "utf8");
const collector = fs.readFileSync(path.join(root, "scripts", "fugle-websocket-collector.js"), "utf8");
const checks = {
  observer_starts_at_0845: observer.includes("const preopenStart = 8 * 60 + 45;"),
  preopen_priority_is_limited_to_0845_0850: observer.includes("const PREOPEN_PRIORITY_END = 8 * 60 + 50;") && observer.includes("clock.minuteOfDay <= PREOPEN_PRIORITY_END"),
  records_positive_negative_and_converging_basis: observer.includes("[\"正價差\", \"逆價差\", \"逆收斂\"]"),
  detects_near_month_and_spot_sync_strength: observer.includes("futureChangePercent >= FUTOPT_SYNC_STRONG_CHANGE_PCT") && observer.includes("spotChangePercent >= SPOT_SYNC_STRONG_CHANGE_PCT"),
  sync_strength_threshold_is_explicit: observer.includes("const FUTOPT_SYNC_STRONG_CHANGE_PCT = 2;") && observer.includes("const SPOT_SYNC_STRONG_CHANGE_PCT = 2;"),
  original_basis_can_be_promoted_after_open: observer.includes("preopen_basis_followed_by_sync_strength"),
  priority_action_is_not_formal_candidate: observer.includes("priority_only: true") && observer.includes("formal_candidate: false") && observer.includes("formal_candidate_allowed: false") && observer.includes("publish_allowed: false"),
  writes_separate_priority_artifact: observer.includes("const FUTOPT_PRIORITY_FILE") && observer.includes("writeJson(FUTOPT_PRIORITY_FILE, futoptPriorityArtifact);"),
  collector_reads_separate_artifact: collector.includes("const FUTOPT_PRIORITY_FILE") && collector.includes("function readFutoptPriorityArtifact()"),
  collector_rejects_cross_date_or_non_priority_artifact: collector.includes("tradeDate === currentTaipeiDate()") && collector.includes("payload?.priority_only === true") && collector.includes("Number(payload?.formal_candidate_count || 0) === 0"),
  collector_prioritizes_valid_futopt_symbols: collector.includes("addMany(\"futoptPriority\", futoptPriority.symbols, { priority: true });"),
};
const failedChecks = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "daytrade_futopt_priority_observation_v1", checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, read_only: true }, null, 2));
process.exitCode = failedChecks.length ? 1 : 0;
