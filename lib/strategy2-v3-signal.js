"use strict";

const MAX_QUOTE_AGE_SECONDS = 120;
const MAX_CANDLE_AGE_SECONDS = 180;
const MIN_CANDLES = 35;

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  return Number(number(value).toFixed(digits));
}

function average(values) {
  const usable = values.map(number).filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function ageSeconds(value, nowMs = Date.now()) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((nowMs - stamp) / 1000)) : Number.MAX_SAFE_INTEGER;
}

function movingAverage(candles, period) {
  return average(candles.slice(-period).map((candle) => candle.close));
}

function candidateFromWaterRow(row, candles, options = {}) {
  const now = options.now || new Date();
  const ordered = [...(candles || [])]
    .filter((candle) => number(candle?.close) > 0)
    .sort((left, right) => String(left.candle_time || "").localeCompare(String(right.candle_time || "")));
  const latest = ordered.at(-1) || {};
  const close = number(latest.close || row.price);
  const candleAge = ageSeconds(latest.candle_time, now.getTime());
  const quoteAge = ageSeconds(row.quoteSeenAt, now.getTime());
  const ma5 = movingAverage(ordered, 5);
  const ma20 = movingAverage(ordered, 20);
  const ma35 = movingAverage(ordered, 35);
  const currentVolume = number(latest.volume);
  const averageVolume20 = average(ordered.slice(-21, -1).map((candle) => candle.volume));
  const volumeRatio = averageVolume20 > 0 ? currentVolume / averageVolume20 : 0;
  const prior15 = ordered.slice(-16, -1);
  const priorHigh15 = prior15.length ? Math.max(...prior15.map((candle) => number(candle.high || candle.close))) : 0;
  const sessionHigh = ordered.length ? Math.max(...ordered.map((candle) => number(candle.high || candle.close))) : 0;
  const sessionLow = ordered.length ? Math.min(...ordered.map((candle) => number(candle.low || candle.close))) : 0;
  const latestLow = number(latest.low || close);
  const open = number(ordered[0]?.open || row.poolEvidence?.motherPoolMetrics?.openPrice || close);
  const changePct = open > 0 ? ((close - open) / open) * 100 : 0;

  const hardGate = {
    formalQuote: row.formalQuoteReady === true,
    formalOneMinute: row.formalOneMinuteReady === true,
    priceFloor: number(row.price) >= 50,
    minCandles: ordered.length >= MIN_CANDLES,
    quoteFresh: quoteAge <= MAX_QUOTE_AGE_SECONDS,
    candleFresh: candleAge <= MAX_CANDLE_AGE_SECONDS,
    complete: false,
  };
  hardGate.complete = hardGate.formalQuote && hardGate.formalOneMinute && hardGate.priceFloor && hardGate.minCandles && hardGate.quoteFresh && hardGate.candleFresh;

  const trendAligned = close > ma20 && ma5 >= ma20 && ma20 >= ma35;
  const volumeConfirmed = volumeRatio >= 1.15;
  const fifteenMinuteBreakout = priorHigh15 > 0 && close >= priorHigh15;
  const nearSessionHigh = sessionHigh > 0 && close >= sessionHigh * 0.998;
  const pricePositive = changePct > 0;
  const score = (trendAligned ? 35 : 0)
    + (volumeConfirmed ? 20 : 0)
    + (fifteenMinuteBreakout ? 25 : 0)
    + (nearSessionHigh ? 10 : 0)
    + (pricePositive ? 10 : 0);
  const qualifies = hardGate.complete
    && trendAligned
    && (fifteenMinuteBreakout || (nearSessionHigh && volumeConfirmed))
    && score >= 60;
  const support = Math.max(0, Math.min(ma20 || close, latestLow || close));
  const risk = Math.max(close - support, Math.max(close * 0.01, 0.01));

  return {
    code: row.code || row.symbol,
    symbol: row.symbol || row.code,
    name: row.name || row.symbol || row.code,
    market: row.market || "",
    entryAt: latest.candle_time || "",
    timestamp: latest.candle_time || "",
    entryPrice: round(close),
    price: round(close),
    pct: `${round(changePct)}%`,
    changePercent: round(changePct),
    score,
    strategy: "V3量價突破",
    signalId: "s2_v3_1m_trend_volume_breakout",
    signalLine: `MA5 ${round(ma5)} / MA20 ${round(ma20)} / MA35 ${round(ma35)}；15分突破 ${fifteenMinuteBreakout ? "是" : "否"}；量能 ${round(volumeRatio)} 倍`,
    reason: "正式 Fugle 1分K 量價趨勢突破",
    state: qualifies ? "LIVE候選" : "資料完整，未達訊號",
    stateId: qualifies ? "candidate" : "watch",
    formalCandidate: qualifies,
    supportPrice: round(support),
    stopLoss: round(Math.max(0, support - risk * 0.25)),
    targetPrice: round(close + risk * 2),
    quoteSeenAt: row.quoteSeenAt || "",
    quoteAgeSeconds: quoteAge,
    entryCandleTime: latest.candle_time || "",
    entryTradeDate: options.tradeDate || "",
    entryPriceSource: "fugle_daytrade_source_formal_1m",
    candleCount: ordered.length,
    candleAgeSeconds: candleAge,
    ma5: round(ma5),
    ma20: round(ma20),
    ma35: round(ma35),
    volumeRatio1m: round(volumeRatio),
    priorHigh15: round(priorHigh15),
    sessionHigh: round(sessionHigh),
    sessionLow: round(sessionLow),
    hardGate,
    evidence: {
      formalQuoteSource: row.quoteSource || "",
      sourceRunId: row.sourceRunId || "",
      firstCandleTime: row.firstCandleTime || "",
      lastCandleTime: row.lastCandleTime || "",
      trendAligned,
      volumeConfirmed,
      fifteenMinuteBreakout,
      nearSessionHigh,
    },
  };
}

module.exports = {
  MAX_QUOTE_AGE_SECONDS,
  MAX_CANDLE_AGE_SECONDS,
  MIN_CANDLES,
  candidateFromWaterRow,
};
