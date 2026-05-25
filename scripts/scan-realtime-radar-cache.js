const fs = require("fs");
const path = require("path");
const { cleanNumber, isIntradayTradable } = require("./intraday-radar-rules");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "realtime-radar-latest.json");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const STALE_AFTER_MS = Number(process.env.REALTIME_RADAR_STALE_MS || 20000);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampKey(parts = taipeiParts()) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "FumanRealtimeRadarCache/1.0" } });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStocks() {
  try {
    const market = await fetchJson(`${BASE_URL}/api/market?t=${Date.now()}`, 30000);
    if (Array.isArray(market?.stocks) && market.stocks.length) {
      return market.stocks.map((stock) => ({
        code: String(stock.code || ""),
        name: String(stock.name || ""),
        close: cleanNumber(stock.close),
        change: cleanNumber(stock.change),
        percent: cleanNumber(stock.pct ?? stock.percent),
        value: cleanNumber(stock.value),
        tradeVolume: cleanNumber(stock.volume ?? stock.tradeVolume),
      })).filter((stock) => stock.code && stock.name);
    }
  } catch {}

  const payload = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 30000);
  return payload.map((stock) => {
    const close = cleanNumber(stock.ClosingPrice || stock["收盤價"]);
    const change = cleanNumber(stock.Change || stock["漲跌價差"]);
    const prevClose = close - change;
    return {
      code: String(stock.Code || stock["證券代號"] || ""),
      name: String(stock.Name || stock["證券名稱"] || ""),
      close,
      change,
      percent: prevClose ? (change / prevClose) * 100 : 0,
      value: cleanNumber(stock.TradeValue || stock["成交金額"]),
      tradeVolume: cleanNumber(stock.TradeVolume || stock["成交股數"]),
    };
  }).filter((stock) => stock.code && stock.name && stock.close);
}

async function fetchRealtime(stocks) {
  const quotes = new Map();
  const batchSize = 100;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const codes = stocks.slice(i, i + batchSize).map((stock) => stock.code);
    if (!codes.length) continue;
    try {
      const payload = await fetchJson(`${BASE_URL}/api/realtime?codes=${encodeURIComponent(codes.join(","))}&t=${Date.now()}`, 20000);
      (payload.quotes || []).forEach((quote) => quotes.set(quote.code, quote));
    } catch (error) {
      console.log(`realtime batch failed ${codes[0]}-${codes.at(-1)}: ${error.message}`);
    }
  }
  return stocks.map((stock) => {
    const quote = quotes.get(stock.code);
    if (!quote?.close) return stock;
    const volume = cleanNumber(quote.tradeVolume) || cleanNumber(stock.tradeVolume);
    const close = cleanNumber(quote.close) || cleanNumber(stock.close);
    return {
      ...stock,
      ...quote,
      close,
      tradeVolume: volume,
      value: volume && close ? volume * close * 1000 : cleanNumber(stock.value),
      isRealtime: true,
    };
  });
}

function radarSignalTags(stock) {
  const tags = [];
  const pct = cleanNumber(stock.percent);
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const close = cleanNumber(stock.close);
  const open = cleanNumber(stock.open);
  const high = cleanNumber(stock.high);
  const low = cleanNumber(stock.low);
  const bodyPct = open ? ((close - open) / open) * 100 : 0;

  if (close && open && close > open && bodyPct >= 3) tags.push("長紅逾3%");
  if (close && open && close < open && bodyPct <= -1.5) tags.push("長黑轉弱");
  if (value >= 1000000000 || (volume >= 5000 && Math.abs(pct) >= 1.2)) tags.push("即時爆量");
  if (pct >= 3) tags.push("短線急拉");
  if (pct >= 1.5 && value >= 200000000) tags.push("短線強勢");
  if (pct <= -3) tags.push("急殺");
  if (pct <= -1.5 && value >= 200000000) tags.push("短線轉弱");
  if (high && close && close >= high * 0.985 && pct > 0) tags.push("逼近日高");
  if (low && close && close <= low * 1.015 && pct < 0) tags.push("貼近日低");
  return [...new Set(tags)];
}

function radarFlowValue(stock) {
  const value = cleanNumber(stock.value);
  const pct = Math.abs(cleanNumber(stock.percent));
  const tags = stock.signalTags?.length || 0;
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const volumeBoost = volume >= 10000 ? 0.18 : volume >= 5000 ? 0.12 : 0.06;
  const signalBoost = Math.min(tags * 0.11, 0.46);
  const moveBoost = Math.min(pct / 9, 0.42);
  return value * (0.55 + signalBoost + moveBoost + volumeBoost);
}

function radarSignalScore(stock) {
  const pct = Math.abs(cleanNumber(stock.percent));
  const value = cleanNumber(stock.value);
  const volume = cleanNumber(stock.tradeVolume || stock.volume);
  const tagScore = (stock.signalTags?.length || 0) * 16;
  const moveScore = Math.min(pct * 7, 32);
  const valueScore = Math.min(Math.log10(Math.max(value, 1)) * 5, 46);
  const volumeScore = Math.min(Math.log10(Math.max(volume, 1)) * 5, 22);
  return Math.max(1, Math.min(100, Math.round(tagScore + moveScore + valueScore + volumeScore - 42)));
}

function buildRadarRows(stocks, detectedAt) {
  return stocks
    .filter(isIntradayTradable)
    .map((stock) => {
      const pct = cleanNumber(stock.percent);
      const close = cleanNumber(stock.close);
      const volume = cleanNumber(stock.tradeVolume || stock.volume);
      const value = cleanNumber(stock.value) || close * volume * 1000;
      const signalTags = radarSignalTags({ ...stock, percent: pct, value });
      const hasLongSignal =
        signalTags.some((tag) => /逼近|爆量|強勢|急拉|長紅/.test(tag)) ||
        pct >= 3 ||
        (pct >= 1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct > 0) ||
        (volume >= 5000 && pct >= 1.2);
      const hasShortSignal =
        signalTags.some((tag) => /急殺|轉弱|長黑|貼近/.test(tag)) ||
        pct <= -3 ||
        (pct <= -1.5 && value >= 200000000) ||
        (value >= 1000000000 && pct < 0) ||
        (volume >= 5000 && pct <= -1.2);
      const side = hasLongSignal && (!hasShortSignal || pct >= 0) ? "long" : hasShortSignal ? "short" : "";
      const row = {
        ...stock,
        pct,
        percent: pct,
        value,
        volume,
        side,
        trust: 0,
        foreign: 0,
        totalInst: 0,
        signalTags,
        detectedAt,
      };
      row.score = radarSignalScore(row);
      row.flow = radarFlowValue(row);
      return row;
    })
    .filter((stock) => stock.value > 0 && stock.side && stock.signalTags.length)
    .sort((a, b) => b.score - a.score || b.value - a.value)
    .slice(0, 80);
}

async function main() {
  const parts = taipeiParts();
  const key = dateKey(parts);
  const detectedAt = Date.now();
  const timestamp = timestampKey(parts);
  if (!isMarketTime(parts)) {
    writeJson(OUT_FILE, {
      source: "mini-pc-realtime-radar",
      status: "outside_market_time",
      date: key,
      timestamp,
      updatedAt: new Date(detectedAt).toISOString(),
      updatedAtMs: detectedAt,
      staleAfterMs: STALE_AFTER_MS,
      rows: [],
      longCount: 0,
      shortCount: 0,
    });
    console.log(`realtime radar skipped outside market time ${timestamp}`);
    return;
  }

  const rawStocks = await fetchStocks();
  const liveStocks = await fetchRealtime(rawStocks);
  const rows = buildRadarRows(liveStocks, detectedAt);
  writeJson(OUT_FILE, {
    source: "mini-pc-realtime-radar",
    status: "ok",
    date: key,
    timestamp,
    updatedAt: new Date(detectedAt).toISOString(),
    updatedAtMs: detectedAt,
    staleAfterMs: STALE_AFTER_MS,
    rows,
    longCount: rows.filter((row) => row.side === "long").length,
    shortCount: rows.filter((row) => row.side === "short").length,
  });
  console.log(`realtime radar ${timestamp}: rows ${rows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
