"use strict";

// Strategy2 is a read-only scanner. Its documented intraday methods determine
// eligibility; this module evaluates current/today water and never fills it.
const MIN_CANDLES = 35;
const MAX_FORMAL_AGE_SECONDS = 120;
const MAX_HARD_BLOCK_AGE_SECONDS = 180;
const FORMAL_CUTOFF_MINUTE = 12 * 60;

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function round(value, digits = 2) { return Number(num(value).toFixed(digits)); }
function average(values) { return values.length ? values.reduce((sum, value) => sum + num(value), 0) / values.length : 0; }
function ema(values, period) {
  const alpha = 2 / (period + 1);
  return values.reduce((out, raw, index) => {
    const value = num(raw);
    out.push(index ? value * alpha + out[index - 1] * (1 - alpha) : value);
    return out;
  }, []);
}
function slope(series) { return series.length > 1 && series.at(-1) > series.at(-2); }
function ageSeconds(value, now) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((now.getTime() - stamp) / 1000)) : Number.MAX_SAFE_INTEGER;
}
function taipeiMinute(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get("hour") * 60 + get("minute");
}
function rsi(values, period = 14) {
  const window = values.slice(-(period + 1));
  let gain = 0; let loss = 0;
  for (let i = 1; i < window.length; i += 1) {
    const delta = window[i] - window[i - 1];
    if (delta >= 0) gain += delta; else loss -= delta;
  }
  return loss ? 100 - 100 / (1 + gain / loss) : gain ? 100 : 50;
}
function stochastic(candles, period = 9) {
  const window = candles.slice(-period);
  if (!window.length) return 50;
  const high = Math.max(...window.map((row) => num(row.high || row.close)));
  const low = Math.min(...window.map((row) => num(row.low || row.close)));
  const close = num(window.at(-1)?.close);
  return high > low ? ((close - low) / (high - low)) * 100 : 50;
}
function nearest(value, levels, tolerance = 0.004) {
  return levels.filter((level) => level > 0).some((level) => Math.abs(value - level) / level <= tolerance);
}
function fixedGates(row) {
  const source = row.threeGateLevels || row.three_gate_levels || {};
  return { upper: num(source.upper || source.upperGate), middle: num(source.middle || source.middleGate), lower: num(source.lower || source.lowerGate), mode: "fixed" };
}
function dynamicGates(high, low) {
  const range = high - low;
  return range > 0 ? { upper: low + range * 1.382, middle: (high + low) / 2, lower: high - range * 1.382, mode: "dynamic" } : { upper: 0, middle: 0, lower: 0, mode: "unavailable" };
}
function signal(id, label, priority, formalCapable, reason) { return { id, label, priority, formalCapable, reason }; }

function candidateFromWaterRow(row, candles, options = {}) {
  const now = options.now || new Date();
  const tradeDate = String(options.tradeDate || "");
  const ordered = [...(candles || [])]
    .filter((candle) => String(candle.candle_time || "").startsWith(tradeDate) && num(candle.close) > 0)
    .sort((a, b) => String(a.candle_time).localeCompare(String(b.candle_time)));
  const latest = ordered.at(-1) || {};
  const previous = ordered.at(-2) || {};
  const closes = ordered.map((candle) => num(candle.close));
  const volumes = ordered.map((candle) => num(candle.volume));
  const highs = ordered.map((candle) => num(candle.high || candle.close));
  const lows = ordered.map((candle) => num(candle.low || candle.close));
  const open = num(latest.open || latest.close);
  const close = num(latest.close || row.price);
  const low = num(latest.low || close);
  const previousClose = num(previous.close);
  const redCandle = close > open;
  const series = { ma3: ema(closes, 3), ma5: ema(closes, 5), ma10: ema(closes, 10), ma30: ema(closes, 30), ma35: ema(closes, 35), ma58: ema(closes, 58) };
  const ma = Object.fromEntries(Object.entries(series).map(([key, values]) => [key, num(values.at(-1))]));
  const ema12 = ema(closes, 12); const ema26 = ema(closes, 26);
  const dif = ema12.map((value, index) => value - ema26[index]);
  const macdUp = slope(dif); const macdRed = num(dif.at(-1)) > 0;
  const kdNow = stochastic(ordered); const kdPrev = stochastic(ordered.slice(0, -1)); const kdUp = kdNow > kdPrev;
  const rsiNow = rsi(closes); const rsiPrev = rsi(closes.slice(0, -1)); const rsiUp = rsiNow > rsiPrev;
  const sessionHigh = highs.length ? Math.max(...highs) : 0;
  const sessionLow = lows.length ? Math.min(...lows) : 0;
  const dynamic = dynamicGates(sessionHigh, sessionLow); const fixed = fixedGates(row);
  const dynamicDistance = dynamic.middle > 0 ? (close - dynamic.middle) / dynamic.middle : Number.POSITIVE_INFINITY;
  const avg60 = average(volumes.slice(-61, -1));
  const burst = avg60 > 0 && num(latest.volume) >= avg60 * 2;
  const rolling60High = Math.max(0, ...closes.slice(-61, -1));
  const instantLift = rolling60High > 0 && close >= rolling60High * 1.01;
  const estimatedVolumeRatio = num(row.estimatedVolumeRatio || row.volumeRatio5 || row.poolEvidence?.motherPoolMetrics?.volumeRatio5);
  const quoteAge = ageSeconds(row.quoteSeenAt, now); const candleAge = ageSeconds(latest.candle_time, now);
  const minute = taipeiMinute(now);
  const gateA = String(row.gateGrade || "").toUpperCase() === "A" && row.formalEntryAllowed === true;
  const hardGate = {
    today: Boolean(tradeDate) && ordered.length > 0,
    canonicalRun: row.canonicalRunMatches === true,
    motherPool: row.basePoolEligible === true && row.deepScanEligible === true,
    commonStockDaytradeEligible: row.commonStockDaytradeEligible === true,
    priceFloor: num(row.price) >= 50,
    estimatedVolumeRatio: estimatedVolumeRatio >= 1,
    formalQuote: row.formalQuoteReady === true,
    formalOneMinute: row.formalOneMinuteReady === true,
    minCandles: ordered.length >= MIN_CANDLES,
    quoteNotHardStale: quoteAge <= MAX_HARD_BLOCK_AGE_SECONDS,
    candleNotHardStale: candleAge <= MAX_HARD_BLOCK_AGE_SECONDS,
  };
  hardGate.complete = Object.values(hardGate).every(Boolean);
  const formalFresh = quoteAge <= MAX_FORMAL_AGE_SECONDS && candleAge <= MAX_FORMAL_AGE_SECONDS;
  const supportLevels = [ma.ma5, ma.ma10, ma.ma30, ma.ma58, dynamic.middle, fixed.middle];
  const validSupport = supportLevels.filter((value) => value > 0);
  const supportHeld = nearest(low, supportLevels) && close >= Math.min(...validSupport);
  const momentum = kdUp || macdUp || rsiUp;
  const ppp = ma.ma3 >= ma.ma5 && ma.ma5 >= ma.ma10 && ma.ma10 >= ma.ma30 && ma.ma30 >= ma.ma58
    && [series.ma3, series.ma5, series.ma10, series.ma30, series.ma58].every(slope);
  const prior15High = Math.max(0, ...highs.slice(-16, -1));
  const openingBreakout = minute >= 540 && minute <= 550 && row.openingWindowReady === true && redCandle && slope(series.ma3) && close > num(row.openingReferencePrice) && close >= prior15High;
  const pullbackSecondEntry = redCandle && supportHeld && close >= ma.ma3 && momentum;
  const pppPullback = ppp && redCandle && nearest(low, [ma.ma10, ma.ma30]) && close >= ma.ma3;
  const shotgun = redCandle && burst && [kdUp, macdUp, rsiUp].filter(Boolean).length >= 2 && close >= ma.ma3;
  const birdBeak = slope(series.ma5) && ma.ma5 >= ma.ma30 && low <= Math.max(ma.ma30, ma.ma58) * 1.003 && close >= Math.max(ma.ma3, ma.ma5) && momentum;
  const recent = ordered.slice(-45); const mid = Math.floor(recent.length / 2);
  const leftLow = recent.length ? Math.min(...recent.slice(0, mid).map((candle) => num(candle.low || candle.close))) : 0;
  const rightLow = recent.length ? Math.min(...recent.slice(mid).map((candle) => num(candle.low || candle.close))) : 0;
  const neckline = recent.length ? Math.max(...recent.slice(Math.max(0, mid - 5)).map((candle) => num(candle.high || candle.close))) : 0;
  const wBottom = leftLow > 0 && Math.abs(leftLow - rightLow) / leftLow <= 0.03 && close > neckline && redCandle && momentum && dynamicDistance <= 0.02;
  const fibHigh = Math.max(0, ...highs.slice(-60)); const positiveLows = lows.slice(-60).filter((value) => value > 0);
  const fibLow = positiveLows.length ? Math.min(...positiveLows) : 0;
  const fibLevels = fibHigh > fibLow ? [0.236, 0.382, 0.5, 0.618, 0.764].map((ratio) => fibHigh - (fibHigh - fibLow) * ratio) : [];
  const fibSignal = redCandle && nearest(low, fibLevels) && close >= ma.ma3 && momentum;
  const threeGate = redCandle && (nearest(low, [dynamic.middle, fixed.middle]) || close > dynamic.upper || (fixed.upper > 0 && close > fixed.upper)) && momentum;
  const volumePrice = minute >= 540 && minute <= 720 && redCandle && slope(series.ma5) && slope(series.ma10) && slope(series.ma30) && close >= ma.ma5 && (burst || instantLift) && dynamicDistance <= 0.02;
  const last30Highs = highs.slice(-30); const recentHighIndex = last30Highs.indexOf(Math.max(0, ...last30Highs));
  const recentAfterHigh = lows.slice(-30).slice(recentHighIndex + 1);
  const pulledBack = recentAfterHigh.length > 0 && Math.min(...recentAfterHigh) <= Math.max(ma.ma5, ma.ma10, dynamic.middle) * 1.01;
  const nPattern = slope(series.ma5) && ma.ma5 >= ma.ma10 && pulledBack && redCandle && close >= ma.ma5 && momentum && (burst || estimatedVolumeRatio >= 1);
  const hits = [];
  if (openingBreakout) hits.push(signal("opening_breakout", "開盤突破／買點1", 100, true, "09:00-09:10突破開盤參考價，紅K且MA3向上"));
  if (pullbackSecondEntry) hits.push(signal("pullback_second_entry", "買點2／回踩續攻", 90, true, "回踩MA／Fib／三關支撐後紅K收復"));
  if (pppPullback) hits.push(signal("ppp_pullback", "PPP強勢回踩續漲", 88, true, "MA3/5/10/30/58多頭且回踩不破"));
  if (shotgun) hits.push(signal("shotgun_reversal", "散彈槍反轉", 84, true, "紅K、瞬間巨量與動能至少兩項轉強"));
  if (birdBeak) hits.push(signal("bird_beak", "鳥嘴", 80, true, "MA5上穿MA30附近並站回短均線"));
  if (nPattern && dynamicDistance <= 0.02) hits.push(signal("n_pattern", "N大", 78, true, "回落靠近支撐後重新帶量轉強"));
  if (wBottom) hits.push(signal("w_bottom", "W底", 76, true, "雙底突破頸線且未遠離動態中關"));
  if (fibSignal) hits.push(signal("fib_support_or_breakout", "Fib回踩轉強", 72, true, "Fib回撤位有守並配合紅K與動能"));
  if (threeGate) hits.push(signal("three_gate_retest_or_breakout", "三關價回踩／突破", 70, true, "固定或動態三關價獲得支撐確認"));
  if (volumePrice) hits.push(signal("volume_price_strengthening", "量價轉強觀察", 65, false, "09:00-12:00均線向上且瞬間巨量或拉抬"));
  if (row.stockFutureSync === true) hits.push(signal("stock_future_txf_sync", "期貨股票齊漲", 40, false, "個股期貨、相對TXF與現股同步轉強"));
  if (row.starPreopen === true && minute >= 525 && minute < 540) hits.push(signal("star_preopen", "STAR盤前觀察", 45, false, "個股期貨與試撮同日條件成立"));
  hits.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const chaseWarning = dynamicDistance > 0.02;
  const chaseBlocked = dynamicDistance > 0.05 || num(row.changePercent) >= 8;
  const weakening = !redCandle || !slope(series.ma3) || (!kdUp && !macdUp) || (!slope(series.ma5) && !slope(series.ma10) && !slope(series.ma30));
  const keySupportHeld = close >= Math.max(dynamic.lower || 0, fixed.lower || 0);
  const formalCandidate = hardGate.complete && formalFresh && gateA && minute >= 540 && minute < FORMAL_CUTOFF_MINUTE
    && !chaseWarning && !chaseBlocked && !weakening && keySupportHeld && hits.some((hit) => hit.formalCapable);
  const observation = hits.length > 0 && hardGate.complete && !chaseBlocked;
  const primary = hits[0] || null;
  const stateId = formalCandidate ? "formal" : observation ? "observation" : hardGate.complete ? "no_match" : "data_gap";
  const dataGapReasons = Object.entries(hardGate).filter(([key, value]) => key !== "complete" && !value).map(([key]) => key);
  const support = Math.max(ma.ma10, ma.ma30, dynamic.middle);
  return {
    code: row.code || row.symbol, symbol: row.symbol || row.code, name: row.name || row.symbol || row.code, market: row.market || "",
    entryAt: latest.candle_time || "", timestamp: latest.candle_time || "", entryCandleTime: latest.candle_time || "",
    entryPrice: round(close), price: round(close), pct: `${round(row.changePercent)}%`, changePercent: round(row.changePercent),
    score: primary?.priority || 0, strategy: primary?.label || "策略2未命中", signalId: primary?.id || "strategy2_no_match",
    signalLine: primary?.reason || "資料完整但策略2未命中", reason: dataGapReasons.length ? `DATA_GAP:${dataGapReasons.join(",")}` : chaseBlocked ? "剔除：追高限制" : primary?.reason || "策略2未命中",
    state: formalCandidate ? "正式進場" : observation ? "策略命中觀察" : hardGate.complete ? "剔除／未命中" : "DATA_GAP",
    stateId, stateLabel: formalCandidate ? "正式進場" : observation ? "策略命中觀察" : stateId === "data_gap" ? "DATA_GAP" : "剔除",
    formalCandidate, FormalEntry: formalCandidate, observation, supportPrice: round(support), stopLoss: round(Math.max(0, support * 0.995)), targetPrice: round(dynamic.upper || fixed.upper),
    quoteSeenAt: row.quoteSeenAt || "", quoteAgeSeconds: quoteAge, entryTradeDate: tradeDate, entryPriceSource: "fugle_daytrade_source_formal_1m",
    candleCount: ordered.length, candleAgeSeconds: candleAge, estimatedVolumeRatio: round(estimatedVolumeRatio), volumeRatio1m: round(avg60 > 0 ? num(latest.volume) / avg60 : 0),
    ma: Object.fromEntries(Object.entries(ma).map(([key, value]) => [key, round(value)])), indicators: { kd: round(kdNow), kdUp, rsi: round(rsiNow), rsiUp, macdDif: round(dif.at(-1)), macdUp, macdRed },
    threeGate: { fixed, dynamic }, strategyHits: hits, primarySignal: primary, secondaryLabels: hits.slice(1).map((hit) => hit.label), hardGate,
    gateEvidence: { gateGrade: row.gateGrade || "", formalEntryAllowed: row.formalEntryAllowed === true, formalFresh, beforeFormalCutoff: minute < FORMAL_CUTOFF_MINUTE, chaseWarning, chaseBlocked, weakening, keySupportHeld },
    evidence: { sourceRunId: row.sourceRunId || "", canonicalRunMatches: row.canonicalRunMatches === true, future: row.futureEvidence || null, preopen: row.preopenEvidence || null, dataGapReasons },
  };
}

module.exports = { MIN_CANDLES, MAX_FORMAL_AGE_SECONDS, MAX_HARD_BLOCK_AGE_SECONDS, FORMAL_CUTOFF_MINUTE, candidateFromWaterRow };
