const EXCLUDED_CODES = new Set([
  "1101", "1102", "1216", "1301", "1303", "1326", "1402", "1590", "2002", "2105",
  "2207", "2303", "2308", "2317", "2327", "2330", "2357", "2382", "2395", "2408",
  "2412", "2454", "2603", "2609", "2615", "2801", "2880", "2881", "2882", "2883",
  "2884", "2885", "2886", "2887", "2888", "2890", "2891", "2892", "2912", "3008",
  "3034", "3045", "3711", "4904", "5871", "5876", "5880", "6505", "6669", "8069",
]);

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function avg(values) {
  const rows = values.map(cleanNumber).filter((value) => Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

function isIntradayTradable(stock) {
  const code = String(stock?.code || "");
  const close = cleanNumber(stock?.close);
  const value = cleanNumber(stock?.value);
  const volume = cleanNumber(stock?.tradeVolume);
  const name = String(stock?.name || "");
  if (!/^\d{4}$/.test(code) || /^00/.test(code)) return false;
  if (/ETF|ETN|指數|台灣50|高股息|正2|反1|期貨|債/i.test(name)) return false;
  if (/^(28|58)/.test(code)) return false;
  if (EXCLUDED_CODES.has(code)) return false;
  if (close >= 900) return false;
  return true;
}

function roundTradePrice(price) {
  const value = cleanNumber(price);
  if (!value) return 0;
  const tick = value >= 1000 ? 5 : value >= 500 ? 1 : value >= 100 ? 0.5 : value >= 50 ? 0.1 : value >= 10 ? 0.05 : 0.01;
  return Math.round(value / tick) * tick;
}

function formatTradePrice(price) {
  const value = roundTradePrice(price);
  return value ? value.toFixed(value >= 100 ? 1 : 2) : "--";
}

function rankValue(value, sorted) {
  if (!sorted.length) return 0;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return Math.round((low / sorted.length) * 100);
}

function buildRanks(stocks) {
  return {
    values: stocks.map((stock) => cleanNumber(stock.value)).sort((a, b) => a - b),
    volumes: stocks.map((stock) => cleanNumber(stock.tradeVolume)).sort((a, b) => a - b),
    percents: stocks.map((stock) => cleanNumber(stock.percent)).sort((a, b) => a - b),
  };
}

function detectSignals(stock, previous = null, ranks = null) {
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high) || close;
  const low = cleanNumber(stock.low) || close;
  const prevClose = cleanNumber(stock.prevClose) || (close - cleanNumber(stock.change));
  const pct = cleanNumber(stock.percent);
  const volume = cleanNumber(stock.tradeVolume);
  const value = cleanNumber(stock.value) || close * volume;
  const valueRank = ranks ? rankValue(value, ranks.values) : 0;
  const volumeRank = ranks ? rankValue(volume, ranks.volumes) : 0;
  const previousVolume = cleanNumber(previous?.tradeVolume);
  const deltaVolume = Math.max(volume - previousVolume, 0);
  const limitUp = cleanNumber(stock.limitUp) || (prevClose ? prevClose * 1.1 : 0);
  const vwap = volume ? value / volume : 0;
  const gapPct = open && prevClose ? ((open - prevClose) / prevClose) * 100 : 0;
  const ma35Proxy = avg([open, high, low, close]);
  const ibRange = high && low ? high - low : 0;
  const f618 = ibRange ? high - ibRange * 0.618 : 0;
  const signals = [];

  if (!isIntradayTradable(stock) || pct < 2 || volume < 2000) return signals;

  const volumeMilestone = volume >= 10000 ? 10000 : volume >= 5000 ? 5000 : 2000;
  if (deltaVolume >= 50) {
    signals.push({
      id: "volume_burst",
      label: deltaVolume >= 300 ? "急拉爆量" : deltaVolume >= 100 ? "分時爆量" : "分時放大",
      reason: `本輪新增 ${Math.round(deltaVolume)} 張，總量 ${Math.round(volume)} 張`,
    });
  }

  if (limitUp && close >= limitUp * 0.985 && (volumeRank >= 55 || valueRank >= 55 || volume >= 1200)) {
    signals.push({ id: "limit_lock", label: close >= limitUp * 0.998 ? "漲停鎖定" : "接近漲停", reason: "接近漲停或亮燈鎖住" });
  }

  if (open && prevClose && gapPct >= 2 && close >= open && (volume >= volumeMilestone || volumeRank >= 55)) {
    signals.push({ id: "gap", label: "真跳空", reason: `跳空 ${gapPct.toFixed(2)}% 且站在開盤價上方` });
  }

  if (pct >= 6 || (valueRank >= 55 && volumeRank >= 55 && close >= open && (!vwap || close >= vwap))) {
    signals.push({ id: "breakout", label: "轉強突破", reason: "站上強勢區與 VWAP" });
  }

  if (close > ma35Proxy && close > open && valueRank >= 55) {
    signals.push({ id: "ma35_buy", label: "MA35買點", reason: "整根站上 MA35 近似線" });
  }

  if (f618 && low <= f618 && high >= f618 && close >= open && close > ma35Proxy) {
    signals.push({ id: "diamond", label: "鑽石", reason: "回測 0.618 後收紅轉強" });
  }

  const entryLow = roundTradePrice(Math.max(vwap || 0, open || 0, close * 0.997));
  const entryHigh = roundTradePrice(Math.max(entryLow, close * 1.002));
  const entryPrice = entryHigh || roundTradePrice(close);
  const stopLoss = roundTradePrice(Math.min(entryLow || close, vwap || close, ma35Proxy || close) * 0.985);
  const chaseLimit = roundTradePrice(Math.min(high || close * 1.012, close * 1.01));

  return signals.map((signal) => ({
    ...signal,
    entryPrice,
    entryLow,
    entryHigh,
    stopLoss,
    chaseLimit,
    volumeMilestone,
    deltaVolume,
  }));
}

module.exports = {
  cleanNumber,
  detectSignals,
  formatTradePrice,
  isIntradayTradable,
  roundTradePrice,
  buildRanks,
};
