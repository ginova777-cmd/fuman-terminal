"use strict";

const MIN_CANDLES = 35;

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  return Number(num(value).toFixed(digits));
}

function average(values) {
  const usable = values.map(num).filter((value) => Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function emaSeries(values, period) {
  const alpha = 2 / (period + 1);
  const output = [];
  values.forEach((raw, index) => {
    const value = num(raw);
    output.push(index ? value * alpha + output[index - 1] * (1 - alpha) : value);
  });
  return output;
}

function rsiSeries(values, period = 14) {
  return values.map((raw, index) => {
    if (!index) return 50;
    let gain = 0;
    let loss = 0;
    for (let cursor = Math.max(1, index - period + 1); cursor <= index; cursor += 1) {
      const delta = num(values[cursor]) - num(values[cursor - 1]);
      if (delta >= 0) gain += delta;
      else loss -= delta;
    }
    if (!loss) return gain ? 100 : 50;
    return 100 - 100 / (1 + gain / loss);
  });
}

function kdSeries(candles) {
  let k = 50;
  let d = 50;
  return candles.map((candle, index) => {
    const window = candles.slice(Math.max(0, index - 8), index + 1);
    const high = Math.max(...window.map((row) => num(row.high || row.close)));
    const low = Math.min(...window.map((row) => num(row.low || row.close)));
    const close = num(candle.close);
    const rsv = high > low ? ((close - low) / (high - low)) * 100 : 50;
    k = (k * 2 + rsv) / 3;
    d = (d * 2 + k) / 3;
    return { k, d };
  });
}

function firstNumber(object, keys) {
  for (const key of keys) {
    const value = num(object?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

function resolveThreeGate(row, high, low) {
  const configured = row?.threeGateLevels || row?.three_gate_levels || row?.jiangThreeGateLevels || {};
  const upper = firstNumber(configured, ["upper", "a", "upperGate", "gateA"]) || firstNumber(row, ["threeGateUpper", "gateA"]);
  const middle = firstNumber(configured, ["middle", "b", "middleGate", "gateB"]) || firstNumber(row, ["threeGateMiddle", "gateB"]);
  const lower = firstNumber(configured, ["lower", "c", "lowerGate", "gateC"]) || firstNumber(row, ["threeGateLower", "gateC"]);
  if (upper && middle && lower) return { mode: "fixed", upper, middle, lower };
  if (!(high > low) || low <= 0) return { mode: "unavailable", upper: 0, middle: 0, lower: 0 };
  const range = high - low;
  return { mode: "dynamic", upper: low + range * 0.764, middle: low + range * 0.5, lower: low + range * 0.236 };
}

function pivotLows(candles) {
  const output = [];
  for (let index = 1; index < candles.length - 1; index += 1) {
    const low = num(candles[index].low || candles[index].close);
    if (low <= num(candles[index - 1].low || candles[index - 1].close)
      && low <= num(candles[index + 1].low || candles[index + 1].close)) output.push({ index, low });
  }
  return output;
}

function evaluateJiangCore(candles, row = {}) {
  const ordered = [...(candles || [])]
    .filter((candle) => num(candle?.close) > 0)
    .sort((left, right) => String(left.candle_time || "").localeCompare(String(right.candle_time || "")));
  if (ordered.length < MIN_CANDLES) {
    return { status: "DATA_GAP", reasonCode: "jiang_requires_35_formal_1m_candles", candleCount: ordered.length, hits: [], primarySignal: null, secondaryLabels: [], guards: [], threeGate: { mode: "unavailable", upper: 0, middle: 0, lower: 0 } };
  }

  const closes = ordered.map((candle) => num(candle.close));
  const highs = ordered.map((candle) => num(candle.high || candle.close));
  const lows = ordered.map((candle) => num(candle.low || candle.close));
  const volumes = ordered.map((candle) => num(candle.volume));
  const index = ordered.length - 1;
  const latest = ordered[index];
  const close = closes[index];
  const open = num(latest.open || close);
  const low = lows[index];
  const previousClose = closes[index - 1];
  const e3 = emaSeries(closes, 3);
  const e5 = emaSeries(closes, 5);
  const e10 = emaSeries(closes, 10);
  const e30 = emaSeries(closes, 30);
  const e58 = emaSeries(closes, 58);
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const dif = closes.map((_, cursor) => e12[cursor] - e26[cursor]);
  const kd = kdSeries(ordered);
  const rsi = rsiSeries(closes);
  const sessionHigh = Math.max(...highs);
  const sessionLow = Math.min(...lows);
  const gates = resolveThreeGate(row, sessionHigh, sessionLow);
  const baseline = average(volumes.slice(Math.max(0, index - 60), index));
  const burst = baseline > 0 && volumes[index] >= baseline * 2;
  const kdGolden = kd[index].k > kd[index].d && kd[index - 1].k <= kd[index - 1].d;
  const rsiGolden = rsi[index] > 50 && rsi[index - 1] <= 50;
  const macdZeroUp = dif[index] > 0 && dif[index - 1] <= 0;
  const resonance = [kdGolden, rsiGolden, macdZeroUp].filter(Boolean).length >= 2;
  const ppp = close > e3[index] && e3[index] > e5[index] && e5[index] > e10[index] && e10[index] > e30[index];
  const maPullback = ppp && [e10[index], e30[index], e58[index]].some((level) => level > 0 && low <= level * 1.003 && close >= level);
  const previousLow = lows[index - 1];
  const pullbackRecovery = close > open && close > previousClose && previousLow <= Math.max(e3[index - 1], e10[index - 1]) * 1.003 && close > e3[index];
  const tolerance = Math.max(close * 0.003, 0.01);
  const bTouches = gates.middle > 0 ? ordered.filter((candle) => num(candle.low || candle.close) <= gates.middle + tolerance && num(candle.close) >= gates.middle).length : 0;
  const bRetest = gates.middle > 0 && low <= gates.middle + tolerance && close >= gates.middle;
  const bLevel = Math.min(3, Math.max(0, bTouches - 1));
  const gateBreakout = gates.upper > 0 && close > gates.upper && previousClose <= gates.upper && burst;
  const fibHigh = Math.max(...highs.slice(Math.max(0, index - 30), index + 1));
  const fibLow = Math.min(...lows.slice(Math.max(0, index - 30), index + 1));
  const fib618 = fibHigh > fibLow ? fibHigh - (fibHigh - fibLow) * 0.618 : 0;
  const fibSupport = fib618 > 0 && low <= fib618 * 1.004 && close >= fib618;
  const fibNeckline = Math.max(...highs.slice(Math.max(0, index - 10), index));
  const fibBreakout = fibNeckline > 0 && close > fibNeckline && previousClose <= fibNeckline;
  const pivots = pivotLows(ordered.slice(-45));
  const wBottom = pivots.length >= 2 && (() => {
    const left = pivots.at(-2);
    const right = pivots.at(-1);
    const similar = Math.abs(left.low - right.low) / Math.max(left.low, right.low) <= 0.03;
    const offset = Math.max(0, ordered.length - 45);
    const neckline = Math.max(...highs.slice(offset + left.index, offset + right.index + 1));
    return similar && neckline > 0 && close > neckline;
  })();
  const shotgun = close >= open && burst && resonance && close > e3[index];
  const birdBeak = close > open && low < Math.min(e10[index], e30[index]) && close > Math.max(e10[index], e30[index]);
  const tweezerBottom = Math.abs(lows[index] - lows[index - 1]) / Math.max(lows[index], 0.01) <= 0.003 && close > open && previousClose <= num(ordered[index - 1].open || previousClose);
  const dojiBottom = Math.abs(close - open) / Math.max(close, 0.01) <= 0.002 && low <= Math.min(...lows.slice(Math.max(0, index - 10), index + 1)) * 1.01;
  const chaseGuard = close >= sessionHigh * 0.995 && close >= sessionLow * 1.1 && !burst;

  const hits = [];
  const add = (id, label, priority, reason, evidence = {}) => hits.push({ id, label, priority, reason, evidence });
  if (bRetest) add("jiang_three_gate_b" + bLevel, "三關價B" + bLevel + "回踩", 100, "回踩三關價B " + round(gates.middle) + " 後收復", { bTouches, gateB: round(gates.middle) });
  if (gateBreakout) add("jiang_three_gate_volume_breakout", "三關放量突破", 90, "突破三關價A " + round(gates.upper) + "，單量為前60根均量 " + round(volumes[index] / baseline) + " 倍", { gateA: round(gates.upper), volumeRatio: round(volumes[index] / baseline) });
  if (fibBreakout) add("jiang_fib_neckline_breakout", "Fib頸線突破", 80, "突破近10根頸線 " + round(fibNeckline), { fibNeckline: round(fibNeckline), fib618: round(fib618) });
  if (fibSupport) add("jiang_fib_support_reclaim", "Fib支撐回踩", 70, "回踩Fib 0.618 " + round(fib618) + " 後收復", { fib618: round(fib618) });
  if (resonance) add("jiang_oscillator_resonance", "KD/RSI/MACD共振", 65, "KD、RSI、MACD至少兩項同步轉強", { kdGolden, rsiGolden, macdZeroUp });
  if (shotgun) add("jiang_shotgun", "散彈槍", 60, "紅K、瞬間巨量與指標共振", { volumeRatio: round(volumes[index] / baseline) });
  if (wBottom) add("jiang_w_bottom_breakout", "W底突破", 60, "最近45根相近雙低點並突破頸線", {});
  if (maPullback) add("jiang_ma_pullback_support", "均線回踩有撐", 55, "PPP多頭排列，回踩MA10/30/58後收復", {});
  if (pullbackRecovery) add("jiang_pullback_reacceleration", "回踩後再上漲", 75, "前一根回踩短均線，最新紅K收復並高於前收", {});
  if (kdGolden) add("jiang_kd_golden_cross", "KD黃金交叉", 50, "K線上穿D線", {});
  if (rsiGolden) add("jiang_rsi_golden_cross", "RSI黃金交叉", 50, "RSI上穿50", {});
  if (macdZeroUp) add("jiang_macd_dif_zero_up", "MACD DIF零軸向上", 50, "DIF上穿零軸", {});
  if (ppp) add("jiang_ppp_bullish", "PPP多頭均線", 45, "EMA3/5/10/30多頭排列", {});
  if (birdBeak) add("jiang_bird_beak", "鳥嘴", 40, "下探均線後以紅K收回", {});
  if (tweezerBottom) add("jiang_tweezer_bottom", "鑷底", 40, "兩根K低點接近，最新紅K轉強", {});
  if (dojiBottom) add("jiang_bottom_doji", "底部十字", 35, "近期低點附近出現十字K", {});
  if (chaseGuard) add("jiang_n_large_chase_guard", "N大防追高", 110, "接近盤中高點但沒有瞬間量能確認，禁止追價", { blocked: true });

  const guards = hits.filter((hit) => hit.evidence.blocked === true);
  const actionable = hits.filter((hit) => hit.evidence.blocked !== true).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  return {
    status: "OK",
    reasonCode: guards.length ? "jiang_signal_with_n_large_chase_guard" : actionable.length ? "jiang_signal_matched" : "jiang_no_match",
    candleCount: ordered.length,
    hits: actionable,
    primarySignal: actionable[0] || null,
    secondaryLabels: actionable.slice(1).map((hit) => hit.label),
    guards,
    threeGate: { mode: gates.mode, upper: round(gates.upper), middle: round(gates.middle), lower: round(gates.lower) },
  };
}

module.exports = { MIN_CANDLES, evaluateJiangCore };
