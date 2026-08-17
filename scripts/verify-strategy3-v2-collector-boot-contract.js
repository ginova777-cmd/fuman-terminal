"use strict";

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  RUNTIME_DIR,
  MIN_READY_SYMBOLS,
  readJson,
} = require("./strategy3-v2-contract");

const wrapperPath = path.join(ROOT, "ops", "public-slot", "Run-DaytradeWebSocketCollector.ps1");
const collectorPath = path.join(ROOT, "scripts", "fugle-websocket-collector.js");
const statusPath = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-status.json");
const supervisorPath = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-supervisor.json");
const issues = [];

function add(condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function isRecentIso(value, maxAgeMs) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) && (Date.now() - time) <= maxAgeMs;
}

function processExists(pid) {
  const id = Number(pid || 0);
  if (!id) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function main() {
  const wrapper = readText(wrapperPath);
  const collector = readText(collectorPath);
  const status = readJson(statusPath, {});
  const supervisor = readJson(supervisorPath, {});

  const channels = "trades,aggregates,candles".split(",");
  const maxSymbols = 2000;
  const totalSubscriptions = 1800;
  const candleSymbols = 1000;
  const pinned = 40;
  const formalExtraChannelCount = channels.length - 1;
  const quoteRadarCapacity = Math.max(0, totalSubscriptions - (pinned * formalExtraChannelCount));
  const symbolLimit = Math.min(maxSymbols, quoteRadarCapacity);
  const formalSubscriptionCount = pinned * channels.length;
  const candleRadarSymbols = Math.max(0, Math.min(candleSymbols - pinned, symbolLimit - pinned));
  const candleSubscribedSymbols = pinned + candleRadarSymbols;
  const tradeRadarCapacity = Math.max(0, totalSubscriptions - formalSubscriptionCount - candleRadarSymbols);

  const livePid = Number(status.pid || 0);
  const liveUpdated = status.updatedAt || status.checkedAt || "";
  const liveRecent = isRecentIso(liveUpdated, 5 * 60 * 1000);
  const supervisorStopped = supervisor.status === "stopped_off_session" || supervisor.status === "duplicate_blocked";
  const livePidExists = processExists(livePid);
  const orphanOldLimit = Boolean(livePid && livePidExists && liveRecent && supervisorStopped && Number(status.subscriptionSymbolLimit || 0) < MIN_READY_SYMBOLS);

  add(fs.existsSync(wrapperPath), "strategy3_v2_collector_wrapper_missing", { wrapperPath });
  add(fs.existsSync(collectorPath), "strategy3_v2_collector_script_missing", { collectorPath });
  add(/\$env:FUGLE_STREAMING_CHANNELS\s*=\s*"trades,aggregates,candles"/.test(wrapper), "strategy3_v2_wrapper_channels_not_full");
  add(/\$env:FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS\s*=\s*"1800"/.test(wrapper), "strategy3_v2_wrapper_total_subscriptions_not_1800");
  add(/\$env:FUGLE_STREAMING_MAX_SYMBOLS\s*=\s*"2000"/.test(wrapper), "strategy3_v2_wrapper_max_symbols_not_2000");
  add(/\$env:FUGLE_STREAMING_CANDLE_SYMBOLS\s*=\s*"1000"/.test(wrapper), "strategy3_v2_wrapper_candle_symbols_not_1000");
  add(/process\.env\.FUGLE_STREAMING_MAX_SYMBOLS/.test(collector), "strategy3_v2_collector_does_not_read_max_symbols_env");
  add(/process\.env\.FUGLE_STREAMING_MAX_TOTAL_SUBSCRIPTIONS/.test(collector), "strategy3_v2_collector_does_not_read_total_subscriptions_env");
  add(/process\.env\.FUGLE_STREAMING_CANDLE_SYMBOLS/.test(collector), "strategy3_v2_collector_does_not_read_candle_symbols_env");
  add(candleSubscribedSymbols >= MIN_READY_SYMBOLS, "strategy3_v2_boot_contract_cannot_reach_1000_candles", {
    computedCandleSubscribedSymbols: candleSubscribedSymbols,
    required: MIN_READY_SYMBOLS,
  });
  add(!orphanOldLimit,
      livePidExists, "orphan_collector_process_alive_with_old_symbol_limit", {
    pid: livePid,
    updatedAt: liveUpdated,
    supervisorStatus: supervisor.status,
    subscriptionSymbolLimit: status.subscriptionSymbolLimit,
    candleSubscribedSymbols: status.candleSubscribedSymbols,
  });

  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "STRATEGY3_V2_COLLECTOR_BOOT_CONTRACT_READY" : "STRATEGY3_V2_COLLECTOR_BOOT_CONTRACT_NOT_READY",
    first_blocker: issues[0]?.code || null,
    files: { wrapperPath, collectorPath, statusPath, supervisorPath },
    computed_boot_plan: {
      channels,
      maxSymbols,
      totalSubscriptions,
      pinnedPrioritySymbols: pinned,
      formalSubscriptionCount,
      symbolLimit,
      candleRadarSymbols,
      candleSubscribedSymbols,
      tradeRadarCapacity,
    },
    live_runtime: {
      pid: livePid,
      updatedAt: liveUpdated,
      liveRecent,
      supervisorStatus: supervisor.status || null,
      subscriptionSymbolLimit: status.subscriptionSymbolLimit || null,
      candleSubscribedSymbols: status.candleSubscribedSymbols || null,
      candleCoverageTarget: status.candleCoverageTarget || null,
      orphanOldLimit,
      livePidExists,
    },
    issues,
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();