"use strict";

// Strategy2 V3 starts with a deliberately narrow contract: validate and scan
// the current Fugle deep-scan pool. It does not import V2 rules or fallbacks.
const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
// V3 scans the dedicated daytrade WebSocket cache directly. The database is
// the durable mirror, not the live-clock authority for Strategy2.
process.env.FUMAN_RUNTIME_DIR = RUNTIME_DIR;
process.env.FUGLE_COLLECTOR_ROLE = "daytrade";
const { readFugleWebSocketCandles, readFugleWebSocketQuotes } = require("../lib/fugle-websocket-quotes");
const SOURCE_NAME = "fugle_daytrade_source";
const CONTRACT = "strategy2-v3-fugle-deep-scan-water-v1";
const MIN_CANDLES = 35;
const WEBSOCKET_STATUS_FILE = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-status.json");

function marketClosedReport(label, clock) {
  const { spawnSync } = require("child_process");
  const child = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "check-market-calendar-action.js"), `--label=${label}`, "--receipt"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, FUMAN_RUNTIME_DIR: RUNTIME_DIR },
  });
  const stdout = String(child.stdout || "");
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  let payload = null;
  if (first >= 0 && last > first) {
    try { payload = JSON.parse(stdout.slice(first, last + 1)); } catch {}
  }
  if (child.status !== 10) return null;
  return {
    ok: true,
    strategy: "strategy2",
    version: "v3",
    strategyContract: CONTRACT,
    runId: `strategy2-v3-market-closed-${clock.ymd}`,
    dataDate: clock.date,
    tradeDate: clock.date,
    updatedAt: new Date().toISOString(),
    status: "market_closed_previous_good",
    complete: true,
    liveWindow: false,
    publishAllowed: false,
    formalDisplayAllowed: false,
    reason: "market_closed_preserve_previous_good",
    marketCalendar: payload,
    expectedCount: 0,
    scannedCount: 0,
    dataGapCount: 0,
    resultCount: 0,
    records: [],
    dataGaps: [],
    sourceCoverage: {
      formalDeepScanPoolRows: 0,
      formalDeepScanQuoteRows: 0,
      formalDeepScanEligibleRows: 0,
      formalIntradayOneMinuteRows: 0,
      formalIntradayOneMinuteReadySymbols: 0,
      dataGapCount: 0,
      noLegacyReadbackViews: true,
      noTop40Gate: true,
      noPreviousGoodFallback: true,
    },
  };
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(read("hour") || 0);
  const minute = Number(read("minute") || 0);
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    ymd: `${read("year")}${read("month")}${read("day")}`,
    hour,
    minute,
    second: Number(read("second") || 0),
    minuteOfDay: hour * 60 + minute,
  };
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function readWebSocketEvidence(now = new Date()) {
  try {
    const status = JSON.parse(fs.readFileSync(WEBSOCKET_STATUS_FILE, "utf8"));
    const channels = Array.isArray(status.streamingChannels) ? status.streamingChannels : [];
    const updatedAt = status.updatedAt || status.websocketLastMessageAt || status.lastMessageAt || "";
    const updatedMs = Date.parse(updatedAt);
    const ageSeconds = Number.isFinite(updatedMs) ? Math.max(0, Math.round((now.getTime() - updatedMs) / 1000)) : 999999;
    const latestEvidenceAt = status.lastMessageAt || status.aggregatesLastUpdatedAt || status.websocketHeartbeatAt || "";
    const latestEvidenceMs = Date.parse(latestEvidenceAt);
    const evidenceAgeSeconds = Number.isFinite(latestEvidenceMs) ? Math.max(0, Math.round((now.getTime() - latestEvidenceMs) / 1000)) : 999999;
    const requiredChannels = ["trades", "aggregates", "candles"];
    const statusExplicitlyBlocksFormal = status.formalReady === false;
    const socketConnected = bool(status.websocketConnected);
    const socketAuthenticated = bool(status.websocketAuthenticated);
    // Subscription refresh briefly emits disconnected before the same authenticated socket reopens.
    // Permit that handover only with fresh Fugle evidence; a silent or stale socket remains blocked.
    const handoverGrace = !socketConnected && socketAuthenticated && evidenceAgeSeconds <= 45;
    const reauthGrace = socketConnected && !socketAuthenticated && evidenceAgeSeconds <= 45;
    const connectionReady = socketConnected || handoverGrace;
    const authenticationReady = socketAuthenticated || reauthGrace;
    const formalReady = !statusExplicitlyBlocksFormal
      && status.primarySource === "fugle-websocket"
      && status.mode === "streaming"
      && connectionReady
      && authenticationReady
      && bool(status.restDisabled)
      && requiredChannels.every((channel) => channels.includes(channel))
      && ageSeconds <= 180;
    return {
      formalReady,
      primarySource: String(status.primarySource || ""),
      mode: String(status.mode || ""),
      connected: socketConnected,
      authenticated: socketAuthenticated,
      authenticationMode: handoverGrace ? "recent_websocket_handover_grace" : socketAuthenticated ? "authenticated" : reauthGrace ? "recent_websocket_reconnect_grace" : "not_ready",
      recentEvidenceAt: latestEvidenceAt,
      evidenceAgeSeconds,
      restDisabled: bool(status.restDisabled),
      channels,
      updatedAt,
      ageSeconds,
      reason: formalReady ? "ready" : "fugle_websocket_not_formal_ready",
    };
  } catch {
    return { formalReady: false, primarySource: "", mode: "", connected: false, authenticated: false, restDisabled: false, channels: [], updatedAt: "", ageSeconds: 999999, reason: "fugle_websocket_status_missing_or_invalid" };
  }
}

function config() {
  return {
    url: terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, ""),
    key: terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR }),
  };
}

async function readRows(source, table, params) {
  const response = await fetch(`${source.url}/rest/v1/${table}?${new URLSearchParams(params)}`, {
    headers: { apikey: source.key, Authorization: `Bearer ${source.key}`, Accept: "application/json", Range: "0-99999" },
    cache: "no-store",
    signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

function isDeepScanEligible(payload, tradeDate) {
  const metrics = payload?.motherPoolMetrics || {};
  return String(payload?.trade_date || "") === tradeDate
    && String(payload?.canonical_pool_layer || payload?.pool_tier || "") === "deep_scan_pool"
    && bool(payload?.deep_scan_eligible)
    && (bool(payload?.basePoolEligible) || bool(metrics.basePoolEligible));
}

async function readFormalWater(source, tradeDate, now = new Date()) {
  const websocket = readWebSocketEvidence(now);
  const pool = await readRows(source, "fugle_daytrade_priority_pool", {
    select: "symbol,name,market,priority_rank,updated_at,payload",
    order: "priority_rank.asc",
    limit: "1000",
  });
  const poolRows = pool.filter((row) => isDeepScanEligible(row.payload || {}, tradeDate));
  const symbols = [...new Set(poolRows.map((row) => String(row.symbol || "")).filter((symbol) => /^\d{4}$/.test(symbol)))];
  const requestedSymbols = new Set(symbols);
  const liveQuotes = readFugleWebSocketQuotes({ maxAgeMs: 120000 });
  const liveCandles = readFugleWebSocketCandles({ maxAgeMs: 6 * 60 * 60 * 1000 });
  const quoteBySymbol = new Map();
  for (const rawQuote of liveQuotes.quotes.values()) {
    const symbol = String(rawQuote.code || rawQuote.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (!requestedSymbols.has(symbol)) continue;
    quoteBySymbol.set(symbol, {
      symbol,
      name: rawQuote.name || symbol,
      market: rawQuote.market || "",
      price: number(rawQuote.close),
      total_volume: number(rawQuote.tradeVolume || rawQuote.totalVolume || rawQuote.volume),
      quote_seen_at: rawQuote.quoteSeenAt || rawQuote.quoteTime || rawQuote.time || "",
      updated_at: rawQuote.quoteSeenAt || rawQuote.quoteTime || rawQuote.time || "",
      source: "fugle_websocket_cache_formal",
    });
  }
  const candleBySymbol = new Map();
  let candleRows = 0;
  for (const rawCandle of liveCandles.candles.values()) {
    const symbol = String(rawCandle.code || rawCandle.symbol || "").replace(/\D/g, "").slice(0, 4);
    const candleTime = rawCandle.candleTime || rawCandle.candle_time || rawCandle.date || "";
    const candleTradeDate = rawCandle.tradeDate || rawCandle.trade_date || taipeiClock(new Date(candleTime)).date;
    if (!requestedSymbols.has(symbol) || candleTradeDate !== tradeDate || !candleTime || number(rawCandle.close) <= 0) continue;
    if (!candleBySymbol.has(symbol)) candleBySymbol.set(symbol, []);
    candleBySymbol.get(symbol).push({
      symbol,
      trade_date: tradeDate,
      candle_time: candleTime,
      open: number(rawCandle.open),
      high: number(rawCandle.high),
      low: number(rawCandle.low),
      close: number(rawCandle.close),
      volume: number(rawCandle.volume),
      source_name: SOURCE_NAME,
      is_fallback: false,
      intraday_odd_lot: false,
      is_formal_entry_eligible: true,
      updated_at: rawCandle.candleSeenAt || "",
    });
    candleRows += 1;
  }
  const rows = poolRows.map((poolRow) => {
    const symbol = String(poolRow.symbol || "");
    const payload = poolRow.payload || {};
    const metrics = payload.motherPoolMetrics || {};
    const quote = quoteBySymbol.get(symbol) || {};
    const symbolCandles = (candleBySymbol.get(symbol) || []).sort((left, right) => String(left.candle_time).localeCompare(String(right.candle_time)));
    const quoteTime = quote.quote_seen_at || quote.updated_at || "";
    const quoteSeenMs = Date.parse(String(quoteTime || ""));
    const quoteAgeSeconds = Number.isFinite(quoteSeenMs) ? Math.max(0, Math.round((now.getTime() - quoteSeenMs) / 1000)) : 999999;
    const lastCandleTime = symbolCandles.at(-1)?.candle_time || "";
    const lastCandleMs = Date.parse(String(lastCandleTime || ""));
    const intraday1mStaleSeconds = Number.isFinite(lastCandleMs) ? Math.max(0, Math.round((now.getTime() - lastCandleMs) / 1000)) : 999999;
    const hasRequired1mWindow = symbolCandles.length >= MIN_CANDLES && intraday1mStaleSeconds <= 180;
    const hasFormalQuote = websocket.formalReady && /^fugle/i.test(String(quote.source || "")) && number(quote.price) >= 50 && number(quote.total_volume) > 0 && quoteAgeSeconds <= 120;
    const dataGap = !hasRequired1mWindow;
    const dataGapReason = symbolCandles.length < MIN_CANDLES ? "formal_1m_below_minimum" : intraday1mStaleSeconds > 180 ? "formal_1m_stale" : "";
    return {
      code: symbol,
      symbol,
      name: quote.name || poolRow.name || symbol,
      market: quote.market || poolRow.market || "",
      price: number(quote.price),
      totalVolume: number(quote.total_volume),
      priorityRank: number(poolRow.priority_rank),
      sourceRunId: String(payload.canonical_run_id || payload.run_id || ""),
      quoteSource: quote.source || "",
      quoteSeenAt: quoteTime,
      quoteAgeSeconds,
      candleCount: symbolCandles.length,
      firstCandleTime: symbolCandles[0]?.candle_time || "",
      lastCandleTime,
      intraday1mStaleSeconds,
      hasRequired1mWindow,
      dataGap,
      dataGapReason,
      basePoolEligible: true,
      deepScanEligible: true,
      formalQuoteReady: hasFormalQuote,
      formalOneMinuteReady: websocket.formalReady && hasRequired1mWindow,
      poolEvidence: {
        canonicalPoolLayer: payload.canonical_pool_layer || payload.pool_tier || "",
        dataGap: payload.dataGap || null,
        motherPoolMetrics: {
          basePoolEligible: bool(metrics.basePoolEligible),
          volumeRatio5: number(metrics.volumeRatio5),
          latestCandleTime: metrics.latestCandleTime || "",
        },
      },
    };
  });
  return { rows, poolRows: poolRows.length, quoteRows: quoteBySymbol.size, candleRows, candleBySymbol, websocket, liveEvidence: "fugle_daytrade_websocket_cache" };
}

async function main() {
  const now = new Date();
  const clock = taipeiClock(now);
  const closed = marketClosedReport("strategy2-v3-water", clock);
  if (closed) {
    const base = path.join(RUNTIME_DIR, "data", "strategy2-v3");
    writeJson(path.join(base, "latest.json"), closed);
    writeJson(path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json"), closed);
    console.log(JSON.stringify({ ok: true, status: closed.status, runId: closed.runId, dataDate: closed.dataDate, receipt: path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json") }, null, 2));
    return;
  }
  const source = config();
  if (!source.url || !source.key) throw new Error("strategy2_v3_supabase_credentials_missing");
  const diagnostic = process.argv.includes("--diagnostic");
  const water = await readFormalWater(source, clock.date);
  const scanned = water.rows.filter((row) => row.formalQuoteReady && row.formalOneMinuteReady);
  const dataGaps = water.rows.filter((row) => row.dataGap);
  const liveWindow = clock.minuteOfDay >= 9 * 60 && clock.minuteOfDay <= 12 * 60;
  const complete = scanned.length === water.rows.length && water.rows.length > 0;
  const runId = `strategy2-v3-${clock.ymd}-${String(clock.hour).padStart(2, "0")}${String(clock.minute).padStart(2, "0")}${String(clock.second).padStart(2, "0")}`;
  const report = {
    ok: complete,
    strategy: "strategy2",
    version: "v3",
    strategyContract: CONTRACT,
    runId,
    dataDate: clock.date,
    tradeDate: clock.date,
    updatedAt: now.toISOString(),
    status: diagnostic ? "diagnostic_water_ready" : liveWindow && complete ? "water_ready_for_live_strategy" : "water_ready_outside_live_window",
    complete,
    liveWindow,
    publishAllowed: false,
    formalDisplayAllowed: false,
    reason: diagnostic ? "diagnostic_v3_water_validation_only" : "strategy_rules_not_yet_attached",
    sourceContract: {
      motherPool: "fugle_daytrade_priority_pool",
      quote: "fugle_daytrade_websocket_cache",
      intraday1m: "fugle_daytrade_websocket_cache",
      scope: "deep_scan_pool + basePoolEligible",
      rejectedLegacyRoutes: ["all_v_fugle_daytrade_mother_pool_readback_views", "top40", "previous_good", "v2_snapshot"],
    },
    expectedCount: water.rows.length,
    scannedCount: scanned.length,
    dataGapCount: dataGaps.length,
    resultCount: 0,
    records: scanned,
    dataGaps,
    sourceCoverage: {
      formalDeepScanPoolRows: water.poolRows,
      formalDeepScanQuoteRows: water.quoteRows,
      formalDeepScanEligibleRows: water.rows.length,
      formalIntradayOneMinuteRows: water.candleRows,
      formalIntradayOneMinuteReadySymbols: scanned.length,
      dataGapCount: dataGaps.length,
      noLegacyReadbackViews: true,
      noTop40Gate: true,
      noPreviousGoodFallback: true,
    },
  };
  const base = path.join(RUNTIME_DIR, "data", "strategy2-v3");
  writeJson(path.join(base, "latest.json"), report);
  writeJson(path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json"), report);
  console.log(JSON.stringify({ ok: report.ok, status: report.status, runId, dataDate: report.dataDate, expectedCount: report.expectedCount, scannedCount: report.scannedCount, dataGapCount: report.dataGapCount, receipt: path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json") }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const clock = taipeiClock();
    const receipt = { ok: false, strategy: "strategy2", version: "v3", strategyContract: CONTRACT, dataDate: clock.date, status: "failed", reason: error?.message || String(error), updatedAt: new Date().toISOString() };
    writeJson(path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json"), receipt);
    console.error(JSON.stringify(receipt, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { CONTRACT, MIN_CANDLES, taipeiClock, number, bool, config, readWebSocketEvidence, readFormalWater };




