"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("./server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DAILY_TABLE = process.env.STRATEGY3_DAILY_OHLCV_TABLE || "strategy4_daily_ohlcv_view";
const INTRADAY_TABLE = process.env.STRATEGY3_INTRADAY_1M_TABLE || "fugle_daytrade_intraday_1m";
const KD_PERIOD = 9;
const RSI_FAST_PERIOD = 3;
const RSI_SLOW_PERIOD = 6;
const MIN_INDICATOR_BARS = Math.max(KD_PERIOD + 1, RSI_SLOW_PERIOD + 2);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function dateDaysAgo(tradeDate, days) {
  const value = new Date(`${tradeDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function taipeiParts(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

function aggregateCompleted60m(rows, tradeDate, evaluatedAt = new Date()) {
  const evaluated = taipeiParts(evaluatedAt);
  const groups = new Map();
  for (const row of rows || []) {
    if (row?.synthetic === true || row?.volume_strategy_usable === false) continue;
    const parts = taipeiParts(row?.candle_time);
    if (!parts || parts.hour < 9 || parts.hour > 13 || (parts.hour === 13 && parts.minute > 30)) continue;
    const isCurrentBucket = parts.date === evaluated?.date && parts.hour === evaluated?.hour;
    if (isCurrentBucket && ((parts.hour < 13 && evaluated.minute < 59) || (parts.hour === 13 && evaluated.minute < 30))) continue;
    if (parts.date > tradeDate) continue;
    const key = `${parts.date}:${String(parts.hour).padStart(2, "0")}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
    list.sort((a, b) => Date.parse(a.candle_time) - Date.parse(b.candle_time));
    const highs = list.map((row) => number(row.high)).filter(Number.isFinite);
    const lows = list.map((row) => number(row.low)).filter(Number.isFinite);
    return {
      key,
      open: number(list[0]?.open),
      high: highs.length ? Math.max(...highs) : null,
      low: lows.length ? Math.min(...lows) : null,
      close: number(list[list.length - 1]?.close),
      source_rows: list.length,
    };
  }).filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

function indicatorTrend(bars) {
  if (!Array.isArray(bars) || bars.length < MIN_INDICATOR_BARS) return { ok: false, reason: `indicator_history_below_${MIN_INDICATOR_BARS}_bars` };
  let k = 50;
  let d = 50;
  const kd = [];
  for (let index = KD_PERIOD - 1; index < bars.length; index += 1) {
    const window = bars.slice(index - KD_PERIOD + 1, index + 1);
    const high = Math.max(...window.map((bar) => bar.high));
    const low = Math.min(...window.map((bar) => bar.low));
    const rsv = high > low ? ((bars[index].close - low) / (high - low)) * 100 : 50;
    k = (2 * k + rsv) / 3;
    d = (2 * d + k) / 3;
    kd.push({ index, k, d });
  }
  const rsiAt = (endIndex, period) => {
    if (endIndex < period) return null;
    let gains = 0;
    let losses = 0;
    for (let index = endIndex - period + 1; index <= endIndex; index += 1) {
      const change = bars[index].close - bars[index - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    if (losses === 0) return 100;
    return 100 - (100 / (1 + gains / losses));
  };
  const currentKd = kd[kd.length - 1];
  const previousKd = kd[kd.length - 2];
  const currentRsi3 = rsiAt(bars.length - 1, RSI_FAST_PERIOD);
  const previousRsi3 = rsiAt(bars.length - 2, RSI_FAST_PERIOD);
  const currentRsi6 = rsiAt(bars.length - 1, RSI_SLOW_PERIOD);
  const previousRsi6 = rsiAt(bars.length - 2, RSI_SLOW_PERIOD);
  if (!currentKd || !previousKd || ![currentRsi3, previousRsi3, currentRsi6, previousRsi6].every(Number.isFinite)) return { ok: false, reason: "indicator_values_missing" };
  const kdOverD = currentKd.k > currentKd.d;
  const kdTrendUp = currentKd.k > previousKd.k && currentKd.d > previousKd.d;
  const rsi3OverRsi6 = currentRsi3 > currentRsi6;
  const rsiTrendUp = currentRsi3 > previousRsi3 && currentRsi6 > previousRsi6;
  return {
    ok: true,
    current_k: round(currentKd.k), previous_k: round(previousKd.k),
    current_d: round(currentKd.d), previous_d: round(previousKd.d),
    current_rsi3: round(currentRsi3), previous_rsi3: round(previousRsi3),
    current_rsi6: round(currentRsi6), previous_rsi6: round(previousRsi6),
    kd_over_d: kdOverD,
    kd_trend_up: kdTrendUp,
    rsi3_over_rsi6: rsi3OverRsi6,
    rsi_trend_up: rsiTrendUp,
    signal_pass: kdOverD && kdTrendUp && rsi3OverRsi6 && rsiTrendUp,
    bar_count: bars.length,
    formula: "KD(9,3,3):K>D_and_K,D_up;RSI(3)>RSI(6)_and_both_up",
  };
}

function dailyBars(rows, tradeDate, poolRow) {
  const byDate = new Map();
  for (const row of rows || []) {
    const date = String(row?.trade_date || "").slice(0, 10);
    const bar = { key: date, open: number(row?.open), high: number(row?.high), low: number(row?.low), close: number(row?.close) };
    if (date && date <= tradeDate && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) byDate.set(date, bar);
  }
  const live = {
    key: tradeDate,
    open: number(poolRow?.open_price), high: number(poolRow?.high_price),
    low: number(poolRow?.low_price), close: number(poolRow?.price),
  };
  if ([live.open, live.high, live.low, live.close].every(Number.isFinite) && live.close > 0) byDate.set(tradeDate, live);
  return [...byDate.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function restRows(url, key, table, params, timeout = 30000) {
  const target = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params || {})) target.searchParams.set(name, String(value));
  const response = await fetch(target, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}_http_${response.status}:${text.slice(0, 180)}`);
  const parsed = JSON.parse(text || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function mapConcurrent(values, limit, callback) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await callback(values[index]);
    }
  }));
  return output;
}

async function readStrategy3TechnicalTrends({ symbols, tradeDate, poolBySymbol, evaluatedAt = new Date() }) {
  const url = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!url || !key) throw new Error("strategy3_technical_source_credentials_missing");
  // KD(9,3,3) and RSI(3)/RSI(6) need comparable current/previous values. Sixty calendar days covers
  // holidays and gives both daily and 60-minute series enough formal history.
  const fromDate = dateDaysAgo(tradeDate, 60);
  const pairs = await mapConcurrent(symbols, 4, async (symbol) => {
    try {
      const [dailyRowsSource, intradayRows] = await Promise.all([
        restRows(url, key, DAILY_TABLE, { select: "symbol,trade_date,open,high,low,close", symbol: `eq.${symbol}`, trade_date: `gte.${fromDate}`, order: "trade_date.asc", limit: 60 }),
        restRows(url, key, INTRADAY_TABLE, { select: "symbol,trade_date,candle_time,open,high,low,close,synthetic,volume_strategy_usable", symbol: `eq.${symbol}`, trade_date: `gte.${fromDate}`, order: "candle_time.asc", limit: 5000 }, 45000),
      ]);
      const hourlyBars = aggregateCompleted60m(intradayRows, tradeDate, evaluatedAt);
      const dailySeries = dailyBars(dailyRowsSource, tradeDate, poolBySymbol.get(symbol));
      const hourly = indicatorTrend(hourlyBars);
      const daily = indicatorTrend(dailySeries);
      const hourlyStrategy3Pass = hourly.ok && hourly.rsi3_over_rsi6 && hourly.rsi_trend_up;
      const dailyStrategy3Pass = daily.ok && daily.signal_pass;
      const ok = hourlyStrategy3Pass && dailyStrategy3Pass;
      return [symbol, {
        ok,
        source_ready: hourly.ok && daily.ok,
        reason: !hourly.ok ? `hourly60_${hourly.reason}` : !daily.ok ? `daily_${daily.reason}` : !hourlyStrategy3Pass ? "hourly60_rsi3_over_rsi6_trend_not_up" : !dailyStrategy3Pass ? "daily_kd_rsi_trend_not_all_up" : "",
        hourly60: hourly,
        daily,
        hourly_strategy3_pass: hourlyStrategy3Pass,
        daily_strategy3_pass: dailyStrategy3Pass,
        sources: { hourly60: `supabase:${INTRADAY_TABLE}:completed_60m_aggregate`, daily: `supabase:${DAILY_TABLE}+mother_pool_live_daily_bar` },
      }];
    } catch (error) {
      return [symbol, { ok: false, source_ready: false, reason: `technical_source_read_failed:${String(error?.message || error)}`, hourly60: null, daily: null }];
    }
  });
  return new Map(pairs);
}

module.exports = { readStrategy3TechnicalTrends, aggregateCompleted60m, indicatorTrend, dailyBars, KD_PERIOD, RSI_FAST_PERIOD, RSI_SLOW_PERIOD, MIN_INDICATOR_BARS, DAILY_TABLE, INTRADAY_TABLE };
