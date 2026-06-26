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
  const tailStart = Number(options.tailStartMinutes ?? 13 * 60);
  const tailEnd = Number(options.tailEndMinutes ?? 13 * 60 + 30);
  const rows = normalizeRows(candles);

  if (rows.length < minCandles) {
    return {
      ok: false,
      signal: "tv_overnight_entry",
      reason: `1分K不足 ${rows.length}/${minCandles}`,
      candleCount: rows.length,
      controlSource: "close_price_proxy",
      formulaVersion: "strategy3-tv-close-proxy-v2",
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
      reason: "缺少 13:00-13:30 尾盤1分K",
      candleCount: rows.length,
      degenerateCandleCount,
      fullOhlcRows,
      controlSource: "close_price_proxy",
      formulaVersion: "strategy3-tv-close-proxy-v2",
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
      ? `收盤價proxy隔日沖進場：13:00-13:30 尾盤、close_flow=((close-close[1])/close[1])*volume、控盤線為正且上彎、OBV為正、近100根收盤高=${isNearHigh}。`
      : `收盤價proxy隔日沖未通過：尾盤=true、近100根收盤高OK=${nearHighOk}、控盤OK=${controlOk}、OBV OK=${obvOk}、控盤線=${currentControl.toFixed(2)}、控盤上彎=${controlDirUp}、OBV=${currentObv.toFixed(2)}、近100根收盤高=${isNearHigh}、退化K=${degenerateCandleCount}/${rows.length}。`,
  };
}

module.exports = {
  analyzeTradingViewOvernightEntry,
  candleMinutes,
  cleanNumber,
  closePriceFlowAt,
  emaSeries,
  normalizeRows,
  smaAt,
};
