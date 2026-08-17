"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const {
  ROOT,
  RUNTIME_DIR,
  CONTRACT_VERSION,
  STRATEGY,
  MIN_READY_SYMBOLS,
  MIN_CANDLES_PER_SYMBOL,
  taipeiDate,
  nowTaipeiIso,
  readJson,
  writeJson,
  failClosed,
} = require("./strategy3-v2-contract");

const date = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = date.replace(/\D/g, "");
const statusFile = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-status.json");
const sourceReceipt = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-readiness-${compactDate}.json`);
const candleCachePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-candles.json");
const MIN_LOCAL_COVERAGE_RATIO = Math.max(0.9, Number(process.env.STRATEGY3_V2_MIN_LOCAL_COVERAGE_RATIO || 0.9));

function issue(list, condition, code, details = {}) {
  if (!condition) list.push({ code, ...details });
}

function parseJson(text) {
  const value = String(text || "").trim();
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(value.slice(start, end + 1)); } catch {}
  }
  return null;
}

function readCacheArray(file, key) {
  const payload = readJson(file, null);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
  return {
    file,
    updated_at: payload?.updatedAt || "",
    count: rows.length,
    rows,
  };
}

function readLocalFormalCacheReadiness() {
  const candleCache = readCacheArray(candleCachePath, "candles");
  const candlesByCode = new Map();
  for (const candle of candleCache.rows) {
    if (String(candle.tradeDate || "").slice(0, 10) !== date) continue;
    const code = String(candle.code || candle.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (!/^\d{4}$/.test(code)) continue;
    if (!candlesByCode.has(code)) candlesByCode.set(code, 0);
    candlesByCode.set(code, candlesByCode.get(code) + 1);
  }
  let ready20Count = 0;
  for (const count of candlesByCode.values()) {
    if (count >= MIN_CANDLES_PER_SYMBOL) ready20Count += 1;
  }
  const coverageRatio = MIN_READY_SYMBOLS > 0 ? ready20Count / MIN_READY_SYMBOLS : 0;
  return {
    ok: coverageRatio >= MIN_LOCAL_COVERAGE_RATIO,
    source: "local_fugle_daytrade_ws_candles_cache",
    tradeDate: date,
    sameDayCandleSymbols: candlesByCode.size,
    localReady20CandleSymbols: ready20Count,
    minimumReadySymbols: MIN_READY_SYMBOLS,
    minimumCandlesPerSymbol: MIN_CANDLES_PER_SYMBOL,
    coverageRatio: Math.round(coverageRatio * 10000) / 10000,
    minimumCoverageRatio: MIN_LOCAL_COVERAGE_RATIO,
    candleCache: {
      file: candleCache.file,
      updated_at: candleCache.updated_at,
      count: candleCache.count,
    },
    tolerancePolicy: "strategy3_v2_accepts_same_day_local_1m_cache_when_coverage_at_least_90_percent",
  };
}

function runMotherPoolReadback() {
  const child = spawnSync(process.execPath, [
    "--use-system-ca",
    path.join(ROOT, "scripts", "check-strategy3-session-readiness.js"),
    `--trade-date=${date}`,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    env: {
      ...process.env,
      FUMAN_RUNTIME_DIR: RUNTIME_DIR,
      STRATEGY3_ALLOW_READY_SNAPSHOT: "0",
      STRATEGY3_NOTIFICATION_DISABLED: "1",
    },
  });
  return {
    exitCode: child.status ?? 1,
    payload: parseJson(child.stdout),
    stderrTail: String(child.stderr || "").slice(-1000),
    error: child.error?.message || "",
  };
}

function main() {
  const ws = readJson(statusFile, {});
  const motherPoolRun = runMotherPoolReadback();
  const mother = motherPoolRun.payload || {};
  const localFormalCache = readLocalFormalCacheReadiness();
  const issues = [];
  const diagnostics = [];

  const candleSubscribedSymbols = Number(ws.candleSubscribedSymbols || 0);
  const candleCoverageTarget = Number(ws.candleCoverageTarget || 0);
  const subscribedChannels = Array.isArray(ws.streamingChannels) ? ws.streamingChannels : [];
  const candleMessages = Number(ws.streamingChannelMessages?.candles || 0);
  const candleSymbols = Number(ws.streamingChannelCandles?.candles || 0);
  const updatedAt = ws.updatedAt || "";
  const ageSeconds = updatedAt ? Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 1000)) : 999999;

  issue(diagnostics, ws.ok === true, "websocket_status_not_ok", { value: ws.ok });
  issue(diagnostics, ws.collectorRole === "daytrade", "collector_role_not_daytrade", { value: ws.collectorRole });
  issue(diagnostics, subscribedChannels.includes("candles"), "candles_channel_missing", { subscribedChannels });
  issue(diagnostics, candleSubscribedSymbols >= MIN_READY_SYMBOLS, "candle_subscribed_symbols_below_1000", { candleSubscribedSymbols, required: MIN_READY_SYMBOLS });
  issue(diagnostics, candleCoverageTarget >= MIN_READY_SYMBOLS, "candle_coverage_target_below_1000", { candleCoverageTarget, required: MIN_READY_SYMBOLS });
  issue(diagnostics, candleMessages > 0, "candle_messages_missing", { candleMessages });
  issue(diagnostics, candleSymbols >= Math.min(candleSubscribedSymbols, MIN_READY_SYMBOLS), "candle_stream_symbol_readback_below_target", { candleSymbols, candleSubscribedSymbols });
  issue(diagnostics, ageSeconds <= 180, "websocket_status_stale", { ageSeconds, updatedAt });

  const motherTradeDate = String(mother.tradeDate || mother.trade_date || "");
  const motherReadyCount = Number(mother.sessionReadyCount || mother.mother_pool_ready_symbols || mother.readyCount || 0);
  const motherMinimum = Math.max(MIN_READY_SYMBOLS, Number(mother.minIntraday1mCandidates || mother.minimum_ready_symbols || 0));
  const source = String(mother.source || mother.formal_readiness_source || "");
  const sameDay = motherTradeDate === date;
  const sourceOk = source === "v_fugle_daytrade_intraday_1m_status"
    || source === "source_status:fugle_daytrade_source.payload"
    || source === "v_strategy2_intraday_ready:fugle_daytrade_intraday_1m";
  const sessionLatestMinute = Number(mother.sessionLatestMinute ?? 0);
  const latestMinuteOk = sessionLatestMinute >= 770;
  const motherReady = motherPoolRun.exitCode === 0
    && mother.ok === true
    && sameDay
    && sourceOk
    && motherReadyCount >= motherMinimum
    && latestMinuteOk;
  const v2LocalReady = localFormalCache.ok === true;
  const readinessReady = motherReady || v2LocalReady;
  const gateIssues = v2LocalReady ? diagnostics : issues;

  issue(gateIssues, motherPoolRun.exitCode === 0, "mother_pool_readback_exit_nonzero", { exitCode: motherPoolRun.exitCode, stderrTail: motherPoolRun.stderrTail, error: motherPoolRun.error });
  issue(gateIssues, mother.ok === true, "mother_pool_readback_not_ok", { value: mother.ok });
  if (mother.ready !== true) {
    issue(diagnostics, false, "mother_pool_legacy_ready_flag_false_diagnostic_only", { value: mother.ready, reason: mother.reason || "" });
  }
  issue(gateIssues, sameDay, "mother_pool_trade_date_mismatch", { tradeDate: motherTradeDate, expected: date });
  issue(gateIssues, sourceOk, "mother_pool_formal_source_not_allowed", { source });
  issue(gateIssues, motherReadyCount >= motherMinimum, "mother_pool_ready_symbols_below_1000", { readyCount: motherReadyCount, required: motherMinimum });
  issue(gateIssues, latestMinuteOk, "mother_pool_latest_minute_before_1300_window", { sessionLatestMinute, required: 770 });
  issue(issues, readinessReady, "strategy3_v2_readiness_sources_not_ready", { motherReady, v2LocalReady });

  const payload = {
    ok: readinessReady,
    strategy: STRATEGY,
    contract: CONTRACT_VERSION,
    checked_at: nowTaipeiIso(),
    trade_date: date,
    status: readinessReady ? "ready" : "not_ready",
    formal_allowed: readinessReady,
    readiness_source: motherReady ? "mother_pool_formal_intraday_1m_readback" : "local_fugle_daytrade_ws_candles_cache_90pct_tolerance",
    minimums: {
      candleSubscribedSymbols: MIN_READY_SYMBOLS,
      candlesPerSymbol: MIN_CANDLES_PER_SYMBOL,
      motherPoolReadySymbols: motherMinimum,
    },
    local_formal_cache: localFormalCache,
    mother_pool: {
      exitCode: motherPoolRun.exitCode,
      source,
      tradeDate: motherTradeDate,
      sessionReadyCount: motherReadyCount,
      minimumReadySymbols: motherMinimum,
      latestCandleTime: mother.latestCandleTime || mother.latest_candle_time || "",
      sessionLatestMinute,
      rawLatestValidDay: mother.rawLatestValidDay || null,
      sourceStatusReadiness: mother.sourceStatusReadiness || null,
      reason: mother.reason || mother.blockedReason || "",
    },
    websocket_diagnostic_only: {
      statusFile,
      updatedAt,
      ageSeconds,
      subscribedChannels,
      candleSubscribedSymbols,
      candleCoverageTarget,
      candleMessages,
      candleSymbols,
      subscriptionPlan: ws.subscriptionPlan || "",
      sourceHostId: ws.sourceHostId || "",
      diagnosticIssues: diagnostics,
    },
    issues,
    reason_code: readinessReady ? "strategy3_v2_readiness_ready" : "strategy3_v2_readiness_not_ready",
  };

  writeJson(sourceReceipt, payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  const payload = failClosed("strategy3_v2_readiness_exception", {
    checked_at: nowTaipeiIso(),
    trade_date: date,
    error: error?.message || String(error),
  });
  writeJson(sourceReceipt, payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}