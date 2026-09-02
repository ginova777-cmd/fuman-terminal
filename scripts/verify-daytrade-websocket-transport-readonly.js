"use strict";
const fs = require("fs");
const path = require("path");

const CONTRACT = "daytrade_websocket_transport_readonly_v1";
const RUNTIME = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const STATUS = path.join(RUNTIME, "state", "fugle-daytrade-websocket-status-v2.json");
const SUPERVISOR = path.join(RUNTIME, "state", "fugle-daytrade-websocket-supervisor.json");
const contractOnly = process.argv.includes("--contract-only");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { return { __error: error.message }; }
}
function pick(object, ...keys) {
  for (const key of keys) if (object && object[key] !== undefined && object[key] !== null) return object[key];
  return null;
}
function bool(value) { return value === true || /^(true|1|yes|ok|ready|running)$/i.test(String(value || "")); }
function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function list(value) { return Array.isArray(value) ? value : []; }
function taipeiParts() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date()).filter((row) => row.type !== "literal").map((row) => [row.type, row.value]));
  return { tradeDate: parts.year + "-" + parts.month + "-" + parts.day, minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: parts.weekday };
}
function ageSeconds(value) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, (Date.now() - stamp) / 1000) : 999999;
}
const clock = taipeiParts();
const tradingWindow = !["Sat", "Sun"].includes(clock.weekday) && clock.minute >= 360 && clock.minute <= 810;
const formalSubscriptionWindow = tradingWindow && clock.minute >= 525;
const status = contractOnly ? {} : readJson(STATUS);
const supervisor = contractOnly ? {} : readJson(SUPERVISOR);
const channels = list(pick(status, "streamingChannels", "websocketStreamingChannels", "websocket_streaming_channels"));
const heartbeatAt = pick(status, "websocketServerHeartbeatAt", "websocketHeartbeatAt");
const aggregatesAt = pick(status, "aggregatesLastUpdatedAt", "aggregates_last_updated_at");
const lastMessageAt = pick(status, "websocketLastMessageAt", "lastMessageAt", "websocket_last_message_at");
const updatedAt = pick(status, "updatedAt", "receivedAt", "writtenAt");
const failed = [];
if (!contractOnly) {
  if (status.__error) failed.push("websocket_status_unreadable");
  if (supervisor.__error) failed.push("websocket_supervisor_unreadable");
  if (tradingWindow && !bool(pick(status, "websocketConnected", "connected"))) failed.push("websocket_not_connected");
  if (tradingWindow && !bool(pick(status, "authenticated", "websocketAuthenticated"))) failed.push("websocket_not_authenticated");
  for (const channel of (formalSubscriptionWindow ? ["trades", "aggregates", "candles"] : ["aggregates"])) if (tradingWindow && !channels.includes(channel)) failed.push(channel + "_subscription_missing");
  if (tradingWindow && Math.min(ageSeconds(heartbeatAt), ageSeconds(aggregatesAt), ageSeconds(lastMessageAt)) > 120) failed.push("transport_freshness_over_120s");
  if (formalSubscriptionWindow && num(pick(status, "candleMessages", "streamingCandles", "websocketStreamingCandles")) <= 0) failed.push("candle_stream_empty");
  if (formalSubscriptionWindow && num(pick(status, "formalSubscribedSymbols", "formalSymbols", "candleCoverageTarget")) <= 0) failed.push("formal_subscription_empty");
}
const payload = {
  ok: failed.length === 0,
  contract: CONTRACT,
  readOnly: true,
  contractOnly,
  checkedAt: new Date().toISOString(),
  tradeDate: clock.tradeDate,
  marketWindow: tradingWindow,
  formalSubscriptionWindow,
  statusPath: STATUS,
  supervisorPath: SUPERVISOR,
  websocketConnected: bool(pick(status, "websocketConnected", "connected")),
  authenticated: bool(pick(status, "authenticated", "websocketAuthenticated")),
  websocketServerHeartbeatAt: heartbeatAt || null,
  aggregatesLastUpdatedAt: aggregatesAt || null,
  websocketLastMessageAt: lastMessageAt || null,
  receivedAt: updatedAt || null,
  transportFreshAgeSeconds: Math.min(ageSeconds(heartbeatAt), ageSeconds(aggregatesAt), ageSeconds(lastMessageAt)),
  channels,
  messages: num(pick(status, "messages", "streamingMessages")),
  quotes: num(pick(status, "quoteMessages", "streamingQuotes")),
  candles: num(pick(status, "candleMessages", "streamingCandles")),
  tradeSubscriptions: num(pick(status, "tradeSubscribedSymbols", "tradeCoverageTarget")),
  candleSubscriptions: num(pick(status, "candleSubscribedSymbols", "candleCoverageTarget")),
  aggregateSubscriptions: num(pick(status, "aggregateSubscribedSymbols", "aggregateCoverageTarget")),
  formalSubscriptions: num(pick(status, "formalSubscribedSymbols", "formalSymbols", "candleCoverageTarget")),
  priorityFreshCount: num(pick(status, "priorityFreshCount", "priorityFreshQuotes120s")),
  freshSymbols120s: num(pick(status, "freshSymbols120s", "websocketFreshSymbols120s")),
  reconnectBackoffSeconds: num(pick(supervisor, "backoffSeconds")),
  failed_checks: failed,
  first_blocker: failed[0] || null,
};
console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);
