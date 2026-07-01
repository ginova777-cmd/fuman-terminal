"use strict";

const fs = require("fs");
const path = require("path");
const { buildRanks, cleanNumber, detectSignals, isIntradayTradable, roundTradePrice } = require("./intraday-radar-rules");
const {
  fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchFutoptStockMappingReady,
  fetchIntraday1m,
} = require("../lib/supabase-public-slot");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const OUT_FILE = process.env.STRATEGY2_FULL_REPLAY_OUT || path.join(DATA_DIR, "strategy2-intraday-latest.json");
const TRADE_DATE = process.env.STRATEGY2_REPLAY_DATE || "";
const START_TIME = process.env.STRATEGY2_REPLAY_START || "08:45:00";
const END_TIME = process.env.STRATEGY2_REPLAY_END || "13:30:00";
const MAX_CODES = Math.max(1, Number(process.env.STRATEGY2_FULL_REPLAY_MAX_CODES || 1200));
const CONCURRENCY = Math.max(1, Number(process.env.STRATEGY2_FULL_REPLAY_CONCURRENCY || 10));
const BARS_PER_SYMBOL = Number(process.env.STRATEGY2_FULL_REPLAY_BARS || 360);
const EARLY_TRACKING_START = process.env.STRATEGY2_EARLY_TRACKING_START || "09:00:00";
const EARLY_TRACKING_END = process.env.STRATEGY2_EARLY_TRACKING_END || "09:45:00";
const EARLY_TRACKING_PER_MINUTE = Math.max(1, Number(process.env.STRATEGY2_EARLY_TRACKING_PER_MINUTE || 20));
const EARLY_TRACKING_MIN_PCT = Number(process.env.STRATEGY2_EARLY_TRACKING_MIN_PCT || 1);
const EARLY_TRACKING_MIN_VOLUME = Number(process.env.STRATEGY2_EARLY_TRACKING_MIN_VOLUME || 100);
const STRATEGY2_MIN_AVG5D_VOLUME_OK = Number(process.env.STRATEGY2_MIN_AVG5D_VOLUME_OK || 3000);

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function todayTaipeiDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeDate(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return todayTaipeiDate();
}

function taipeiTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour12: false });
  }
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}:${match[3] || "00"}` : "";
}

function taipeiDate(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(parsed)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function secondsOfDay(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function avg(values) {
  const rows = values.map(cleanNumber).filter((value) => value > 0);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function ema(values, length) {
  const out = [];
  const k = 2 / (length + 1);
  values.forEach((value, index) => {
    out[index] = index === 0 ? value : value * k + out[index - 1] * (1 - k);
  });
  return out;
}

function techAt(candles, index) {
  const rows = candles.slice(0, index + 1);
  const closes = rows.map((row) => cleanNumber(row.close));
  const ma20 = rows.length >= 20 ? avg(closes.slice(-20)) : 0;
  const ma20Prev = rows.length >= 21 ? avg(closes.slice(-21, -1)) : 0;
  const ma35 = rows.length >= 35 ? avg(closes.slice(-35)) : 0;
  const ma35Prev = rows.length >= 36 ? avg(closes.slice(-36, -1)) : 0;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = closes.map((_, i) => (ema12[i] || 0) - (ema26[i] || 0));
  const dea = ema(dif, 9);
  const last = dif.length - 1;
  const prev = Math.max(0, last - 1);
  const hist = 2 * ((dif[last] || 0) - (dea[last] || 0));
  const prevHist = 2 * ((dif[prev] || 0) - (dea[prev] || 0));
  const kdWindow = rows.slice(Math.max(0, rows.length - 9));
  const high = Math.max(...kdWindow.map((row) => cleanNumber(row.high)));
  const low = Math.min(...kdWindow.map((row) => cleanNumber(row.low)));
  const rsv = high > low ? ((closes[last] - low) / (high - low)) * 100 : 50;
  const prevClose = cleanNumber(closes[prev]);
  return {
    ma20,
    ma20Prev,
    ma20TrendUp: ma20 > 0 && ma20Prev > 0 && ma20 >= ma20Prev,
    ma20Source: ma20 > 0 ? "supabase-fugle-1m" : "",
    ma35,
    ma35Prev,
    ma35TrendUp: ma35 > 0 && ma35Prev > 0 && ma35 >= ma35Prev,
    ma35Source: ma35 > 0 ? "supabase-fugle-1m" : "",
    macdDif: dif[last] || 0,
    macdSignal: dea[last] || 0,
    macdHist: hist,
    macdUp: hist >= prevHist,
    kdK: rsv,
    kdD: rsv,
    kdUp: rsv >= 50 && closes[last] >= prevClose,
    rsiUp: closes[last] >= prevClose,
    npsyUp: closes[last] >= prevClose,
  };
}

function openAmplitudePercent(stock) {
  const close = cleanNumber(stock.latest1mClose || stock.close);
  const open = cleanNumber(stock.open || stock.dayOpen || stock.latest1mOpen);
  if (close <= 0 || open <= 0) return cleanNumber(stock.percent);
  return ((close - open) / open) * 100;
}

function hasDailyMaBullishAlignment(stock) {
  const ma5 = cleanNumber(stock.dailyMa5 || stock.ma5 || stock.sma5);
  const ma10 = cleanNumber(stock.dailyMa10 || stock.ma10 || stock.sma10);
  const ma20 = cleanNumber(stock.dailyMa20 || stock.ma20 || stock.sma20);
  const ma60 = cleanNumber(stock.dailyMa60 || stock.ma60 || stock.sma60);
  const rows = [ma5, ma10, ma20, ma60].filter((value) => value > 0);
  if (rows.length < 3) return true;
  if (ma5 > 0 && ma10 > 0 && ma20 > 0 && ma5 < ma10) return false;
  if (ma10 > 0 && ma20 > 0 && ma10 < ma20) return false;
  if (ma20 > 0 && ma60 > 0 && ma20 < ma60) return false;
  return true;
}

function isStrategy2MotherPoolSnapshot(stock, volumeTop100Codes = new Set()) {
  const close = cleanNumber(stock.close);
  const pct = openAmplitudePercent(stock);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const avg5dVolume = cleanNumber(stock.avg5dVolume || stock.avg_5d_volume || stock.avgVolume5);
  const prevClosePct = cleanNumber(stock.prevClosePercent || stock.changePercent || stock.change_percent);
  const limitUp = cleanNumber(stock.limitUp || stock.limit_up_price || stock.limitUpPrice);
  const limitUpExcluded = limitUp > 0 ? close >= limitUp * 0.995 : prevClosePct >= 9.7;
  const channelAvg5 = avg5dVolume > STRATEGY2_MIN_AVG5D_VOLUME_OK;
  const channelStrongVolume = pct >= 2 && volume > 5000 && hasDailyMaBullishAlignment(stock);
  const channelVolumeRank = avg5dVolume > 0
    && volume > avg5dVolume * 2
    && volume >= 10000
    && volumeTop100Codes.has(String(stock.code || ""));
  return close >= 10
    && close <= 1000
    && pct >= 2
    && pct < 9.9
    && volume > 0
    && !limitUpExcluded
    && (channelAvg5 || channelStrongVolume || channelVolumeRank);
}

function buildSnapshot(base, candle, index, candles, cumulativeVolume, previousSnapshot, date, dayCandles = candles) {
  const time = taipeiTime(candle.candleTime || candle.time);
  const firstDayCandle = dayCandles[0] || candle;
  const previousClose = cleanNumber(base.prevClose || base.previousClose) || cleanNumber(firstDayCandle?.open) || cleanNumber(candle.open);
  const close = cleanNumber(candle.close);
  const dayOpen = cleanNumber(base.open) || cleanNumber(firstDayCandle?.open) || cleanNumber(candle.open) || close;
  const prevClosePercent = previousClose ? ((close - previousClose) / previousClose) * 100 : cleanNumber(base.percent);
  const amplitudePercent = dayOpen ? ((close - dayOpen) / dayOpen) * 100 : prevClosePercent;
  const tradeVolume = cumulativeVolume;
  const tech = techAt(candles, index);
  return {
    ...base,
    code: String(base.code || base.symbol || ""),
    date,
    timestamp: `${date} ${time}`,
    close,
    open: dayOpen,
    dayOpen,
    high: cleanNumber(candle.high) || close,
    low: cleanNumber(candle.low) || close,
    prevClose: previousClose,
    previousClose,
    change: close - previousClose,
    percent: amplitudePercent,
    amplitudePercent,
    prevClosePercent,
    limitUp: cleanNumber(base.limitUp || base.limitUpPrice || base.limit_up_price),
    tradeVolume,
    volume: tradeVolume,
    value: close * tradeVolume,
    quoteTime: time,
    time,
    quoteSource: "supabase-intraday-1m-replay",
    realtimeFallback: "supabase-intraday-1m-replay",
    isRealtime: true,
    deltaVolume: Math.max(0, tradeVolume - cleanNumber(previousSnapshot?.tradeVolume)),
    latest1mOpen: cleanNumber(candle.open),
    latest1mHigh: cleanNumber(candle.high),
    latest1mLow: cleanNumber(candle.low),
    latest1mClose: close,
    latest1mPrevClose: cleanNumber(candles[index - 1]?.close),
    latest1mVolume: cleanNumber(candle.volume),
    latest1mAt: candle.candleTime || candle.time,
    ma35Symbol: String(base.code || base.symbol || ""),
    ma35At: candle.candleTime || candle.time,
    ...tech,
  };
}

function recordFromMotherPool(stock) {
  const pct = openAmplitudePercent(stock);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const value = cleanNumber(stock.value) || cleanNumber(stock.close) * volume;
  const timeBucket = String(stock.quoteTime || stock.time || "").replace(/\D/g, "").slice(0, 4) || "unknown";
  return {
    date: stock.date,
    timestamp: stock.timestamp,
    entryAt: stock.timestamp,
    code: stock.code,
    name: stock.name || stock.code,
    strategy: "母池觀察",
    stateId: "watch",
    stateLabel: "待確認",
    stateReason: `符合策略2母池：幅度 ${pct.toFixed(2)}%，等待 1分K/MA35/MACD/KD 進一步確認。`,
    score: Math.min(88, Math.max(50, Math.round(48 + Math.max(0, pct) * 4))),
    entryPrice: roundTradePrice(stock.close),
    supportPrice: roundTradePrice(stock.ma35 || stock.low || stock.close),
    entryLow: roundTradePrice(stock.low || stock.close),
    entryHigh: roundTradePrice(stock.high || stock.close),
    stopLoss: roundTradePrice((stock.low || stock.close) * 0.985),
    chaseLimit: roundTradePrice(stock.close * 1.01),
    observedPrice: stock.close,
    close: stock.close,
    open: stock.open,
    quoteTime: stock.quoteTime,
    quoteSource: stock.quoteSource,
    observedHigh: stock.high,
    observedHighAt: stock.timestamp,
    observedLow: stock.low,
    observedLowAt: stock.timestamp,
    dayHigh: stock.high,
    dayHighAt: stock.timestamp,
    dayLow: stock.low,
    dayLowAt: stock.timestamp,
    volume,
    tradeVolume: volume,
    value,
    avg5dVolume: stock.avg5dVolume,
    percent: pct,
    amplitudePercent: pct,
    prevClosePercent: stock.prevClosePercent,
    limitUp: stock.limitUp,
    reason: `08:45-13:30 母池逐筆偵測：幅度 ${pct.toFixed(2)}%，量 ${Math.round(volume).toLocaleString("zh-TW")} 張。`,
    signalId: `strategy2_mother_pool_${timeBucket}`,
    strategyIds: ["strategy2_mother_pool"],
    strategyTags: ["母池觀察"],
    primaryStrategy: "母池觀察",
    strategyReasons: [`幅度 ${pct.toFixed(2)}%，成交量 ${Math.round(volume).toLocaleString("zh-TW")} 張，成交金額 ${Math.round(value / 10000).toLocaleString("zh-TW")} 萬。`],
    deltaVolume: stock.deltaVolume,
    ma35: stock.ma35,
    ma35Prev: stock.ma35Prev,
    aboveMa35: stock.ma35 > 0 && stock.close >= stock.ma35,
    ma35TrendUp: stock.ma35TrendUp,
    ma35Source: stock.ma35Source,
    ma35Symbol: stock.ma35Symbol,
    ma35At: stock.ma35At,
    macdDif: stock.macdDif,
    macdSignal: stock.macdSignal,
    macdHist: stock.macdHist,
    macdUp: stock.macdUp,
    kdK: stock.kdK,
    kdD: stock.kdD,
    kdUp: stock.kdUp,
    rsiUp: stock.rsiUp,
    npsyUp: stock.npsyUp,
    intradayVolumeBurst: stock.deltaVolume >= 50 || volume >= 10000,
    replayedFrom1mFullWindow: true,
    replayedMotherPool: true,
  };
}

function earlyTrackingScore(stock) {
  return Math.min(95, Math.max(60,
    Math.round(60 + cleanNumber(stock.percent) * 8 + Math.log10(Math.max(1, cleanNumber(stock.tradeVolume))) * 5 + Math.max(0, cleanNumber(stock.deltaVolume)) / 20)
  ));
}

function isEarlyTrackingCandidate(stock) {
  const seconds = secondsOfDay(stock?.quoteTime || stock?.time || stock?.timestamp);
  return seconds >= secondsOfDay(EARLY_TRACKING_START)
    && seconds <= secondsOfDay(EARLY_TRACKING_END)
    && cleanNumber(stock?.percent) >= EARLY_TRACKING_MIN_PCT
    && cleanNumber(stock?.tradeVolume || stock?.volume) >= EARLY_TRACKING_MIN_VOLUME
    && cleanNumber(stock?.close) > 0;
}

function recordFromEarlyTracking(stock) {
  const score = earlyTrackingScore(stock);
  const timeBucket = String(stock.quoteTime || stock.time || "").replace(/\D/g, "").slice(0, 4) || "unknown";
  return {
    date: stock.date,
    timestamp: stock.timestamp,
    entryAt: stock.timestamp,
    code: stock.code,
    name: stock.name || stock.code,
    strategy: "早盤逐筆追蹤",
    stateId: "watch",
    stateLabel: "早盤追蹤",
    stateReason: `09:00-09:45 逐分鐘追蹤：漲幅 ${cleanNumber(stock.percent).toFixed(2)}%，量 ${Math.round(cleanNumber(stock.tradeVolume)).toLocaleString("zh-TW")} 張。`,
    score,
    entryPrice: roundTradePrice(stock.close),
    supportPrice: roundTradePrice(stock.ma35 || stock.low || stock.close),
    entryLow: roundTradePrice(stock.low || stock.close),
    entryHigh: roundTradePrice(stock.high || stock.close),
    stopLoss: roundTradePrice((stock.low || stock.close) * 0.985),
    chaseLimit: roundTradePrice(stock.close * 1.01),
    observedPrice: stock.close,
    close: stock.close,
    open: stock.open,
    quoteTime: stock.quoteTime,
    quoteSource: stock.quoteSource,
    observedHigh: stock.high,
    observedHighAt: stock.timestamp,
    observedLow: stock.low,
    observedLowAt: stock.timestamp,
    dayHigh: stock.high,
    dayHighAt: stock.timestamp,
    dayLow: stock.low,
    dayLowAt: stock.timestamp,
    volume: stock.tradeVolume,
    tradeVolume: stock.tradeVolume,
    value: stock.value,
    avg5dVolume: stock.avg5dVolume,
    percent: stock.percent,
    reason: `早盤逐筆偵測 ${stock.quoteTime}：漲幅 ${cleanNumber(stock.percent).toFixed(2)}%，量 ${Math.round(cleanNumber(stock.tradeVolume)).toLocaleString("zh-TW")} 張。`,
    signalId: `early_tracking_${timeBucket}`,
    strategyIds: ["early_tracking"],
    strategyTags: ["早盤逐筆追蹤"],
    primaryStrategy: "早盤逐筆追蹤",
    strategyReasons: [`09:00-09:45 逐分鐘追蹤：${stock.quoteTime}`],
    deltaVolume: stock.deltaVolume,
    ma35: stock.ma35,
    ma35Prev: stock.ma35Prev,
    aboveMa35: stock.ma35 > 0 && stock.close >= stock.ma35,
    ma35TrendUp: stock.ma35TrendUp,
    ma35Source: stock.ma35Source,
    ma35Symbol: stock.ma35Symbol,
    ma35At: stock.ma35At,
    replayedFrom1mFullWindow: true,
    replayedEarlyTracking: true,
  };
}

function recordFromSignal(stock, signal) {
  return {
    date: stock.date,
    timestamp: stock.timestamp,
    entryAt: stock.timestamp,
    code: stock.code,
    name: stock.name || stock.code,
    strategy: signal.label || "策略2偵測",
    stateId: signal.id === "ma35_buy" ? "entry" : "watch",
    stateLabel: signal.id === "ma35_buy" ? "進場區" : "觀察區",
    stateReason: signal.reason || "策略2 1m 補掃條件成立",
    score: signal.id === "ma35_buy" ? 96 : signal.id === "breakout" ? 88 : 72,
    entryPrice: signal.entryPrice || stock.close,
    supportPrice: signal.ma35 || stock.ma35,
    entryLow: signal.entryLow || stock.low,
    entryHigh: signal.entryHigh || stock.high,
    stopLoss: signal.stopLoss || roundTradePrice(stock.close * 0.985),
    chaseLimit: signal.chaseLimit || roundTradePrice(stock.close * 1.01),
    observedPrice: stock.close,
    quoteTime: stock.quoteTime,
    quoteSource: stock.quoteSource,
    observedHigh: stock.high,
    observedHighAt: stock.timestamp,
    observedLow: stock.low,
    observedLowAt: stock.timestamp,
    dayHigh: stock.high,
    dayHighAt: stock.timestamp,
    dayLow: stock.low,
    dayLowAt: stock.timestamp,
    volume: stock.tradeVolume,
    value: stock.value,
    avg5dVolume: stock.avg5dVolume,
    percent: stock.percent,
    reason: signal.reason,
    signalId: signal.id,
    deltaVolume: signal.deltaVolume || stock.deltaVolume,
    ma35: signal.ma35 || stock.ma35,
    ma35Prev: signal.ma35Prev || stock.ma35Prev,
    aboveMa35: stock.ma35 > 0 && stock.close >= stock.ma35,
    ma35TrendUp: signal.ma35TrendUp || stock.ma35TrendUp,
    ma35Source: signal.ma35Source || stock.ma35Source,
    ma35Symbol: stock.ma35Symbol,
    ma35At: stock.ma35At,
    macdDif: stock.macdDif,
    macdSignal: stock.macdSignal,
    macdHist: stock.macdHist,
    macdUp: stock.macdUp,
    kdK: stock.kdK,
    kdD: stock.kdD,
    kdUp: stock.kdUp,
    rsiUp: stock.rsiUp,
    npsyUp: stock.npsyUp,
    intradayVolumeBurst: stock.deltaVolume >= 50 || stock.tradeVolume >= 10000,
    replayedFrom1mFullWindow: true,
  };
}

function futoptPreopenRecords(rows, quoteByCode, date) {
  return (rows || [])
    .filter((row) => row?.has_quote !== false)
    .filter((row) => cleanNumber(row.fut_change_percent) >= 1 || cleanNumber(row.rel_to_txf) >= 0.8)
    .filter((row) => cleanNumber(row.total_volume) >= 1)
    .map((row) => {
      const code = String(row.stock_symbol || "").replace(/\D/g, "").slice(0, 4);
      const quote = quoteByCode.get(code) || {};
      const futPct = cleanNumber(row.fut_change_percent);
      const rel = cleanNumber(row.rel_to_txf);
      const score = Math.min(98, Math.max(72, Math.round(72 + futPct * 5 + rel * 8)));
      const price = cleanNumber(quote.prevClose || quote.previousClose || quote.close || quote.price);
      return {
        date,
        timestamp: `${date} 08:45:00`,
        entryAt: `${date} 08:45:00`,
        code,
        name: row.stock_name || quote.name || code,
        strategy: "個股期貨盤前",
        stateId: "entry",
        stateLabel: "盤前期貨",
        stateReason: `08:45 個股期貨偵測：${row.future_symbol || ""} 漲幅 ${futPct.toFixed(2)}%，相對台指 ${rel.toFixed(2)}%，量 ${Math.round(cleanNumber(row.total_volume))}。`,
        score,
        entryPrice: price,
        supportPrice: price,
        entryLow: price,
        entryHigh: price,
        stopLoss: price ? roundTradePrice(price * 0.985) : 0,
        chaseLimit: price ? roundTradePrice(price * 1.015) : 0,
        observedPrice: price,
        quoteTime: "08:45:00",
        quoteSource: "supabase-futopt-preopen",
        observedHigh: price,
        observedHighAt: `${date} 08:45:00`,
        observedLow: price,
        observedLowAt: `${date} 08:45:00`,
        dayHigh: price,
        dayHighAt: `${date} 08:45:00`,
        dayLow: price,
        dayLowAt: `${date} 08:45:00`,
        volume: cleanNumber(row.total_volume),
        value: price * cleanNumber(row.total_volume),
        avg5dVolume: quote.avg5dVolume,
        percent: futPct,
        reason: `個股期貨 ${row.future_symbol || ""} 08:45-09:00 盤前轉強。`,
        signalId: "futopt_preopen",
        strategyIds: ["futopt_preopen"],
        strategyTags: ["個股期貨盤前"],
        primaryStrategy: "個股期貨盤前",
        strategyReasons: [`個股期貨盤前：期貨漲幅 ${futPct.toFixed(2)}%，相對台指 ${rel.toFixed(2)}%。`],
        futoptReady: row.futopt_ready,
        futureSymbol: row.future_symbol || "",
        futChangePercent: futPct,
        txfChangePercent: cleanNumber(row.txf_change_percent),
        relToTxf: rel,
        futureVolume: cleanNumber(row.total_volume),
        futureQuoteUpdatedAt: row.quote_updated_at || "",
        replayedFromFutoptPreopen: true,
      };
    })
    .filter((record) => /^\d{4}$/.test(record.code));
}

function mergeEvents(records) {
  const byCode = new Map();
  const entryRecords = records.filter((record) => record.stateId === "entry");
  for (const record of entryRecords) {
    const code = String(record.code || "");
    const time = taipeiTime(record.timestamp);
    const current = byCode.get(code);
    if (!current) {
      byCode.set(code, {
        code,
        date: record.date,
        name: record.name,
        stateId: "entry",
        stateLabel: "進場區",
        firstAAt: time,
        latestAAt: time,
        firstTradableAAt: time,
        firstAPrice: record.entryPrice,
        latestAPrice: record.entryPrice,
        latestSeenAt: time,
        latestSeenPrice: record.observedPrice,
        highestAt: time,
        highestPrice: record.observedHigh,
        highAfterA: record.observedHigh,
        highAfterAAt: time,
        maxScore: record.score,
        strategy: record.strategy,
        strategies: [record.strategy],
        strategyIds: [record.signalId],
        primaryStrategy: record.strategy,
        strategyTags: [record.strategy],
        reason: record.reason,
        latestRecord: record,
        ma35: record.ma35,
        ma35Prev: record.ma35Prev,
        ma35TrendUp: record.ma35TrendUp,
        ma35Source: record.ma35Source,
        ma35At: record.ma35At,
        supportPrice: record.supportPrice,
        replayedFrom1mFullWindow: true,
      });
      continue;
    }
    current.latestAAt = time;
    current.latestSeenAt = time;
    current.latestAPrice = record.entryPrice;
    current.latestSeenPrice = record.observedPrice;
    current.maxScore = Math.max(cleanNumber(current.maxScore), cleanNumber(record.score));
    if (cleanNumber(record.observedHigh) >= cleanNumber(current.highestPrice)) {
      current.highestPrice = record.observedHigh;
      current.highestAt = time;
      current.highAfterA = record.observedHigh;
      current.highAfterAAt = time;
    }
    current.latestRecord = record;
    if (!current.strategies.includes(record.strategy)) current.strategies.push(record.strategy);
    if (!current.strategyIds.includes(record.signalId)) current.strategyIds.push(record.signalId);
  }
  return [...byCode.values()].sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)) || cleanNumber(b.maxScore) - cleanNumber(a.maxScore));
}

async function main() {
  const date = normalizeDate(TRADE_DATE);
  const quoteResult = await fetchActiveCommonStockQuotes({
    allowWarmupSource: true,
    maxQuoteAgeSeconds: 24 * 60 * 60,
    minQuotes: 1,
    maxRows: 6000,
    timeout: 30000,
  });
  const quotes = (quoteResult.quotes || []).filter(isIntradayTradable).slice(0, MAX_CODES);
  const quoteByCode = new Map(quotes.map((quote) => [String(quote.code || ""), quote]));
  const avgResult = await fetchDailyVolumeAverages(quotes.map((quote) => quote.code), 5).catch(() => ({ byCode: new Map() }));
  const avgMap = avgResult instanceof Map ? avgResult : avgResult?.byCode instanceof Map ? avgResult.byCode : new Map();
  quotes.forEach((quote) => {
    const avgInfo = avgMap.get(String(quote.code));
    if (avgInfo) quote.avg5dVolume = cleanNumber(avgInfo.avgVolume);
  });

  const futoptResult = await fetchFutoptStockMappingReady({ limit: 5000, timeout: 30000 }).catch(() => ({ rows: [] }));
  const records = futoptPreopenRecords(futoptResult.rows || [], quoteByCode, date);
  const earlyTrackingCandidates = [];
  const motherPoolSnapshots = [];
  let fetchedCodes = 0;
  let candleCodes = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < quotes.length) {
      const base = quotes[cursor++];
      fetchedCodes += 1;
      let result;
      try {
        result = await fetchIntraday1m(base.code, BARS_PER_SYMBOL, {
          allowWarmupSource: true,
          maxQuoteAgeSeconds: 24 * 60 * 60,
          maxSourceAgeSeconds: 24 * 60 * 60,
          timeout: 30000,
        });
      } catch {
        continue;
      }
      const startSec = secondsOfDay(START_TIME);
      const endSec = secondsOfDay(END_TIME);
      const allCandles = (result.candles || result.rows || [])
        .map((row) => ({ ...row, timeText: taipeiTime(row.candleTime || row.time) }))
        .filter((row) => cleanNumber(row.close) > 0)
        .sort((a, b) => Date.parse(a.candleTime || a.time || "") - Date.parse(b.candleTime || b.time || ""));
      const candles = allCandles
        .filter((row) => taipeiDate(row.candleTime || row.time) === date)
        .filter((row) => secondsOfDay(row.timeText) >= startSec && secondsOfDay(row.timeText) <= endSec)
        .sort((a, b) => secondsOfDay(a.timeText) - secondsOfDay(b.timeText));
      if (!candles.length) continue;
      candleCodes += 1;
      let cumulativeVolume = 0;
      let previousSnapshot = null;
      for (const candle of candles) {
        const index = allCandles.findIndex((row) => (row.candleTime || row.time) === (candle.candleTime || candle.time));
        if (index < 0) continue;
        cumulativeVolume += cleanNumber(candle.volume);
        const stock = buildSnapshot(base, candle, index, allCandles, cumulativeVolume, previousSnapshot, date, candles);
        previousSnapshot = stock;
        if (secondsOfDay(stock.quoteTime) < secondsOfDay("08:45:00")) continue;
        motherPoolSnapshots.push(stock);
        if (isEarlyTrackingCandidate(stock)) earlyTrackingCandidates.push(stock);
        const signals = detectSignals(stock, previousSnapshot, null)
          .filter((signal) => signal.id === "ma35_buy" || signal.id === "breakout" || signal.id === "gap" || signal.id === "volume_burst");
        for (const signal of signals) {
          const duplicate = records.some((record) => record.code === stock.code && record.signalId === signal.id && record.timestamp === stock.timestamp);
          if (!duplicate) records.push(recordFromSignal(stock, signal));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, quotes.length) }, () => worker()));

  const motherByMinute = new Map();
  for (const stock of motherPoolSnapshots) {
    const key = stock.timestamp;
    if (!motherByMinute.has(key)) motherByMinute.set(key, []);
    motherByMinute.get(key).push(stock);
  }
  for (const [timestamp, rows] of motherByMinute) {
    const volumeTop100Codes = new Set(
      [...rows]
        .sort((a, b) => cleanNumber(b.tradeVolume || b.volume) - cleanNumber(a.tradeVolume || a.volume))
        .slice(0, 100)
        .map((stock) => String(stock.code || ""))
        .filter(Boolean)
    );
    for (const stock of rows) {
      if (!isStrategy2MotherPoolSnapshot(stock, volumeTop100Codes)) continue;
      const duplicate = records.some((record) => (
        record.code === stock.code
        && record.timestamp === timestamp
        && record.signalId === "strategy2_mother_pool"
      ));
      if (!duplicate) records.push(recordFromMotherPool(stock));
    }
  }

  const earlyByMinute = new Map();
  for (const stock of earlyTrackingCandidates) {
    const key = stock.timestamp;
    if (!earlyByMinute.has(key)) earlyByMinute.set(key, []);
    earlyByMinute.get(key).push(stock);
  }
  for (const [timestamp, rows] of earlyByMinute) {
    rows
      .sort((a, b) => earlyTrackingScore(b) - earlyTrackingScore(a) || cleanNumber(b.value) - cleanNumber(a.value))
      .slice(0, EARLY_TRACKING_PER_MINUTE)
      .forEach((stock) => {
        const duplicate = records.some((record) => record.code === stock.code && record.timestamp === timestamp);
        if (!duplicate) records.push(recordFromEarlyTracking(stock));
      });
  }

  records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || cleanNumber(b.score) - cleanNumber(a.score));
  const dedupeStrongSignals = new Set();
  const compactRecords = [];
  for (const record of records) {
    const signalId = String(record.signalId || "");
    if (signalId === "futopt_preopen" || signalId === "early_tracking" || signalId === "strategy2_mother_pool") {
      compactRecords.push(record);
      continue;
    }
    const key = `${record.code}|${signalId}`;
    if (dedupeStrongSignals.has(key)) continue;
    dedupeStrongSignals.add(key);
    compactRecords.push(record);
  }
  records.splice(0, records.length, ...compactRecords);

  const ranks = buildRanks(records.map((record) => ({
    value: record.value,
    tradeVolume: record.volume,
    percent: record.percent,
  })));
  void ranks;
  records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || cleanNumber(b.score) - cleanNumber(a.score));
  const events = mergeEvents(records);
  const times = [...new Set(records.map((record) => taipeiTime(record.timestamp)).filter(Boolean))].sort();
  const payload = {
    ok: true,
    complete: true,
    source: "strategy2-0845-1200-supabase-1m-full-replay",
    cacheSource: "supabase-1m-full-replay",
    date,
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    schemaVersion: "strategy2-run-id-complete-v1",
    dataContractSource: "supabase:intraday_1m_full_replay",
    records,
    events,
    entryCount: events.length,
    aCount: events.length,
    bOnlyCount: 0,
    qualityStatus: events.length ? "ok" : "empty",
    scanWindow: {
      start: START_TIME,
      end: END_TIME,
      timezone: "Asia/Taipei",
      replaySource: "supabase-intraday-1m",
      interval: "1m-full-window",
      uniqueRecordTimes: times.length,
      firstRecordAt: times[0] || "",
      lastRecordAt: times[times.length - 1] || "",
    },
    replay: {
      ok: true,
      scannedCodes: quotes.length,
      fetchedCodes,
      candleCodes,
      records: records.length,
      events: events.length,
    },
    realtime: {
      supabaseOnly: true,
      coverage: quotes.length ? Number((candleCodes / quotes.length).toFixed(4)) : 0,
      requested: quotes.length,
      usable: candleCodes,
      sourceHealth: { "supabase-intraday-1m": { usable: candleCodes, requested: quotes.length } },
      entrySourceHealthy: candleCodes > 0,
    },
  };
  writeJson(OUT_FILE, payload);
  console.log(`[strategy2-full-1m-replay] wrote ${OUT_FILE} date=${date} codes=${quotes.length} candleCodes=${candleCodes} records=${records.length} events=${events.length} first=${times[0] || "--"} last=${times[times.length - 1] || "--"}`);
}

main().catch((error) => {
  console.error(`[strategy2-full-1m-replay] failed: ${error.message}`);
  process.exit(1);
});





