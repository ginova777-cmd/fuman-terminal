#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const statusPath = process.env.FUGLE_DAYTRADE_WS_STATUS_FILE || path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "state", "fugle-daytrade-websocket-status-v2.json");
const maxHeartbeatAgeMs = Number(process.env.FUGLE_DAYTRADE_WS_MAX_HEARTBEAT_AGE_MS || 60000);
function fail(reason, detail = {}) { console.error(JSON.stringify({ ok: false, reason, statusPath, ...detail })); process.exit(1); }
if (path.basename(statusPath) !== "fugle-daytrade-websocket-status-v2.json") fail("NON_CANONICAL_STATUS_PATH");
let status;
try { status = JSON.parse(fs.readFileSync(statusPath, "utf8")); } catch (error) { fail("STATUS_UNREADABLE", { error: error.message }); }
const heartbeat = status.websocketHeartbeatAt || status.websocketServerHeartbeatAt || status.heartbeatAt || status.lastHeartbeatAt || status.updatedAt;
const heartbeatAgeMs = Date.now() - Date.parse(heartbeat || "");
const checks = {
  connected: status.websocketConnected === true,
  authenticated: status.websocketAuthenticated === true,
  heartbeatFresh: Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs >= 0 && heartbeatAgeMs <= maxHeartbeatAgeMs,
  messagesPresent: Number(status.streamingChannelMessages?.aggregates ?? status.streamingMessages ?? status.messages ?? 0) > 0,
  subscriptionsPresent: Number(status.subscribed ?? status.subscribedCount ?? status.symbolCount ?? 0) > 0,
};
const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failedChecks.length) fail("TRANSPORT_NOT_READY", { heartbeatAgeMs, checks, failedChecks });
console.log(JSON.stringify({ ok: true, contract: "fugle-daytrade-websocket-transport-v2", statusPath, heartbeatAgeMs, checks }));