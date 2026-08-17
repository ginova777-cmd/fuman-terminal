"use strict";

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  RUNTIME_DIR,
  MIN_READY_SYMBOLS,
  taipeiDate,
  scanReceiptPath,
  readJson,
} = require("./strategy3-v2-contract");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
const issues = [];

function add(condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function uniqueSymbols(payload) {
  const raw = Array.isArray(payload) ? payload : (
    Array.isArray(payload?.symbols) ? payload.symbols :
    Array.isArray(payload?.items) ? payload.items :
    []
  );
  return [...new Set(raw.map((item) => {
    if (typeof item === "string") return item.trim();
    return String(item?.symbol || item?.code || item?.stock_id || "").trim();
  }).filter(Boolean))];
}

function firstBlocker() {
  if (!issues.length) return null;
  return issues[0].code;
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
  const cachePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-symbols.json");
  const sharedPath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-ws-symbols.json");
  const statusPath = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-status.json");
  const writerPath = path.join(ROOT, "scripts", "run-daytrade-source-writer.js");

  const cache = readJson(cachePath, null);
  const shared = readJson(sharedPath, null);
  const status = readJson(statusPath, {});
  const supervisorPath = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-supervisor.json");
  const supervisor = readJson(supervisorPath, {});
  const writerText = fs.existsSync(writerPath) ? fs.readFileSync(writerPath, "utf8") : "";
  const scanReceipt = readJson(scanReceiptPath(compactDate), {});
  const scanCoverageRatio = Number(scanReceipt?.scanner_summary?.local_coverage_ratio || 0);
  const scanCoverageMin = Number(scanReceipt?.scanner_summary?.min_local_coverage_ratio || 0.9);
  const scanCompleteWithFormalCache = scanReceipt?.ok === true
    && scanReceipt?.status === "COMPLETE"
    && scanReceipt?.trade_date === tradeDate
    && scanReceipt?.scanner_source === "local_fugle_daytrade_ws_candles+local_fugle_daytrade_ws_quotes"
    && scanCoverageRatio >= scanCoverageMin;

  const cacheSymbols = uniqueSymbols(cache);
  const sharedSymbols = uniqueSymbols(shared);
  const requestedSymbols = Number(status.requestedSymbols || status.allSymbols || 0);
  const subscribedSymbols = Number(status.subscribedSymbols || 0);
  const candleSubscribedSymbols = Number(status.candleSubscribedSymbols || 0);
  const candleCoverageTarget = Number(status.candleCoverageTarget || 0);
  const statusUpdatedAt = status.updatedAt || status.checkedAt || "";
  const statusAgeMs = Date.now() - Date.parse(statusUpdatedAt || "");
  const liveRecent = Number.isFinite(statusAgeMs) && statusAgeMs <= 5 * 60 * 1000;
  const statusPid = Number(status.pid || 0);
  const statusPidExists = processExists(statusPid);
  const supervisorStopped = supervisor.status === "stopped_off_session" || supervisor.status === "duplicate_blocked";
  const offSessionNoLiveCollector = Boolean(supervisorStopped && !statusPidExists);
  const orphanOldLimit = Boolean(statusPid && statusPidExists && liveRecent && supervisorStopped && candleSubscribedSymbols < MIN_READY_SYMBOLS);

  add(Boolean(cache), "strategy3_v2_daytrade_ws_symbol_cache_missing", { cachePath });
  add(cacheSymbols.length >= MIN_READY_SYMBOLS, "strategy3_v2_daytrade_ws_symbol_cache_under_1000", {
    cacheSymbols: cacheSymbols.length,
    required: MIN_READY_SYMBOLS,
  });
  add(sharedSymbols.length >= MIN_READY_SYMBOLS, "strategy3_v2_shared_ws_symbol_cache_under_1000", {
    sharedSymbols: sharedSymbols.length,
    required: MIN_READY_SYMBOLS,
  });
  add(cache?.websocketSymbolUniversePolicy === "active_universe_for_quote_and_candle_water_only_not_formal_gate", "strategy3_v2_ws_universe_policy_missing_or_wrong", {
    value: cache?.websocketSymbolUniversePolicy,
  });
  add(cache?.formalCandidateAllowed === false, "strategy3_v2_ws_universe_formal_candidate_guard_missing", {
    value: cache?.formalCandidateAllowed,
  });
  add(cache?.publishAllowed === false, "strategy3_v2_ws_universe_publish_guard_missing", {
    value: cache?.publishAllowed,
  });
  add(/symbols:\s*prependUnique\(daytradeMotherPoolSymbols,\s*activeUniverseSymbols\)/.test(writerText), "strategy3_v2_source_writer_not_using_active_universe_for_ws_water");
  add(!/symbols:\s*prependUnique\(daytradeMotherPoolSymbols,\s*activePriceEligibleSymbols\)/.test(writerText), "strategy3_v2_source_writer_still_uses_price_eligible_ws_water");
  add(!orphanOldLimit, "orphan_collector_process_alive_with_old_symbol_limit", { pid: status.pid, pidExists: statusPidExists, supervisorStatus: supervisor.status, statusUpdatedAt, candleSubscribedSymbols, required: MIN_READY_SYMBOLS });
  if (offSessionNoLiveCollector) {
    add(scanCompleteWithFormalCache, "collector_not_running_off_session_wait_next_0600", {
      supervisorStatus: supervisor.status,
      statusPid,
      statusPidExists,
      staleCandleSubscribedSymbols: candleSubscribedSymbols,
      required: MIN_READY_SYMBOLS,
      acceptedIf: "same_day_strategy3_v2_scan_complete_with_local_formal_cache_coverage",
    });
  } else {
    add(candleSubscribedSymbols >= MIN_READY_SYMBOLS, "collector_process_not_restarted_or_old_symbol_limit", {
      candleSubscribedSymbols,
      required: MIN_READY_SYMBOLS,
    });
  }
  add(candleCoverageTarget >= MIN_READY_SYMBOLS || scanCompleteWithFormalCache, "strategy3_v2_candle_coverage_target_under_1000", {
    candleCoverageTarget,
    required: MIN_READY_SYMBOLS,
    acceptedIf: "same_day_strategy3_v2_scan_complete_with_local_formal_cache_coverage",
  });

  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "STRATEGY3_V2_WATER_UNIVERSE_READY" : "STRATEGY3_V2_WATER_UNIVERSE_NOT_READY",
    first_blocker: firstBlocker(),
    reason_code: firstBlocker(),
    minimums: {
      minReadySymbols: MIN_READY_SYMBOLS,
    },
    files: {
      daytradeWsSymbolCache: cachePath,
      sharedWsSymbolCache: sharedPath,
      websocketStatus: statusPath,
      supervisorStatus: supervisorPath,
      sourceWriter: writerPath,
    },
    readback: {
      cacheSymbols: cacheSymbols.length,
      sharedSymbols: sharedSymbols.length,
      requestedSymbols,
      subscribedSymbols,
      candleSubscribedSymbols,
      candleCoverageTarget,
      cachePolicy: cache?.websocketSymbolUniversePolicy || null,
      formalCandidateAllowed: cache?.formalCandidateAllowed,
      publishAllowed: cache?.publishAllowed,
      supervisorStatus: supervisor.status || null,
      orphanOldLimit,
      statusPidExists,
      scanCompleteWithFormalCache,
      scanReceipt: scanReceiptPath(compactDate),
      scanCoverageRatio,
      scanCoverageMin,
    },
    issues,
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();