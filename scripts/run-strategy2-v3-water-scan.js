"use strict";

// Strategy2 reads its formal shared-water contract from Supabase. The source
// writer may run on another computer; local Collector runtime is never an
// market-data authority for this scanner.
const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_NAME = "fugle_daytrade_source";
const CONTRACT = "strategy2-shared-water-v1";
const MIN_CANDLES = 35;
const MIN_FORMAL_WATER_COVERAGE_RATIO = 0.90;

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

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : 0;
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

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function sharedSourceEvidence(statusRow, tradeDate, expectedCanonicalRunId, now = new Date()) {
  const payload = statusRow?.payload || {};
  const statusTradeDate = String(payload.tradeDate || payload.trade_date || statusRow?.trade_date || "");
  const canonicalRunId = String(payload.canonicalRunId || payload.canonical_run_id || payload.runId || payload.run_id || "");
  const updatedAt = statusRow?.updated_at || payload.updatedAt || payload.updated_at || payload.lastMessageAt || "";
  const updatedMs = Date.parse(updatedAt);
  const ageSeconds = Number.isFinite(updatedMs) ? Math.max(0, Math.round((now.getTime() - updatedMs) / 1000)) : 999999;
  const statusOk = String(statusRow?.status || payload.status || "").toLowerCase();
  const formalReady = statusTradeDate === tradeDate && canonicalRunId === expectedCanonicalRunId
    && bool(payload.formalReady ?? payload.formal_ready ?? payload.websocket_formal_ready ?? statusOk === "ok")
    && ageSeconds <= 180;
  return {
    formalReady,
    primarySource: "supabase_shared_fugle_daytrade_source",
    mode: "cross_machine_shared_water",
    tradeDate: statusTradeDate,
    canonicalRunId,
    updatedAt,
    ageSeconds,
    reason: formalReady ? "ready" : statusTradeDate !== tradeDate ? "shared_source_trade_date_mismatch" : canonicalRunId !== expectedCanonicalRunId ? "shared_source_canonical_run_mismatch" : "shared_source_not_formal_ready",
  };
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

async function safeReadRows(source, table, params, issues) {
  try { return await readRows(source, table, params); }
  catch (error) {
    issues.push(`${table}:${String(error?.message || error).slice(0, 180)}`);
    return [];
  }
}

async function readRowsForSymbols(source, table, params, symbols, issues, rowsPerSymbol = 5, groupSize = 200) {
  const output = [];
  for (const group of chunk(symbols, groupSize)) {
    output.push(...await safeReadRows(source, table, { ...params, symbol: `in.(${group.join(",")})`, limit: String(Math.max(group.length * rowsPerSymbol, 200)) }, issues));
  }
  return output;
}

function symbolOf(row) {
  return String(row?.symbol || row?.stock_symbol || row?.underlying_symbol || "").replace(/\D/g, "").slice(0, 4);
}

function newestBySymbol(rows) {
  const output = new Map();
  for (const row of rows) {
    const symbol = symbolOf(row);
    if (symbol && !output.has(symbol)) output.set(symbol, row);
  }
  return output;
}

function isDeepScanEligible(payload, tradeDate) {
  const metrics = payload?.motherPoolMetrics || {};
  return String(payload?.trade_date || "") === tradeDate
    && String(payload?.canonical_pool_layer || payload?.pool_tier || "") === "deep_scan_pool"
    && bool(payload?.deep_scan_eligible)
    && (bool(payload?.basePoolEligible) || bool(metrics.basePoolEligible));
}

async function readFormalWater(source, tradeDate, now = new Date()) {
  const ancillaryIssues = [];
  const expectedCanonicalRunId = `${SOURCE_NAME}:${tradeDate.replace(/-/g, "")}:canonical`;
  const pool = await readRows(source, "fugle_daytrade_priority_pool", {
    select: "symbol,name,market,priority_rank,updated_at,payload",
    order: "priority_rank.asc",
    limit: "1000",
  });
  const poolRows = pool.filter((row) => isDeepScanEligible(row.payload || {}, tradeDate));
  const symbols = [...new Set(poolRows.map((row) => String(row.symbol || "")).filter((symbol) => /^\d{4}$/.test(symbol)))];
  const requestedSymbols = new Set(symbols);
  const [quoteRows, candleRowsRaw, dailyAverageRows, previousDailyRows, futureRows, preopenRows, canonicalRows, sourceStatusRows] = await Promise.all([
    readRowsForSymbols(source, "fugle_daytrade_quotes_live", { select: "*", order: "quote_seen_at.desc" }, symbols, ancillaryIssues),
    readRowsForSymbols(source, "fugle_daytrade_intraday_1m", { select: "symbol,market,trade_date,candle_time,open,high,low,close,volume,updated_at,source_name,is_fallback,intraday_odd_lot,is_formal_entry_eligible", trade_date: `eq.${tradeDate}`, order: "symbol.asc,candle_time.asc" }, symbols, ancillaryIssues, 400, 2),
    readRowsForSymbols(source, "fugle_daytrade_daily_volume_avg", { select: "*", order: "symbol.asc" }, symbols, ancillaryIssues),
    readRowsForSymbols(source, "strategy4_daily_ohlcv_view", { select: "symbol,trade_date,open,high,low,close", trade_date: `lt.${tradeDate}`, order: "trade_date.desc,symbol.asc" }, symbols, ancillaryIssues),
    readRowsForSymbols(source, "v_stock_future_live_contract", { select: "*", order: "relative_to_txf_percent.desc,futopt_total_volume.desc" }, symbols, ancillaryIssues),
    readRowsForSymbols(source, "fugle_preopen_snapshot", { select: "*", order: "updated_at.desc" }, symbols, ancillaryIssues),
    safeReadRows(source, "v_fugle_daytrade_canonical_gate", { select: "*", limit: "5" }, ancillaryIssues),
    safeReadRows(source, "source_status", { select: "source_name,status,updated_at,payload", source_name: `eq.${SOURCE_NAME}`, order: "updated_at.desc", limit: "1" }, ancillaryIssues),
  ]);
  const dailyAverageBySymbol = newestBySymbol(dailyAverageRows);
  const previousDailyBySymbol = newestBySymbol(previousDailyRows);
  const futureBySymbol = newestBySymbol(futureRows.filter((row) => String(row.trade_date || "") === tradeDate));
  const preopenBySymbol = newestBySymbol(preopenRows.filter((row) => String(row.trade_date || row.payload?.trade_date || tradeDate) === tradeDate));
  const canonicalGate = canonicalRows.find((row) => String(row.trade_date || row.date || "") === tradeDate) || {};
  const sourceStatusPayload = sourceStatusRows[0]?.payload || {};
  const websocket = sharedSourceEvidence(sourceStatusRows[0] || {}, tradeDate, expectedCanonicalRunId, now);
  const gateGrade = String(canonicalGate.canonical_gate_grade || canonicalGate.gate_grade || sourceStatusPayload.daytrade_gate_grade || sourceStatusPayload.gate_grade || "").toUpperCase();
  const formalEntryAllowed = bool(canonicalGate.formal_entry_allowed ?? sourceStatusPayload.formal_entry_allowed);
  const quoteBySymbol = new Map();
  for (const rawQuote of quoteRows) {
    const symbol = symbolOf(rawQuote);
    if (!requestedSymbols.has(symbol)) continue;
    if (!quoteBySymbol.has(symbol)) quoteBySymbol.set(symbol, rawQuote);
  }
  const candleBySymbol = new Map();
  let candleRows = 0;
  for (const rawCandle of candleRowsRaw) {
    const symbol = symbolOf(rawCandle);
    const candleTime = rawCandle.candle_time || "";
    const candleTradeDate = rawCandle.trade_date || "";
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
      source_name: rawCandle.source_name || "",
      is_fallback: bool(rawCandle.is_fallback),
      intraday_odd_lot: bool(rawCandle.intraday_odd_lot),
      is_formal_entry_eligible: bool(rawCandle.is_formal_entry_eligible),
      updated_at: rawCandle.updated_at || "",
    });
    candleRows += 1;
  }
  const rows = poolRows.map((poolRow) => {
    const symbol = String(poolRow.symbol || "");
    const payload = poolRow.payload || {};
    const metrics = payload.motherPoolMetrics || {};
    const dailyAverage = dailyAverageBySymbol.get(symbol) || {};
    const previousDaily = previousDailyBySymbol.get(symbol) || {};
    const future = futureBySymbol.get(symbol) || {};
    const preopen = preopenBySymbol.get(symbol) || {};
    const quote = quoteBySymbol.get(symbol) || {};
    const symbolCandles = (candleBySymbol.get(symbol) || []).sort((left, right) => String(left.candle_time).localeCompare(String(right.candle_time)));
    const quoteTime = quote.quote_seen_at || quote.updated_at || "";
    const quoteSeenMs = Date.parse(String(quoteTime || ""));
    const quoteAgeSeconds = Number.isFinite(quoteSeenMs) ? Math.max(0, Math.round((now.getTime() - quoteSeenMs) / 1000)) : 999999;
    const lastCandleTime = symbolCandles.at(-1)?.candle_time || "";
    const lastCandleMs = Date.parse(String(lastCandleTime || ""));
    const intraday1mStaleSeconds = Number.isFinite(lastCandleMs) ? Math.max(0, Math.round((now.getTime() - lastCandleMs) / 1000)) : 999999;
    const hasRequired1mWindow = symbolCandles.length >= MIN_CANDLES && intraday1mStaleSeconds <= 180;
    const hasFormalQuote = websocket.formalReady && number(quote.price) >= 50 && number(quote.total_volume) > 0 && quoteAgeSeconds <= 120;
    const avg5Volume = number(dailyAverage.avg5_volume || dailyAverage.avg_volume5 || dailyAverage.volume);
    const estimatedVolumeRatio = number(metrics.volumeRatio5) || (avg5Volume > 0 ? number(quote.total_volume) / avg5Volume : 0);
    const previousClose = number(previousDaily.close);
    const changePercent = previousClose > 0 ? ((number(quote.price) - previousClose) / previousClose) * 100 : 0;
    const previousHigh = number(previousDaily.high);
    const previousLow = number(previousDaily.low);
    const previousRange = previousHigh - previousLow;
    const threeGateLevels = previousRange >= 0 && previousLow > 0 ? {
      upper: previousLow + previousRange * 1.382,
      middle: (previousHigh + previousLow) / 2,
      lower: previousHigh - previousRange * 1.382,
      referenceDate: previousDaily.trade_date || "",
    } : null;
    const candleMinuteSet = new Set(symbolCandles.map((candle) => String(candle.candle_time || "").slice(11, 16)));
    const openingWindowReady = ["09:00", "09:01", "09:02", "09:03"].every((minute) => candleMinuteSet.has(minute));
    const openingCandle = symbolCandles.find((candle) => String(candle.candle_time || "").slice(11, 16) === "09:01") || {};
    const futureFresh = bool(future.futopt_fresh_60s ?? future.source_status === "ok") && bool(future.txf_fresh_60s ?? future.source_status === "ok");
    const stockFutureSync = futureFresh && number(future.futopt_change_percent) > 0 && number(future.relative_to_txf_percent) > 0 && changePercent > 0;
    const bidAskRatio = number(preopen.ask_volume) > 0 ? number(preopen.bid_volume) / number(preopen.ask_volume) : 0;
    const trialRisePct = number(preopen.reference_price) > 0 ? ((number(preopen.trial_price) - number(preopen.reference_price)) / number(preopen.reference_price)) * 100 : 0;
    const starPreopen = String(future.future_symbol || "").toUpperCase() !== "TXF"
      && number(future.futopt_last_price) > 0 && number(future.futopt_change_percent) >= 2
      && number(future.relative_to_txf_percent) >= 1 && number(future.futopt_total_volume) >= 50
      && number(preopen.trial_price) > 0 && number(preopen.reference_price) > 0 && trialRisePct >= 2
      && bidAskRatio >= 1.5 && number(preopen.best_bid_price) >= number(preopen.trial_price);
    const canonicalRunMatches = String(payload.canonical_run_id || payload.run_id || "") === expectedCanonicalRunId;
    const commonStockDaytradeEligible = bool(payload.basePoolEligible ?? metrics.basePoolEligible);
    const waterGapReasons = [];
    if (!hasFormalQuote) waterGapReasons.push("formal_quote_missing_or_stale");
    if (symbolCandles.length < MIN_CANDLES) waterGapReasons.push("formal_1m_below_minimum");
    else if (intraday1mStaleSeconds > 180) waterGapReasons.push("formal_1m_stale");
    if (!canonicalRunMatches) waterGapReasons.push("canonical_run_mismatch");
    if (!commonStockDaytradeEligible) waterGapReasons.push("common_stock_daytrade_eligibility_missing");
    if (estimatedVolumeRatio < 1) waterGapReasons.push("estimated_volume_ratio_below_one_or_missing");
    if (!threeGateLevels) waterGapReasons.push("previous_day_high_low_missing");
    const dataGap = waterGapReasons.length > 0;
    const dataGapReason = waterGapReasons.join(",");
    return {
      code: symbol,
      symbol,
      name: quote.name || poolRow.name || symbol,
      market: quote.market || poolRow.market || "",
      price: number(quote.price),
      totalVolume: number(quote.total_volume),
      previousClose,
      changePercent,
      avg5Volume,
      estimatedVolumeRatio,
      priorityRank: number(poolRow.priority_rank),
      sourceRunId: String(payload.canonical_run_id || payload.run_id || ""),
      expectedCanonicalRunId,
      canonicalRunMatches,
      quoteSource: "fugle_daytrade_quotes_live",
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
      commonStockDaytradeEligible,
      gateGrade,
      formalEntryAllowed,
      threeGateLevels,
      openingWindowReady,
      openingReferencePrice: number(openingCandle.high || openingCandle.open),
      stockFutureSync,
      starPreopen,
      futureEvidence: future,
      preopenEvidence: preopen,
      formalQuoteReady: hasFormalQuote,
      formalOneMinuteReady: websocket.formalReady && hasRequired1mWindow,
      strategy2WaterReady: !dataGap,
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
  const formalReadyRows = rows.filter((row) => row.strategy2WaterReady).length;
  const formalWaterCoverageRatio = ratio(formalReadyRows, rows.length);
  return {
    rows,
    poolRows: poolRows.length,
    quoteRows: quoteBySymbol.size,
    candleRows,
    candleBySymbol,
    websocket,
    formalReadyRows,
    formalWaterCoverageRatio,
    expectedCanonicalRunId,
    ancillaryIssues,
    ancillaryCoverage: {
      dailyVolumeAverageRows: dailyAverageBySymbol.size,
      previousDailyRows: previousDailyBySymbol.size,
      stockFutureRows: futureBySymbol.size,
      preopenRows: preopenBySymbol.size,
      gateGrade,
      formalEntryAllowed,
    },
    requiredFormalWaterCoverageRatio: MIN_FORMAL_WATER_COVERAGE_RATIO,
    formalWaterCoverageOk: rows.length > 0 && formalWaterCoverageRatio >= MIN_FORMAL_WATER_COVERAGE_RATIO,
    liveEvidence: "supabase:fugle_daytrade_quotes_live+fugle_daytrade_intraday_1m",
  };
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
  const diagnostic = process.argv.includes("--diagnostic");
  const force = process.argv.includes("--force");
  const formalReceiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water.json");
  const diagnosticReceiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v3-water-diagnostic-latest.json");
  const receiptPath = diagnostic ? diagnosticReceiptPath : formalReceiptPath;
  const previousReceipt = readJson(formalReceiptPath);
  const previousAgeMs = previousReceipt?.updatedAt ? now.getTime() - Date.parse(previousReceipt.updatedAt) : Number.POSITIVE_INFINITY;
  if (!diagnostic && !force
    && previousReceipt?.runId === `strategy2-v3-live-${clock.ymd}-canonical`
    && previousReceipt?.tradeDate === clock.date
    && Number.isFinite(previousAgeMs) && previousAgeMs >= 0 && previousAgeMs < 55000) {
    console.log(JSON.stringify({ ok: true, cached: true, status: previousReceipt.status, runId: previousReceipt.runId, dataDate: previousReceipt.dataDate, ageMs: previousAgeMs, receipt: receiptPath }, null, 2));
    return;
  }
  const source = config();
  if (!source.url || !source.key) throw new Error("strategy2_v3_supabase_credentials_missing");
  const water = await readFormalWater(source, clock.date);
  const scanned = water.rows.filter((row) => row.strategy2WaterReady);
  const dataGaps = water.rows.filter((row) => row.dataGap);
  const liveWindow = clock.minuteOfDay >= 9 * 60 && clock.minuteOfDay <= (12 * 60 + 30);
  const complete = water.formalWaterCoverageOk === true;
  const runId = diagnostic
    ? `strategy2-v3-diagnostic-${clock.ymd}-${String(clock.hour).padStart(2, "0")}${String(clock.minute).padStart(2, "0")}${String(clock.second).padStart(2, "0")}`
    : `strategy2-v3-live-${clock.ymd}-canonical`;
  const report = {
    ok: complete,
    strategy: "strategy2",
    version: "v3",
    strategyContract: CONTRACT,
    runId,
    dataDate: clock.date,
    tradeDate: clock.date,
    updatedAt: now.toISOString(),
    status: diagnostic
      ? "diagnostic_water_ready"
      : !liveWindow
        ? "water_ready_outside_live_window"
        : complete
          ? "water_ready_for_live_strategy"
          : "water_incomplete_live_window",
    complete,
    liveWindow,
    publishAllowed: false,
    formalDisplayAllowed: false,
    reason: diagnostic
      ? "diagnostic_v3_water_validation_only"
      : complete ? "strategy2_v3_formal_water_ready" : "strategy2_v3_formal_water_incomplete",
    sourceContract: {
      motherPool: "fugle_daytrade_priority_pool",
      quote: "fugle_daytrade_quotes_live",
      intraday1m: "fugle_daytrade_intraday_1m",
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
      formalWaterCoverageRatio: water.formalWaterCoverageRatio,
      requiredFormalWaterCoverageRatio: water.requiredFormalWaterCoverageRatio,
      formalWaterCoverageOk: water.formalWaterCoverageOk,
      coverageGrade: water.formalWaterCoverageRatio >= 0.9 ? "A" : water.formalWaterCoverageRatio >= 0.7 ? "B" : "C",
      expectedCanonicalRunId: water.expectedCanonicalRunId,
      ancillaryCoverage: water.ancillaryCoverage,
      ancillaryIssues: water.ancillaryIssues,
      dataGapCount: dataGaps.length,
      noLegacyReadbackViews: true,
      noTop40Gate: true,
      noPreviousGoodFallback: true,
    },
  };
  const base = path.join(RUNTIME_DIR, "data", "strategy2-v3");
  writeJson(path.join(base, diagnostic ? "latest-diagnostic.json" : "latest.json"), report);
  writeJson(receiptPath, report);
  console.log(JSON.stringify({ ok: report.ok, status: report.status, runId, dataDate: report.dataDate, expectedCount: report.expectedCount, scannedCount: report.scannedCount, dataGapCount: report.dataGapCount, receipt: receiptPath }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const clock = taipeiClock();
    const diagnostic = process.argv.includes("--diagnostic");
    const receipt = { ok: false, strategy: "strategy2", version: "v3", strategyContract: CONTRACT, dataDate: clock.date, status: "failed", reason: error?.message || String(error), updatedAt: new Date().toISOString() };
    writeJson(path.join(RUNTIME_DIR, "data", "scan-receipts", diagnostic ? "strategy2-v3-water-diagnostic-latest.json" : "strategy2-v3-water.json"), receipt);
    console.error(JSON.stringify(receipt, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { CONTRACT, MIN_CANDLES, MIN_FORMAL_WATER_COVERAGE_RATIO, taipeiClock, number, bool, ratio, config, sharedSourceEvidence, readFormalWater };

