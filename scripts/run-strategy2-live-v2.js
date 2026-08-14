"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data");
const SNAPSHOT_KEY = "strategy2_live_v2";
const SCORECARD_SNAPSHOT_KEY = "strategy2_v2_scorecard_source";
const CONTRACT = "strategy2-live-v2-fugle-mother-pool-1m";
const SOURCE_NAME = "fugle_daytrade_source";
const MIN_PRICE = 50;
const MIN_CANDLES = 35;

function arg(name) {
  return process.argv.includes(`--${name}`);
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour") || 0);
  const minute = Number(get("minute") || 0);
  const second = Number(get("second") || 0);
  return { date: `${year}-${month}-${day}`, ymd: `${year}${month}${day}`, hour, minute, second, minuteOfDay: hour * 60 + minute };
}

function taipeiMinute(value) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return taipeiParts(new Date(parsed)).minuteOfDay;
  const match = String(value || "").match(/(?:T|\b)(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const n = number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function emaSeries(values, period) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  let previous = values[0];
  return values.map((value, index) => {
    previous = index === 0 ? value : value * alpha + previous * (1 - alpha);
    return previous;
  });
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function latestEma(values, period) {
  return emaSeries(values, period).at(-1) || 0;
}

function indicatorSeries(candles) {
  const closes = candles.map((row) => number(row.close));
  const highs = candles.map((row) => number(row.high));
  const lows = candles.map((row) => number(row.low));
  const volumes = candles.map((row) => number(row.volume));
  const ema3 = emaSeries(closes, 3);
  const ema5 = emaSeries(closes, 5);
  const ema10 = emaSeries(closes, 10);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const ema30 = emaSeries(closes, 30);
  const ema58 = emaSeries(closes, 58);
  const macdLine = closes.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
  const signal = emaSeries(macdLine, 9);
  const histogram = macdLine.map((value, index) => value - (signal[index] || 0));
  const k = [];
  const d = [];
  const prefixHigh = [];
  const prefixLow = [];
  const averageVolume5 = [];
  let runningHigh = -Infinity;
  let runningLow = Infinity;
  let rollingVolume = 0;
  for (let index = 0; index < closes.length; index += 1) {
    runningHigh = Math.max(runningHigh, highs[index] || 0);
    runningLow = Math.min(runningLow, lows[index] || 0);
    prefixHigh.push(runningHigh);
    prefixLow.push(runningLow);
    const start = Math.max(0, index - 8);
    const localHigh = Math.max(...highs.slice(start, index + 1));
    const localLow = Math.min(...lows.slice(start, index + 1));
    k.push(localHigh > localLow ? ((closes[index] - localLow) / (localHigh - localLow)) * 100 : 50);
    d.push(average(k.slice(Math.max(0, index - 2), index + 1)));
    rollingVolume += volumes[index] || 0;
    if (index >= 5) rollingVolume -= volumes[index - 5] || 0;
    averageVolume5.push(rollingVolume / Math.min(5, index + 1));
  }
  return { closes, highs, lows, volumes, ema3, ema5, ema10, ema30, ema58, macdLine, histogram, k, d, prefixHigh, prefixLow, averageVolume5 };
}

function indicatorAt(series, candles, index) {
  return {
    close: series.closes[index] || 0,
    previousClose: series.closes[index - 1] || 0,
    open: number(candles[index]?.open),
    high: series.prefixHigh[index] || 0,
    low: series.prefixLow[index] || 0,
    ema3: series.ema3[index] || 0,
    ema3Previous: series.ema3[index - 1] || 0,
    ema5: series.ema5[index] || 0,
    ema10: series.ema10[index] || 0,
    ema30: series.ema30[index] || 0,
    ema58: series.ema58[index] || 0,
    macd: series.macdLine[index] || 0,
    macdHistogram: series.histogram[index] || 0,
    macdHistogramPrevious: series.histogram[index - 1] || 0,
    k: series.k[index] || 0,
    d: series.d[index] || 0,
    previousK: series.k[index - 1] || 0,
    previousD: series.d[index - 1] || 0,
    averageVolume5: series.averageVolume5[index] || 0,
    currentVolume: series.volumes[index] || 0,
  };
}

function indicatorSet(candles) {
  if (!candles.length) return {};
  const series = indicatorSeries(candles);
  return indicatorAt(series, candles, candles.length - 1);
}

function dynamicGates(high, low) {
  if (!(high > low) || low <= 0) return null;
  const range = high - low;
  return {
    upperGate: round(low + range * 1.382),
    middleGate: round((high + low) / 2),
    lowerGate: round(high - range * 1.382),
    dynamicHigh: round(high),
    dynamicLow: round(low),
  };
}

function isFormalCandle(row, { diagnosticReplay = false } = {}) {
  return row?.source_name === SOURCE_NAME
    && row?.is_fallback !== true
    && row?.intraday_odd_lot !== true
    // After close the writer marks archived 1m rows non-entry-eligible. Diagnostic replay may read them;
    // live formal scans still require the writer's real-time formal-entry flag.
    && (diagnosticReplay || row?.is_formal_entry_eligible !== false);
}

function quoteFresh(row, now) {
  const direct = number(row.quote_age_seconds);
  if (direct) return direct <= 120;
  const timestamp = Date.parse(String(row.quote_seen_at || row.quote_updated_at || row.updated_at || ""));
  return Number.isFinite(timestamp) && now.getTime() - timestamp <= 120000;
}

function motherEligibility(row) {
  const issues = [];
  const price = number(row.price);
  if (row.source_name !== SOURCE_NAME) issues.push("source_not_dedicated_fugle_daytrade");
  if (!/^(TSE|OTC)$/i.test(String(row.market || ""))) issues.push("not_twse_or_tpex_common_stock");
  if (price < MIN_PRICE) issues.push("price_below_50");
  if (!(number(row.total_volume) > 0)) issues.push("volume_missing");
  return issues;
}

function evaluateSignalSet(row, indicators, latest, openingHigh, openingOpen) {
  const gates = dynamicGates(indicators.high, indicators.low);
  const bullishKd = indicators.k > indicators.d && (indicators.k > indicators.previousK || indicators.k > indicators.previousD);
  const bullishMacd = indicators.macdHistogram > 0 && indicators.macdHistogram >= indicators.macdHistogramPrevious;
  const ma3Up = indicators.ema3 > indicators.ema3Previous;
  const green = indicators.close >= indicators.open;
  const aboveOpen = indicators.close > openingOpen;
  const breakout = indicators.close > openingHigh && ma3Up && (bullishKd || bullishMacd);
  const reclaim = indicators.previousClose <= indicators.ema3Previous && indicators.close > indicators.ema3 && ma3Up && green && (bullishKd || bullishMacd);
  const nearSupport = indicators.low <= indicators.ema10 * 1.003 || indicators.low <= indicators.ema30 * 1.003;
  const ppp = indicators.close > indicators.ema3 && indicators.ema3 > indicators.ema5 && indicators.ema5 > indicators.ema10 && indicators.ema10 > indicators.ema30 && ma3Up && nearSupport && (bullishKd || bullishMacd);
  const volumeConfirm = number(row.volume_vs_avg5_ratio || row.relative_volume_ratio) >= 2 || number(row.total_volume) >= number(row.avg5_volume) * 2;
  const signals = [];
  if (breakout) signals.push({ id: "s2v2_opening_breakout", label: "開盤區間突破", reason: "突破 09:00 首根高點 " + round(openingHigh) + "，EMA3上揚，KD/MACD轉多" });
  if (reclaim) signals.push({ id: "s2v2_ma3_reclaim", label: "MA3 收復", reason: "回到 EMA3 上方，紅K，KD/MACD轉多" });
  if (ppp) signals.push({ id: "s2v2_ppp_pullback", label: "PPP 強勢回踩", reason: "EMA3/5/10/30 多頭，回踩支撐後站回 EMA3" });
  if (!signals.length && volumeConfirm && aboveOpen && ma3Up && (bullishKd || bullishMacd)) signals.push({ id: "s2v2_volume_momentum", label: "量價動能", reason: "相對量放大、站上開盤、EMA3 與 KD/MACD 轉多" });
  return { gates, signals, volumeConfirm };
}

function detectLiveSignals(row, candles) {
  const series = indicatorSeries(candles);
  const latest = candles.at(-1) || {};
  const firstAfterOpen = candles.find((candle) => taipeiMinute(candle.candle_time) >= 9 * 60) || candles[0];
  const openingHigh = number(firstAfterOpen?.high);
  const openingOpen = number(firstAfterOpen?.open);
  const indicators = indicatorAt(series, candles, candles.length - 1);
  const signalState = evaluateSignalSet(row, indicators, latest, openingHigh, openingOpen);
  return { indicators, latest, ...signalState, openingHigh, openingOpen };
}

function buildScanBase(row, scan, clock, scanMode) {
  return {
    code: String(row.symbol),
    symbol: String(row.symbol),
    name: String(row.name || row.symbol),
    market: row.market || "",
    price: round(scan.indicators.close),
    entryPrice: round(scan.indicators.close),
    entryAt: scan.latest.candle_time,
    timestamp: scan.latest.candle_time,
    scanDate: clock.date,
    tradeDate: clock.date,
    source: SOURCE_NAME,
    scanMode,
    entryPriceSource: "fugle_daytrade_intraday_1m_live",
    entryCandleTime: scan.latest.candle_time,
    entryTradeDate: clock.date,
    motherPoolScore: number(row.mother_pool_score || row.mother_score),
    priorityScore: number(row.priority_score),
    totalVolume: number(row.total_volume),
    tradeValue: number(row.trade_value),
    volumeVsAvg5Ratio: round(row.volume_vs_avg5_ratio || row.relative_volume_ratio),
    scanEvidence: {
      motherPoolSource: SOURCE_NAME,
      motherPoolRuleHits: row.mother_pool_rule_hits || [],
      poolReasons: row.pool_reasons || row.mother_reason || "",
      candleCount: scan.candleCount || 0,
      latestCandleTime: scan.latest.candle_time,
      ma3: round(scan.indicators.ema3), ma5: round(scan.indicators.ema5), ma10: round(scan.indicators.ema10), ma30: round(scan.indicators.ema30), ma58: round(scan.indicators.ema58),
      k: round(scan.indicators.k), d: round(scan.indicators.d), macdHistogram: round(scan.indicators.macdHistogram, 4),
      volumeConfirm: scan.volumeConfirm,
    },
    ...(scan.gates || {}),
  };
}

// Reconstruct one first-valid 09:00-12:00 entry per stock from formal Fugle 1m candles.
// Subsequent same-day oscillations are not duplicate strategy entries.
function scanTimelineSignals(row, candles, clock, scanMode) {
  const series = indicatorSeries(candles);
  const firstAfterOpen = candles.find((candle) => taipeiMinute(candle.candle_time) >= 9 * 60) || candles[0];
  const openingHigh = number(firstAfterOpen?.high);
  const openingOpen = number(firstAfterOpen?.open);
  for (let index = MIN_CANDLES - 1; index < candles.length; index += 1) {
    const candleTime = candles[index]?.candle_time || "";
    const minute = taipeiMinute(candleTime);
    if (minute < 9 * 60 || minute > 12 * 60) continue;
    const indicators = indicatorAt(series, candles, index);
    const latest = candles[index];
    const signalState = evaluateSignalSet(row, indicators, latest, openingHigh, openingOpen);
    if (!signalState.signals.length) continue;
    const scan = { indicators, latest, ...signalState, openingHigh, openingOpen, candleCount: index + 1 };
    const signal = scan.signals[0];
    const base = buildScanBase(row, scan, clock, scanMode);
    return [{
      ...base,
      stateId: "entry",
      stateLabel: scanMode === "postclose_diagnostic_replay" ? "盤後診斷回放候選" : "正式進場候選",
      formalCandidate: scanMode !== "postclose_diagnostic_replay",
      eventOrigin: scanMode,
      signalId: signal.id,
      signal: signal.label,
      reason: signal.reason,
      score: round(number(row.mother_pool_score || row.mother_score) + number(row.priority_score) + (scan.volumeConfirm ? 12 : 0)),
    }];
  }
  return [];
}

function sourceConfig() {
  const root = ROOT;
  const runtimeDir = RUNTIME_DIR;
  return {
    url: terminalSupabaseUrl({ root, runtimeDir }).replace(/\/+$/, ""),
    key: terminalSupabaseKey({ root, runtimeDir }),
  };
}

async function readRows(config, table, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${config.url}/rest/v1/${table}?${query.toString()}`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: "application/json", Range: "0-99999" },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : [];
}

async function readCandles(config, date, symbols) {
  const groups = [];
  for (let index = 0; index < symbols.length; index += 40) groups.push(symbols.slice(index, index + 40));
  const rows = [];
  for (const group of groups) {
    // Supabase caps one REST page at 1,000 rows. Page every 40-symbol slice so
    // no valid Mother Pool symbol disappears merely because another symbol has a long 1m history.
    for (let offset = 0; ; offset += 1000) {
      const page = await readRows(config, "fugle_daytrade_intraday_1m", {
        select: "symbol,market,trade_date,candle_time,open,high,low,close,volume,updated_at,source_name,source_kind,is_fallback,is_formal_entry_eligible,synthetic,volume_strategy_usable,intraday_odd_lot",
        trade_date: `eq.${date}`,
        source_name: `eq.${SOURCE_NAME}`,
        symbol: `in.(${group.join(",")})`,
        order: "candle_time.asc",
        limit: "1000",
        offset: String(offset),
      });
      rows.push(...page);
      if (page.length < 1000) break;
    }
  }
  return rows;
}
function historyPayload(report) {
  const file = path.join(DATA_DIR, "strategy2-v2-history", report.dataDate + ".json");
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const byKey = new Map();
  const sourceEvents = report.mode === "postclose_diagnostic_replay"
    ? report.events
    : [...(Array.isArray(previous.events) ? previous.events : []), ...report.events];
  for (const row of sourceEvents) {
    const key = String(row.code) + "|" + String(row.signalId) + "|" + String(row.entryAt);
    byKey.set(key, row);
  }
  const events = [...byKey.values()].sort((a, b) => String(b.entryAt).localeCompare(String(a.entryAt)));
  return {
    strategy: "strategy2",
    strategyContract: CONTRACT,
    dataDate: report.dataDate,
    runId: report.runId,
    mode: report.mode,
    updatedAt: report.updatedAt,
    events,
    records: events,
    sourceCoverage: report.sourceCoverage,
  };
}

function terminalSnapshotPayload(report) {
  const events = report.events.map((row) => ({
    code: row.code, symbol: row.symbol, name: row.name, market: row.market,
    price: row.price, entryPrice: row.entryPrice, entryAt: row.entryAt, timestamp: row.timestamp,
    scanDate: row.scanDate, tradeDate: row.tradeDate, source: row.source, scanMode: row.scanMode,
    entryPriceSource: row.entryPriceSource, entryCandleTime: row.entryCandleTime, entryTradeDate: row.entryTradeDate,
    stateId: row.stateId, stateLabel: row.stateLabel, formalCandidate: row.formalCandidate, eventOrigin: row.eventOrigin,
    signalId: row.signalId, signal: row.signal, reason: row.reason, score: row.score,
    upperGate: row.upperGate, middleGate: row.middleGate, lowerGate: row.lowerGate, dynamicHigh: row.dynamicHigh, dynamicLow: row.dynamicLow,
    totalVolume: row.totalVolume, tradeValue: row.tradeValue, volumeVsAvg5Ratio: row.volumeVsAvg5Ratio,
  }));
  const { records, rows, matches, events: ignoredEvents, ...base } = report;
  return { ...base, events };
}

async function main() {
  const now = new Date();
  const clock = taipeiParts(now);
  const diagnosticReplay = arg("diagnostic-replay");
  const finalize = arg("finalize");
  const config = sourceConfig();
  if (!config.url || !config.key) throw new Error("strategy2_v2_supabase_credentials_missing");
  const motherRows = await readRows(config, "v_fugle_daytrade_mother_pool", {
    select: "trade_date,symbol,name,market,price,open_price,previous_close,change_percent,total_volume,trade_value,avg5_volume,mother_pool_score,priority_score,mother_pool_rank,mother_reason,mother_source,mother_pool_rule_hits,mother_pool_metrics,quote_seen_at,quote_updated_at,quote_age_seconds,source_name,updated_at,high_price,low_price,volume_vs_avg5_ratio,relative_volume_ratio,ma3_turn_up,ma5_turn_up,ma10_turn_up,ma30_turn_up,ma58_turn_up,ma_bull_stack_short,ma_bull_stack_mid,above_open_price,opening_range_break,surge_flag,volume_spike_flag,strategy_source_flags,pool_reasons",
    trade_date: `eq.${clock.date}`,
    source_name: `eq.${SOURCE_NAME}`,
    order: "mother_pool_score.desc",
    limit: "1000",
  });
  const rejected = {};
  const eligible = motherRows.filter((row) => {
    const issues = motherEligibility(row);
    for (const issue of issues) rejected[issue] = (rejected[issue] || 0) + 1;
    return issues.length === 0;
  });
  const symbols = eligible.map((row) => String(row.symbol)).filter((symbol) => /^\d{4}$/.test(symbol));
  const candleRows = await readCandles(config, clock.date, symbols);
  const candlesBySymbol = new Map();
  for (const row of candleRows) {
    if (!isFormalCandle(row, { diagnosticReplay })) continue;
    const key = String(row.symbol || "");
    if (!candlesBySymbol.has(key)) candlesBySymbol.set(key, []);
    candlesBySymbol.get(key).push(row);
  }
  const records = [];
  const events = [];
  const dataGaps = [];
  for (const row of eligible) {
    const code = String(row.symbol);
    const candles = (candlesBySymbol.get(code) || []).sort((a, b) => String(a.candle_time).localeCompare(String(b.candle_time)));
    if (candles.length < MIN_CANDLES) {
      dataGaps.push({ code, name: row.name || "", candleCount: candles.length, firstCandleTime: candles[0]?.candle_time || "", lastCandleTime: candles.at(-1)?.candle_time || "", reason: "formal_1m_below_ma35_readiness" });
      continue;
    }
    const latestScan = detectLiveSignals(row, candles);
    latestScan.candleCount = candles.length;
    const scanMode = diagnosticReplay ? "postclose_diagnostic_replay" : "live_window";
    const base = buildScanBase(row, latestScan, clock, scanMode);
    records.push({ ...base, stateId: "scanned", stateLabel: "完整掃描", formalCandidate: false, signals: latestScan.signals.map((signal) => signal.id) });
    events.push(...scanTimelineSignals(row, candles, clock, scanMode));
  }
  events.sort((a, b) => String(b.entryAt).localeCompare(String(a.entryAt)));
  const freshCount = eligible.filter((row) => quoteFresh(row, now)).length;
  const freshCoverage = eligible.length ? freshCount / eligible.length : 0;
  const fullScanComplete = records.length + dataGaps.length === eligible.length;
  const liveWindow = clock.minuteOfDay >= 9 * 60 && clock.minuteOfDay <= 12 * 60;
  const formal = !diagnosticReplay && liveWindow && fullScanComplete && eligible.length > 0 && freshCoverage >= 0.95;
  const runId = `strategy2-v2-${clock.ymd}-${String(clock.hour).padStart(2, "0")}${String(clock.minute).padStart(2, "0")}${String(clock.second).padStart(2, "0")}`;
  const status = formal ? (finalize ? "complete" : "live") : diagnosticReplay ? "diagnostic_replay" : "blocked";
  const report = {
    ok: formal,
    strategy: "strategy2",
    strategyContract: CONTRACT,
    version: "v2",
    source: "supabase:v_fugle_daytrade_mother_pool+fugle_daytrade_intraday_1m",
    dataDate: clock.date,
    date: clock.date,
    tradeDate: clock.date,
    runId,
    updatedAt: now.toISOString(),
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    mode: diagnosticReplay ? "postclose_diagnostic_replay" : finalize ? "live_window_finalization" : "live_window",
    status,
    complete: formal && finalize,
    formalDisplayAllowed: formal,
    publishAllowed: formal && finalize,
    qualityStatus: formal ? "complete" : diagnosticReplay ? "diagnostic" : "blocked",
    unattendedStatus: formal ? "YES" : "NO",
    preservePreviousGood: false,
    fallbackUsed: false,
    previousGoodRunId: "",
    scanWindow: { start: "09:00", end: "12:00", timezone: "Asia/Taipei" },
    expectedCount: eligible.length,
    scannedCount: records.length,
    dataGapCount: dataGaps.length,
    resultCount: events.length,
    count: events.length,
    records,
    events,
    rows: events,
    matches: events,
    dataGaps,
    sourceCoverage: {
      source: SOURCE_NAME,
      tradeDate: clock.date,
      motherPoolRows: motherRows.length,
      eligibleMotherPoolRows: eligible.length,
      motherPoolRejected: rejected,
      intraday1mRows: candleRows.length,
      intraday1mReadySymbols: records.length,
      freshQuoteCoverage120s: round(freshCoverage, 4),
      fullScanComplete,
      dataGapCount: dataGaps.length,
      noTop40Gate: true,
      noPreviousGoodFallback: true,
    },
    reason: formal ? "formal_fugle_mother_pool_live_scan" : diagnosticReplay ? "postclose_diagnostic_replay_not_formal_not_scorecard" : "live_window_or_formal_water_gate_not_ready",
    transport: { source: "strategy2-live-v2", snapshotKey: SNAPSHOT_KEY, runId, via: "scripts/run-strategy2-live-v2.js" },
  };
  const latestFile = path.join(DATA_DIR, "strategy2-v2-latest.json");
  const receiptFile = path.join(DATA_DIR, "scan-receipts", "strategy2-v2.json");
  writeJson(latestFile, report);
  writeJson(path.join(DATA_DIR, "strategy2-v2-history", `${clock.date}.json`), historyPayload(report));
  const snapshotPayload = terminalSnapshotPayload(report);
  const snapshot = await upsertSnapshot(SNAPSHOT_KEY, snapshotPayload, { tradeDate: clock.ymd, snapshotId: runId, source: "strategy2-live-v2", reason: report.reason, locked: Boolean(report.complete) });
  let scorecardSnapshot = { ok: false, skipped: true, reason: "not_formal_finalization" };
  if (report.publishAllowed) {
    const scorecard = { ...report, source: "strategy2-v2-scorecard-source", scorecardEligible: true, records: report.events, rows: report.events };
    writeJson(path.join(DATA_DIR, "strategy2-v2-scorecard-source.json"), scorecard);
    scorecardSnapshot = await upsertSnapshot(SCORECARD_SNAPSHOT_KEY, scorecard, { tradeDate: clock.ymd, snapshotId: runId, source: "strategy2-v2-scorecard-source", reason: "formal_live_window_finalization", locked: true });
  }
  const receipt = {
    strategy: "strategy2", version: "v2", strategyContract: CONTRACT, status: report.status, complete: report.complete,
    formalDisplayAllowed: report.formalDisplayAllowed, publishAllowed: report.publishAllowed, dataDate: report.dataDate, runId, expectedCount: report.expectedCount,
    scannedCount: report.scannedCount, resultCount: report.resultCount, dataGapCount: report.dataGapCount, qualityStatus: report.qualityStatus,
    unattendedStatus: report.unattendedStatus, previousGoodRunId: "", fallbackUsed: false, sourceCoverage: report.sourceCoverage,
    snapshot, scorecardSnapshot, startedAt: report.startedAt, finishedAt: report.finishedAt, reason: report.reason,
  };
  writeJson(receiptFile, receipt);
  console.log(JSON.stringify({ ok: true, status: report.status, formalDisplayAllowed: report.formalDisplayAllowed, runId, dataDate: report.dataDate, expectedCount: report.expectedCount, scannedCount: report.scannedCount, resultCount: report.resultCount, dataGapCount: report.dataGapCount, snapshot: snapshot.ok, scorecardSnapshot: scorecardSnapshot.ok, receiptPath: receiptFile }, null, 2));
}

main().catch((error) => {
  const file = path.join(DATA_DIR, "scan-receipts", "strategy2-v2.json");
  writeJson(file, { strategy: "strategy2", version: "v2", strategyContract: CONTRACT, status: "failed", complete: false, formalDisplayAllowed: false, publishAllowed: false, fallbackUsed: false, previousGoodRunId: "", finishedAt: new Date().toISOString(), reason: error?.message || String(error) });
  console.error(JSON.stringify({ ok: false, strategy: "strategy2", version: "v2", error: error?.message || String(error), receiptPath: file }, null, 2));
  process.exit(1);
});
