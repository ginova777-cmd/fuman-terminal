"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const targets = {
  writer: path.join(root, "run-daytrade-source-writer.js"),
  collector: path.join(root, "fugle-websocket-collector.js"),
  bridge: path.join(root, "apply-opening-report-mother-pool-bridge.js")
};

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const writer = read(targets.writer);
const collector = read(targets.collector);
const bridge = read(targets.bridge);

const checks = {
  writer_exists: Boolean(writer),
  collector_exists: Boolean(collector),
  bridge_exists: Boolean(bridge),
  writer_preserves_complete_gate: writer.includes('transport_heartbeat_contract: "preserve_complete_gate_verdict_v2"'),
  writer_does_not_force_transport_gate_c: !writer.includes('gate_grade: "C",\n    daytrade_gate_grade: "C"'),
  collector_records_server_heartbeat: collector.includes("lastWebSocketHeartbeatAt"),
  collector_records_aggregates_last_updated: collector.includes("lastAggregatesLastUpdatedAt"),
  collector_refreshes_priority_subscriptions: collector.includes("STREAMING_PRIORITY_REFRESH_MS") && collector.includes("void subscribe();"),
  bridge_is_local_fail_closed: bridge.includes("FAIL_CLOSED") && bridge.includes("opening_report_status_unchanged"),
  bridge_has_formal_publish_guard: bridge.includes("formal_candidate_count: 0") && bridge.includes("publish_allowed: false")
};

const failed_checks = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

const result = {
  ok: failed_checks.length === 0,
  contract: "daytrade_transport_and_bridge_resilience_v1",
  checked_at: new Date().toISOString(),
  root,
  checks,
  failed_checks,
  first_blocker: failed_checks[0] || null,
  read_only: true
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
