function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function candleMinutes(row) {
  const text = String(row?.candleTime || row?.candle_time || row?.time || row?.date || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return get("hour") * 60 + get("minute");
  }
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function emaSeries(values, length) {
  const rows = (values || []).map(cleanNumber);
  const k = 2 / (length + 1);
  let ema = 0;
  return rows.map((value, index) => {
    ema = index === 0 ? value : value * k + ema * (1 - k);
    return ema;
  });
}

function smaAt(values, index, length) {
  if (index < length - 1) return 0;
  const slice = values.slice(index - length + 1, index + 1).map(cleanNumber);
  return slice.reduce((sum, value) => sum + value, 0) / length;
}

function lastSma(values, length) {
  const rows = (values || []).map(cleanNumber).filter((value) => value > 0);
  if (!rows.length) return 0;
  const slice = rows.slice(Math.max(0, rows.length - length));
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function rsiAt(values, length = 14) {
  const rows = (values || []).map(cleanNumber).filter((value) => value > 0);
  if (rows.length < 2) return 50;
  const start = Math.max(1, rows.length - length);
  let gains = 0;
  let losses = 0;
  let count = 0;
  for (let index = start; index < rows.length; index += 1) {
    const diff = rows[index] - rows[index - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
    count += 1;
  }
  if (!count) return 50;
  const avgGain = gains / count;
  const avgLoss = losses / count;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function closePriceFlowAt(row, index, rows) {
  const previousClose = index > 0 ? cleanNumber(rows[index - 1]?.close) : 0;
  if (previousClose <= 0) return 0;
  return ((cleanNumber(row.close) - previousClose) / previousClose) * cleanNumber(row.volume);
}

function normalizeRows(candles) {
  return (candles || [])
    .map((row) => ({
      ...row,
      open: cleanNumber(row.open),
      high: cleanNumber(row.high),
      low: cleanNumber(row.low),
      close: cleanNumber(row.close),
      volume: cleanNumber(row.volume),
      minutes: candleMinutes(row),
    }))
    .filter((row) => row.close > 0 && row.volume > 0);
}

function analyzeTradingViewOvernightEntry(candles, options = {}) {
  const minCandles = Math.max(1, Number(options.minCandles ?? process.env.STRATEGY3_TV_MIN_CANDLES ?? 35));
  const requireNear100High = options.requireNear100High ?? (process.env.STRATEGY3_REQUIRE_NEAR_100_HIGH === "1");
  const tailStart = Number(options.tailStartMinutes ?? process.env.STRATEGY3_TV_TAIL_START_MINUTES ?? (12 * 60 + 50));
  const tailEnd = Number(options.tailEndMinutes ?? process.env.STRATEGY3_TV_TAIL_END_MINUTES ?? (12 * 60 + 59));
  const rows = normalizeRows(candles);
  const closes = rows.map((row) => row.close);
  const ma20 = Number(lastSma(closes, 20).toFixed(2));
  const ma35 = Number(lastSma(closes, 35).toFixed(2));
  const rsi = Number(rsiAt(closes, 14).toFixed(2));

  if (rows.length < minCandles) {
    return {
      ok: false,
      signal: "tv_overnight_entry",
      reason: `1分K不足 ${rows.length}/${minCandles}`,
      candleCount: rows.length,
      controlSource: "close_price_proxy",
      formulaVersion: "strategy3-tv-close-proxy-v2",
      ma20,
      ma35,
      rsi,
      tvGateBreakdown: {
        candleCountOk: false,
        tailWindowOk: false,
        nearHighOk: false,
        controlOk: false,
        obvOk: false,
        requireNear100High: Boolean(requireNear100High),
      },
    };
  }

  const degenerateCandleCount = rows.filter((row) => row.high > 0 && row.low > 0 && row.high === row.low).length;
  const fullOhlcRows = rows.filter((row) => row.open > 0 && row.high > 0 && row.low > 0).length;
  const closeFlow = rows.map((row, index) => closePriceFlowAt(row, index, rows));
  const mfAvg = emaSeries(closeFlow, 8);
  const controlLine = mfAvg.map((_, index) => smaAt(mfAvg, index, 2));
  const rawObv = rows.map((row, index) => {
    if (index === 0) return 0;
    if (row.close > rows[index - 1].close) return row.volume;
    if (row.close < rows[index - 1].close) return -row.volume;
    return 0;
  });
  const obvLine = emaSeries(rawObv, 10);
  const lastSessionRows = rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.minutes != null && item.row.minutes >= tailStart && item.row.minutes <= tailEnd);

  if (!lastSessionRows.length) {
    return {
      ok: false,
      signal: "tv_overnight_entry",
      reason: "缺少 12:50-12:59 尾盤代理1分K",
      candleCount: rows.length,
      degenerateCandleCount,
      fullOhlcRows,
      controlSource: "close_price_proxy",
      formulaVersion: "strategy3-tv-close-proxy-v2",
      ma20,
      ma35,
      rsi,
      tvGateBreakdown: {
        candleCountOk: true,
        tailWindowOk: false,
        nearHighOk: false,
        controlOk: false,
        obvOk: false,
        requireNear100High: Boolean(requireNear100High),
      },
    };
  }

  const item = lastSessionRows.at(-1);
  const index = item.index;
  const highestClose100 = Math.max(...rows.slice(Math.max(0, index - 99), index + 1).map((row) => row.close));
  const isNearHigh = item.row.close >= highestClose100 * 0.98;
  const currentControl = cleanNumber(controlLine[index]);
  const previousControl = cleanNumber(controlLine[index - 1]);
  const currentObv = cleanNumber(obvLine[index]);
  const controlDirUp = currentControl > previousControl;
  const controlOk = currentControl > 0 && controlDirUp;
  const obvOk = currentObv > 0;
  const nearHighOk = !requireNear100High || isNearHigh;
  const ok = nearHighOk && controlOk && obvOk;

  return {
    ok,
    signal: "tv_overnight_entry",
    candleCount: rows.length,
    degenerateCandleCount,
    fullOhlcRows,
    lastCandleTime: item.row.candleTime || item.row.time || item.row.candle_time || "",
    nearHigh: isNearHigh,
    highest100: Number(highestClose100.toFixed(2)),
    highestClose100: Number(highestClose100.toFixed(2)),
    close: Number(item.row.close.toFixed(2)),
    ma20,
    ma35,
    rsi,
    controlLine: Number(currentControl.toFixed(2)),
    previousControlLine: Number(previousControl.toFixed(2)),
    controlDirUp,
    controlOk,
    obvOk,
    nearHighOk,
    controlSource: "close_price_proxy",
    formulaVersion: "strategy3-tv-close-proxy-v2",
    obvLine: Number(currentObv.toFixed(2)),
    tvGateBreakdown: {
      candleCountOk: true,
      tailWindowOk: true,
      nearHighOk,
      controlOk,
      obvOk,
      requireNear100High: Boolean(requireNear100High),
    },
    reason: ok
      ? `收盤價proxy隔日沖進場：12:50-12:59 尾盤代理、close_flow=((close-close[1])/close[1])*volume、控盤線為正且上彎、OBV為正、近100根收盤高=${isNearHigh}。`
      : `收盤價proxy隔日沖未通過：尾盤代理=true、近100根收盤高OK=${nearHighOk}、控盤OK=${controlOk}、OBV OK=${obvOk}、控盤線=${currentControl.toFixed(2)}、控盤上彎=${controlDirUp}、OBV=${currentObv.toFixed(2)}、近100根收盤高=${isNearHigh}、退化K=${degenerateCandleCount}/${rows.length}。`,
  };
}

module.exports = {
  analyzeTradingViewOvernightEntry,
  candleMinutes,
  cleanNumber,
  closePriceFlowAt,
  emaSeries,
  lastSma,
  normalizeRows,
  rsiAt,
  smaAt,
};
